[CmdletBinding()]
param(
    [string]$SupabaseUrl = "http://127.0.0.1:55321",
    [string]$DatabaseContainer = "supabase_db_vyra-local-permanent",
    [string]$EdgeRuntimeContainer = "supabase_edge_runtime_vyra-local-permanent",
    [string]$RuntimeEnvPath = "C:\VYRA-LOCAL\supabase\functions\.env"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Name
    )

    $pattern = "^\s*$([regex]::Escape($Name))=(.*)$"

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $pattern) {
            return $Matches[1].Trim()
        }
    }

    return $null
}

function Invoke-LocalSql {
    param([string]$Sql)

    $result = $Sql |
        docker exec -i $DatabaseContainer `
            psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At

    if ($LASTEXITCODE -ne 0) {
        throw "Local PostgreSQL command failed"
    }

    return (($result | Out-String).Trim())
}

function Invoke-Controller {
    param([string]$Body)

    return Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body $Body
}

$controllerSecret = Get-EnvValue `
    -Path $RuntimeEnvPath `
    -Name "VYRA_CONTROLLER_SECRET"

if (-not $controllerSecret) {
    throw "VYRA_CONTROLLER_SECRET is missing from the local runtime environment"
}

$runtimeEnvironment = @{}

foreach ($name in @(
    "TAVILY_API_KEY",
    "RESEARCH_PROVIDER",
    "CONTENT_PROVIDER",
    "PUBLISH_PROVIDER",
    "VYRA_TAVILY_RESERVATION_EUR_MICROS"
)) {
    $runtimeEnvironment[$name] = (
        (docker exec $EdgeRuntimeContainer printenv $name | Out-String).Trim()
    )
}

$keyState = if ($runtimeEnvironment["TAVILY_API_KEY"]) {
    "present"
} else {
    "missing"
}

$runtimeState = "{0}|{1}|{2}|{3}|{4}" -f `
    $keyState,
    $runtimeEnvironment["RESEARCH_PROVIDER"],
    $runtimeEnvironment["CONTENT_PROVIDER"],
    $runtimeEnvironment["PUBLISH_PROVIDER"],
    $runtimeEnvironment["VYRA_TAVILY_RESERVATION_EUR_MICROS"]

if ($runtimeState -ne "present|tavily|mock|mock|20000") {
    throw "Runtime profile is unsafe or incomplete: $runtimeState"
}

if ($runtimeState -ne "present|tavily|mock|mock|20000") {
    throw "Runtime profile is unsafe or incomplete: $runtimeState"
}

$budget = Invoke-LocalSql -Sql @"
select mode || '|' || currency || '|' || daily_limit_eur_micros
from public.vyra_cost_budget_policy
where singleton = true;
"@

$budgetParts = $budget.Split("|")
if (
    $budgetParts.Count -ne 3 -or
    $budgetParts[0] -ne "enforce" -or
    $budgetParts[1] -ne "EUR" -or
    [long]$budgetParts[2] -lt 20000
) {
    throw "EUR budget enforcement is not ready: $budget"
}

$scoutJobId = [guid]::NewGuid().ToString()

try {
    $payload = @{
        request_id = $scoutJobId
        language = "en"
        region = "EU"
        topic_seed = "AI image enhancement tools"
        constraints = @{
            min_score = 0.7
            max_topics = 1
        }
    } | ConvertTo-Json -Depth 8 -Compress

    $payloadSql = $payload.Replace("'", "''")

    Invoke-LocalSql -Sql @"
insert into public.jobs (
  id,
  agent,
  task_type,
  status,
  priority,
  payload,
  max_attempts
)
values (
  '$scoutJobId'::uuid,
  'topic_scout',
  'topic_discovery',
  'queued',
  100000,
  '$payloadSql'::jsonb,
  1
);
"@ | Out-Null

    Write-Host "=== VYRA controlled Tavily Topic Scout test ===" -ForegroundColor Cyan
    Write-Host "Target: $SupabaseUrl"
    Write-Host "External calls: exactly one Tavily Basic search"
    Write-Host "Research, Content, Publisher: not dispatched"
    Write-Host ""

    $response = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"topic_scout"}'

    if (
        -not $response.ok -or
        -not $response.claimed -or
        $response.job_id -ne $scoutJobId
    ) {
        throw "Topic Scout dispatch did not claim the controlled job"
    }

    $ledger = Invoke-LocalSql -Sql @"
select
  r.status || '|' ||
  r.reserved_eur_micros || '|' ||
  o.mode || '|' ||
  coalesce(o.metadata->>'search_depth', '') || '|' ||
  coalesce(o.metadata->>'requested_max_results', '') || '|' ||
  coalesce(o.metadata->>'results_count', '')
from public.vyra_cost_reservations r
join public.vyra_cost_observations o
  on o.job_id = r.job_id
 and o.provider = r.provider
where r.job_id = '$scoutJobId'::uuid
  and r.provider = 'tavily'
  and r.operation = 'topic_scout_search'
  and o.operation = 'topic_scout_search';
"@

    $parts = $ledger.Split("|")
    $resultCount = [long]0
    $validResultCount =
        $parts.Count -eq 6 -and
        [long]::TryParse($parts[5], [ref]$resultCount)

    if (
        -not $validResultCount -or
        $parts[0] -ne "settled" -or
        $parts[1] -ne "20000" -or
        $parts[2] -ne "enforce" -or
        $parts[3] -ne "basic" -or
        $parts[4] -ne "1" -or
        $resultCount -lt 0
    ) {
        throw "Tavily reservation or usage ledger is invalid: $ledger"
    }

    $researchJobsCreated = Invoke-LocalSql -Sql @"
select count(*)
from public.jobs
where agent = 'research'
  and payload->>'request_id' = '$scoutJobId';
"@

    Write-Host "[PASS] Runtime profile is Tavily-only for Research" -ForegroundColor Green
    Write-Host "[PASS] EUR budget enforcement is active" -ForegroundColor Green
    Write-Host "[PASS] Topic Scout completed one Tavily Basic search" -ForegroundColor Green
    Write-Host "[PASS] Tavily reservation and usage ledger are settled" -ForegroundColor Green
    Write-Host "[INFO] Queued Research jobs not dispatched: $researchJobsCreated" -ForegroundColor DarkYellow
}
finally {
    $cleanup = Invoke-LocalSql -Sql @"
begin;

delete from public.jobs
where agent = 'research'
  and payload->>'request_id' = '$scoutJobId';

select
  (select count(*) from public.jobs
   where agent = 'research'
     and payload->>'request_id' = '$scoutJobId');

-- Keep the paid job and ledger so the daily limit remains enforced.
select
  (select count(*) from public.vyra_cost_observations
   where job_id = '$scoutJobId'::uuid) || '|' ||
  (select count(*) from public.vyra_cost_reservations
   where job_id = '$scoutJobId'::uuid);

commit;
"@

	$cleanupState = (
		$cleanup -split "\r?\n" |
		Where-Object { $_ -match "^\d+$" } |
		Select-Object -Last 1
	)

	if ($cleanupState -ne "0") {
		throw "Controlled Tavily test cleanup failed: $cleanup"
	}

	Write-Host "[PASS] Diagnostic Research jobs cleaned: $cleanupState" -ForegroundColor Green
	Write-Host "[INFO] Paid Topic Scout job and cost ledger retained for budget accounting" -ForegroundColor DarkYellow
}

Write-Host "RESULT: PASS" -ForegroundColor Green
