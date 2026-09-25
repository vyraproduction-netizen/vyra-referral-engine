[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'C:\VYRA-LOCAL',
    [string]$SupabaseUrl = 'http://127.0.0.1:55321',
    [string]$DatabaseContainer = 'supabase_db_vyra-local-permanent'
)

$ErrorActionPreference = 'Stop'
$uri = [uri]$SupabaseUrl
if ($uri.Scheme -ne 'http' -or $uri.Host -notin @('localhost', '127.0.0.1', '::1')) {
    throw 'Mock queue tick accepts a local HTTP Supabase URL only'
}

function Invoke-LocalSql {
    param([Parameter(Mandatory = $true)][string]$Sql)
    $rows = $Sql | docker exec -i $DatabaseContainer `
        psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At
    if ($LASTEXITCODE -ne 0) { throw 'Local database query failed' }
    return @($rows)
}

function Get-LocalEnvValue {
    param([string]$File, [string]$Name)
    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*='
    $line = Get-Content -LiteralPath $File | `
        Where-Object { $_ -match $pattern } | Select-Object -Last 1
    if (-not $line) { return '' }
    return ($line -replace $pattern, '').Trim().Trim('"').Trim("'")
}

$running = docker inspect --format '{{.State.Running}}' $DatabaseContainer
if ($LASTEXITCODE -ne 0 -or $running.Trim() -ne 'true') {
    throw 'Permanent local database is not running'
}
$edgeContainer = $DatabaseContainer -replace '^supabase_db_', 'supabase_edge_runtime_'
$edgeRunning = docker inspect --format '{{.State.Running}}' $edgeContainer
if ($LASTEXITCODE -ne 0 -or $edgeRunning.Trim() -ne 'true') {
    throw 'Permanent local Edge Runtime is not running'
}

$envFile = Join-Path $RuntimeRoot 'supabase\functions\.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw 'Local functions environment file is missing'
}
foreach ($name in @('RESEARCH_PROVIDER', 'CONTENT_PROVIDER', 'PUBLISH_PROVIDER')) {
    if ((Get-LocalEnvValue -File $envFile -Name $name) -ne 'mock') {
        throw "$name in local file must be mock"
    }
    $active = docker exec $edgeContainer printenv $name
    if ($LASTEXITCODE -ne 0 -or $active.Trim() -ne 'mock') {
        throw "$name in active Edge Runtime must be mock"
    }
}
$controllerSecret = Get-LocalEnvValue -File $envFile -Name 'VYRA_CONTROLLER_SECRET'
if (-not $controllerSecret) { throw 'Local controller secret is missing' }

$mutex = [Threading.Mutex]::new($false, 'Global\VYRA-Local-Mock-Queue-Tick')
$entered = $false
try {
    $entered = $mutex.WaitOne(0)
    if (-not $entered) { throw 'Another local queue tick is still running' }

    $recovered = @(Invoke-LocalSql -Sql @'
select job_id::text || '|' || agent || '|' || recovery_status
from public.recover_stale_vyra_jobs(30, 100);
'@) | Where-Object { $_ }
    if ($recovered | Where-Object { $_ -match '\|failed$' }) {
        throw 'Stale external job stopped for review; inspect queue before dispatch'
    }

    $runningJobs = [int](
        @(Invoke-LocalSql -Sql "select count(*) from public.jobs where status = 'running';") |
            Select-Object -Last 1
    )
    if ($runningJobs -gt 0) {
        Write-Host '[INFO] A job is running; no new job dispatched'
        return
    }

    $nextRow = (
        @(Invoke-LocalSql -Sql @'
select id::text || '|' || agent
from public.jobs
where status in ('queued', 'retry')
  and next_run_at <= now()
  and attempts < max_attempts
order by priority, created_at, id
limit 1;
'@) | Select-Object -Last 1
    )
    $next = if ($null -eq $nextRow) { '' } else { ([string]$nextRow).Trim() }
    if (-not $next) {
        $seedRow = (
            @(Invoke-LocalSql -Sql @'
select coalesce(job_id::text, '') || '|' || created::text || '|' || reason
from public.enqueue_daily_vyra_scout();
'@) | Select-Object -Last 1
        )
        if ($null -eq $seedRow) {
            throw 'Daily Scout enqueue returned no row'
        }
        $seed = ([string]$seedRow).Trim()
        Write-Host "[INFO] Daily Scout: $seed"
        if ($seed -notmatch '\|t\|created$') { return }
        $next = ($seed -split '\|', 3)[0] + '|topic_scout'
    }

    $parts = $next -split '\|', 2
    $jobId, $agent = $parts[0], $parts[1]
    if ($agent -notin @(
        'topic_scout', 'research', 'content', 'qa',
        'publisher', 'analytics', 'optimizer', 'repeat'
    )) {
        throw "Unsupported queued agent: $agent"
    }

    $body = @{ action = 'dispatch'; agent = $agent } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType 'application/json' -Body $body
    if (-not $response.ok -or -not $response.claimed) {
        throw "Controller did not complete queued $agent job: $jobId"
    }
    $reportedId = ([string]$response.job_id).Trim()
    if ($reportedId -and $reportedId -ne $jobId) {
        throw "Controller dispatched another job: $reportedId"
    }
    $storedRow = (
        @(Invoke-LocalSql -Sql "select status from public.jobs where id = '$jobId'::uuid;") |
            Select-Object -Last 1
    )
    $stored = if ($null -eq $storedRow) { '' } else { ([string]$storedRow).Trim() }
    if ($stored -ne 'completed') {
        throw "Job did not persist completion: $jobId ($stored)"
    }
    Write-Host "[PASS] Mock queue tick completed $agent job: $jobId"
}
finally {
    if ($entered) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
