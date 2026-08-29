param(
    [string]$ProjectRoot = "C:\VYRA-GITHUB",
    [string]$SupabaseUrl = "http://127.0.0.1:54321",
    [string]$DatabaseContainer = "supabase_db_vyra-local"
)

$ErrorActionPreference = "Stop"

function Write-Pass {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Invoke-LocalSql {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $output = $Sql | & docker exec -i $DatabaseContainer `
        psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At

    if ($LASTEXITCODE -ne 0) {
        throw "Local PostgreSQL command failed with exit code $LASTEXITCODE"
    }

    return @($output)
}

Write-Host "=== VYRA local runtime test ===" -ForegroundColor Cyan
Write-Host "ProjectRoot: $ProjectRoot"
Write-Host "SupabaseUrl: $SupabaseUrl"
Write-Host "Production access: DISABLED"

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root not found: $ProjectRoot"
}

$uri = [Uri]$SupabaseUrl
$allowedHosts = @("127.0.0.1", "localhost", "::1")
if ($uri.Scheme -ne "http" -or $allowedHosts -notcontains $uri.Host) {
    throw "Only a local HTTP Supabase URL is allowed. Received: $SupabaseUrl"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI not found"
}

$runningContainers = @(& docker ps --format "{{.Names}}")
if ($LASTEXITCODE -ne 0) {
    throw "Unable to query Docker"
}

if ($runningContainers -notcontains $DatabaseContainer) {
    throw "Database container is not running: $DatabaseContainer"
}
Write-Pass "Local database container is running"

$diagnostics = Invoke-RestMethod `
    -Method Get `
    -Uri "$SupabaseUrl/functions/v1/vyra-diagnostics"

if (-not $diagnostics.ok) {
    throw "vyra-diagnostics returned ok=false"
}
if ($diagnostics.environment.SUPABASE_URL -ne "SET") {
    throw "Local Edge Runtime has no SUPABASE_URL"
}
if ($diagnostics.environment.SUPABASE_SERVICE_ROLE_KEY -ne "SET") {
    throw "Local Edge Runtime has no SUPABASE_SERVICE_ROLE_KEY"
}
Write-Pass "Edge Runtime diagnostics passed"

$rpcId = [guid]::NewGuid().Guid
$rpcAgent = "diagnostic_$($rpcId.Replace('-', ''))"
$rpcSql = @"
begin;

insert into public.jobs (
  id, agent, task_type, status, priority, payload, max_attempts
)
values (
  '$rpcId',
  '$rpcAgent',
  'rpc_contract_probe',
  'queued',
  -1000,
  '{"probe":true}'::jsonb,
  1
);

select status || '|' || attempts
from public.claim_next_job('$rpcAgent');

select public.complete_job(
  '$rpcId'::uuid,
  'completed',
  '{"probe_passed":true}'::jsonb,
  null
);

select status || '|' || attempts
from public.jobs
where id = '$rpcId'::uuid;

rollback;

select count(*)
from public.jobs
where id = '$rpcId'::uuid;
"@

$rpcOutput = Invoke-LocalSql -Sql $rpcSql
$rpcText = $rpcOutput -join "`n"
if ($rpcText -notmatch "running\|1") {
    throw "claim_next_job did not produce running|1"
}
if ($rpcText -notmatch "completed\|1") {
    throw "complete_job did not produce completed|1"
}
if ($rpcOutput[-1].Trim() -ne "0") {
    throw "RPC transaction left diagnostic rows behind"
}
Write-Pass "Queue claim and completion contract passed with rollback"

$requestId = [guid]::NewGuid().Guid
$jobId = [guid]::NewGuid().Guid
$body = @{
    action = "run"
    job_id = $jobId
    payload = @{
        request_id = $requestId
        language = "ru"
        region = "EU"
        topic_seed = "image enhancement"
        constraints = @{
            max_topics = 3
            min_score = 0.7
        }
    }
} | ConvertTo-Json -Depth 8

try {
    $first = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/topic-scout" `
        -ContentType "application/json" `
        -Body $body

    if (-not $first.ok) {
        throw "First topic-scout request returned ok=false"
    }

    $insertedCount = @($first.result.inserted_research_jobs).Count
    if ($insertedCount -lt 1) {
        throw "First topic-scout request inserted no research jobs"
    }

    $second = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/topic-scout" `
        -ContentType "application/json" `
        -Body $body

    if (-not $second.ok) {
        throw "Second topic-scout request returned ok=false"
    }

    if (@($second.result.new_research_jobs).Count -ne 0) {
        throw "Dedupe check allowed a duplicate research job"
    }
    if (@($second.result.inserted_research_jobs).Count -ne 0) {
        throw "Second topic-scout request inserted duplicate rows"
    }

    Write-Pass "Topic Scout mock integration and dedupe passed"
}
finally {
    $cleanupSql = @"
delete from public.jobs
where payload->>'request_id' = '$requestId';

select count(*)
from public.jobs
where payload->>'request_id' = '$requestId';
"@

    $cleanupOutput = Invoke-LocalSql -Sql $cleanupSql
    if ($cleanupOutput[-1].Trim() -ne "0") {
        throw "Runtime test cleanup left diagnostic rows behind"
    }
}

Write-Pass "Diagnostic rows cleaned up"
Write-Host "RESULT: PASS" -ForegroundColor Green
