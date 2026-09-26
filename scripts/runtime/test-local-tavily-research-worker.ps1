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
    param([string]$Path, [string]$Name)

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
            psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt

    if ($LASTEXITCODE -ne 0) {
        throw "Local PostgreSQL command failed"
    }

    return (($result | Out-String).Trim())
}

function Invoke-Controller {
    param([string]$Body)

    Invoke-RestMethod `
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

$queuedResearchJobs = Invoke-LocalSql -Sql @"
select count(*)
from public.jobs
where agent = 'research'
  and status = 'queued';
"@

if ($queuedResearchJobs -ne "0") {
    throw "Refusing to dispatch Research-worker while queued jobs already exist: $queuedResearchJobs"
}

$researchJobId = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()
$candidateUrl = "https://example.local/tools/ai-image-enhancement?run=$researchJobId"

try {
    $payload = @{
        request_id = $requestId
        language = "en"
        region = "EU"
        topic_seed = "AI image enhancement tools"
        candidate = @{
            title = "AI image enhancement tools"
            url = $candidateUrl
            opportunity_score = 0.9
            commercial_intent = 0.9
            content_potential = 0.9
            referral_potential = 0.9
            relevance = 0.9
            evidence_source = "controlled-tavily-research-test"
        }
        recommended_action = "investigate_referral_program"
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
  '$researchJobId'::uuid,
  'research',
  'topic_research',
  'queued',
  100000,
  '$payloadSql'::jsonb,
  1
);
"@ | Out-Null

    Write-Host "=== VYRA controlled Tavily Research-worker test ===" -ForegroundColor Cyan
    Write-Host "Target: $SupabaseUrl"
    Write-Host "External calls: exactly one Tavily Advanced search"
    Write-Host "Content and Publisher: not dispatched"
    Write-Host ""

    $response = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"research"}'

    if (
        -not $response.ok -or
        -not $response.claimed -or
        $response.job_id -ne $researchJobId -or
        $response.provider -ne "tavily"
    ) {
        throw "Research dispatch did not claim the controlled Tavily job"
    }

    $programId = [string]$response.program.id
    $referralLinkId = [string]$response.referral_link.id
    $contentJobId = [string]$response.content_job.id

    if (
        -not $programId -or
        -not $referralLinkId -or
        -not $contentJobId
    ) {
        throw "Research response omitted a program, referral link, or Content job"
    }

    $persistenceState = Invoke-LocalSql -Sql @"
select
  research_job.status || '|' ||
  program.status || '|' ||
  referral.status || '|' ||
  content_job.status || '|' ||
  (content_job.payload->>'source_job_id' = research_job.id::text)
from public.jobs research_job
join public.programs program
  on program.id = '$programId'::uuid
join public.referral_links referral
  on referral.id = '$referralLinkId'::uuid
 and referral.program_id = program.id
join public.jobs content_job
  on content_job.id = '$contentJobId'::uuid
where research_job.id = '$researchJobId'::uuid
  and program.official_url = '$candidateUrl';
"@

    if ($persistenceState -ne "completed|candidate|paused|queued|true") {
        throw "Research persistence is invalid: $persistenceState"
    }

    $ledger = Invoke-LocalSql -Sql @"
select
  r.status || '|' ||
  r.reserved_eur_micros || '|' ||
  o.mode || '|' ||
  coalesce(o.metadata->>'search_depth', '') || '|' ||
  coalesce(o.metadata->>'max_results', '') || '|' ||
  coalesce(o.metadata->>'results_count', '')
from public.vyra_cost_reservations r
join public.vyra_cost_observations o
  on o.job_id = r.job_id
 and o.provider = r.provider
where r.job_id = '$researchJobId'::uuid
  and r.provider = 'tavily'
  and r.operation = 'research_worker_search'
  and o.operation = 'research_worker_search';
"@

    $parts = $ledger.Split("|")
    [long]$resultCount = 0

    $validResultCount =
        $parts.Count -eq 6 -and
        [long]::TryParse($parts[5], [ref]$resultCount)

    if (
        -not $validResultCount -or
        $parts[0] -ne "settled" -or
        $parts[1] -ne "20000" -or
        $parts[2] -ne "enforce" -or
        $parts[3] -ne "advanced" -or
        $parts[4] -ne "5" -or
        $resultCount -lt 1
    ) {
        throw "Tavily Research-worker reservation or usage ledger is invalid: $ledger"
    }

    Write-Host "[PASS] Runtime profile is Tavily-only for Research" -ForegroundColor Green
    Write-Host "[PASS] EUR budget enforcement is active" -ForegroundColor Green
    Write-Host "[PASS] Research-worker completed one Tavily Advanced search" -ForegroundColor Green
    Write-Host "[PASS] Program, Referral Link, and Content job were persisted" -ForegroundColor Green
    Write-Host "[PASS] Tavily reservation and usage ledger are settled" -ForegroundColor Green
}
finally {
    $cleanupOutput = Invoke-LocalSql -Sql @"
begin;

delete from public.jobs
where agent = 'content'
  and payload->>'source_job_id' = '$researchJobId';

delete from public.referral_links
where program_id in (
  select id
  from public.programs
  where official_url = '$candidateUrl'
);

delete from public.programs
where official_url = '$candidateUrl';

select
  (select count(*) from public.jobs
   where agent = 'content'
     and payload->>'source_job_id' = '$researchJobId') || '|' ||
  (select count(*) from public.programs
   where official_url = '$candidateUrl');

-- Retain the Research job and paid ledger for audit and the daily budget.
select
  (select count(*) from public.jobs
   where id = '$researchJobId'::uuid) || '|' ||
  (select count(*) from public.vyra_cost_observations
   where job_id = '$researchJobId'::uuid) || '|' ||
  (select count(*) from public.vyra_cost_reservations
   where job_id = '$researchJobId'::uuid);

commit;
"@

    $cleanupState = (
        $cleanupOutput -split "\r?\n" |
        Where-Object { $_ -match "^\d+\|\d+$" } |
        Select-Object -Last 1
    )

    if ($cleanupState -ne "0|0") {
        throw "Controlled Tavily Research-worker cleanup failed: $cleanupOutput"
    }

    Write-Host "[PASS] Diagnostic program and queued Content job cleaned: $cleanupState" -ForegroundColor Green
    Write-Host "[INFO] Paid Research job and cost ledger retained for budget accounting" -ForegroundColor DarkYellow
}

Write-Host "RESULT: PASS" -ForegroundColor Green
