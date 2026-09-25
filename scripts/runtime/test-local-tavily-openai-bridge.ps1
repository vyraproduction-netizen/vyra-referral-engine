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
    "OPENAI_API_KEY",
    "RESEARCH_PROVIDER",
    "CONTENT_PROVIDER",
    "PUBLISH_PROVIDER",
    "VYRA_TAVILY_RESERVATION_EUR_MICROS",
    "VYRA_OPENAI_CONTENT_RESERVATION_EUR_MICROS"
)) {
    $runtimeEnvironment[$name] = (
        (docker exec $EdgeRuntimeContainer printenv $name | Out-String).Trim()
    )
}

$tavilyKeyState = if ($runtimeEnvironment["TAVILY_API_KEY"]) {
    "present"
} else {
    "missing"
}

$openAiKeyState = if ($runtimeEnvironment["OPENAI_API_KEY"]) {
    "present"
} else {
    "missing"
}

$runtimeState = "{0}|{1}|{2}|{3}|{4}|{5}|{6}" -f `
    $tavilyKeyState,
    $openAiKeyState,
    $runtimeEnvironment["RESEARCH_PROVIDER"],
    $runtimeEnvironment["CONTENT_PROVIDER"],
    $runtimeEnvironment["PUBLISH_PROVIDER"],
    $runtimeEnvironment["VYRA_TAVILY_RESERVATION_EUR_MICROS"],
    $runtimeEnvironment["VYRA_OPENAI_CONTENT_RESERVATION_EUR_MICROS"]

if ($runtimeState -ne "present|present|tavily|openai|mock|20000|50000") {
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
    [long]$budgetParts[2] -lt 70000
) {
    throw "EUR budget enforcement is not ready for the bridge test: $budget"
}

$queuedJobs = Invoke-LocalSql -Sql @"
select
  (select count(*) from public.jobs
   where agent = 'research' and status = 'queued') || '|' ||
  (select count(*) from public.jobs
   where agent = 'content' and status = 'queued');
"@

if ($queuedJobs -ne "0|0") {
    throw "Refusing to dispatch while queued Research or Content jobs exist: $queuedJobs"
}

$researchJobId = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()
$candidateUrl = "https://example.local/tools/ai-image-enhancement?run=$researchJobId"
$contentJobId = ""
$contentId = ""

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
            evidence_source = "controlled-tavily-openai-bridge"
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

    Write-Host "=== VYRA controlled Tavily -> OpenAI bridge test ===" -ForegroundColor Cyan
    Write-Host "Target: $SupabaseUrl"
    Write-Host "External calls: one Tavily Advanced search; one OpenAI Content request"
    Write-Host "QA and Publisher: not dispatched"
    Write-Host ""

    $researchResponse = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"research"}'

    if (
        -not $researchResponse.ok -or
        -not $researchResponse.claimed -or
        $researchResponse.job_id -ne $researchJobId -or
        $researchResponse.provider -ne "tavily"
    ) {
        throw "Research dispatch did not claim the controlled Tavily job"
    }

    $programId = [string]$researchResponse.program.id
    $referralLinkId = [string]$researchResponse.referral_link.id
    $contentJobId = [string]$researchResponse.content_job.id

    if (
        -not $programId -or
        -not $referralLinkId -or
        -not $contentJobId
    ) {
        throw "Research response omitted a program, referral link, or Content job"
    }

    $contentResponse = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"content"}'

    if (
        -not $contentResponse.ok -or
        -not $contentResponse.claimed -or
        $contentResponse.job_id -ne $contentJobId -or
        $contentResponse.provider -ne "openai" -or
        -not $contentResponse.content.created
    ) {
        throw "Content dispatch did not complete the controlled OpenAI job"
    }

    $contentId = [string]$contentResponse.content.id
    $qaJobId = [string]$contentResponse.qa_job.id

    if (-not $contentId -or -not $qaJobId) {
        throw "Content response omitted a draft or QA job"
    }

    $persistenceState = Invoke-LocalSql -Sql @"
select
  research_job.status || '|' ||
  program.status || '|' ||
  referral.status || '|' ||
  content_job.status || '|' ||
  draft.status || '|' ||
  qa_job.status || '|' ||
  (draft.evidence->>'source_job_id' = research_job.id::text) || '|' ||
  (qa_job.payload->>'source_content_job_id' = content_job.id::text)
from public.jobs research_job
join public.programs program
  on program.id = '$programId'::uuid
join public.referral_links referral
  on referral.id = '$referralLinkId'::uuid
 and referral.program_id = program.id
join public.jobs content_job
  on content_job.id = '$contentJobId'::uuid
join public.content draft
  on draft.id = '$contentId'::uuid
join public.jobs qa_job
  on qa_job.id = '$qaJobId'::uuid
where research_job.id = '$researchJobId'::uuid
  and program.official_url = '$candidateUrl';
"@

    if ($persistenceState -ne "completed|candidate|paused|completed|draft|queued|true|true") {
        throw "Bridge persistence is invalid: $persistenceState"
    }

    $researchLedger = Invoke-LocalSql -Sql @"
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

    $researchParts = $researchLedger.Split("|")
    [long]$researchResultCount = 0

    if (
        $researchParts.Count -ne 6 -or
        -not [long]::TryParse(
            $researchParts[5],
            [ref]$researchResultCount
        ) -or
        $researchParts[0] -ne "settled" -or
        $researchParts[1] -ne "20000" -or
        $researchParts[2] -ne "enforce" -or
        $researchParts[3] -ne "advanced" -or
        $researchParts[4] -ne "5" -or
        $researchResultCount -lt 1
    ) {
        throw "Tavily bridge ledger is invalid: $researchLedger"
    }

    $contentLedger = Invoke-LocalSql -Sql @"
select
  r.status || '|' ||
  r.reserved_eur_micros || '|' ||
  o.mode || '|' ||
  coalesce(o.pricing_version, '') || '|' ||
  coalesce(o.estimated_usd_micros::text, '')
from public.vyra_cost_reservations r
join public.vyra_cost_observations o
  on o.job_id = r.job_id
 and o.provider = r.provider
where r.job_id = '$contentJobId'::uuid
  and r.provider = 'openai'
  and r.operation = 'content_draft'
  and o.operation = 'content_draft';
"@

    $contentParts = $contentLedger.Split("|")
    [long]$estimatedUsdMicros = 0

    if (
        $contentParts.Count -ne 5 -or
        -not [long]::TryParse(
            $contentParts[4],
            [ref]$estimatedUsdMicros
        ) -or
        $contentParts[0] -ne "settled" -or
        $contentParts[1] -ne "50000" -or
        $contentParts[2] -ne "enforce" -or
        -not $contentParts[3] -or
        $estimatedUsdMicros -le 0
    ) {
        throw "OpenAI bridge ledger is invalid: $contentLedger"
    }

    Write-Host "[PASS] Runtime profile enables only Tavily Research and OpenAI Content" -ForegroundColor Green
    Write-Host "[PASS] EUR budget enforcement covers both provider reservations" -ForegroundColor Green
    Write-Host "[PASS] Tavily Research produced Program, Referral Link, and Content job" -ForegroundColor Green
    Write-Host "[PASS] OpenAI Content created a draft and queued QA job" -ForegroundColor Green
    Write-Host "[PASS] Tavily and OpenAI reservations and ledgers are settled" -ForegroundColor Green
}
finally {
    $cleanupOutput = Invoke-LocalSql -Sql @"
begin;

delete from public.jobs
where agent = 'qa'
  and payload->>'source_research_job_id' = '$researchJobId';

delete from public.content
where evidence->>'source_job_id' = '$researchJobId';

delete from public.jobs
where agent = 'content'
  and payload->>'source_job_id' = '$researchJobId'
  and id is distinct from nullif('$contentJobId', '')::uuid;

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
   where (
        agent = 'content'
        and payload->>'source_job_id' = '$researchJobId'
        and id is distinct from nullif('$contentJobId', '')::uuid
      )
      or (
        agent = 'qa'
        and payload->>'source_research_job_id' = '$researchJobId'
      )) || '|' ||
  (select count(*) from public.content
   where evidence->>'source_job_id' = '$researchJobId') || '|' ||
  (select count(*) from public.programs
   where official_url = '$candidateUrl');

commit;
"@

    $cleanupState = (
        $cleanupOutput -split "\r?\n" |
        Where-Object { $_ -match "^\d+\|\d+\|\d+$" } |
        Select-Object -Last 1
    )

    if ($cleanupState -ne "0|0|0") {
        throw "Controlled bridge cleanup failed: $cleanupOutput"
    }

    Write-Host "[PASS] Diagnostic content and downstream jobs cleaned: $cleanupState" -ForegroundColor Green
    Write-Host "[INFO] Paid jobs and cost ledgers retained for budget accounting" -ForegroundColor DarkYellow
}

Write-Host "RESULT: PASS" -ForegroundColor Green
