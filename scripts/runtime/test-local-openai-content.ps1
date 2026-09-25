param(
    [string]$ProjectRoot = "C:\VYRA-GITHUB",
    [string]$SupabaseUrl = "http://127.0.0.1:55321",
    [string]$DatabaseContainer = "supabase_db_vyra-local-permanent",
    [string]$RuntimeEnvFile = "C:\VYRA-LOCAL\supabase\functions\.env"
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

function Get-EnvSetting {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") {
            return $Matches[1].Trim()
        }
    }

    throw "Missing $Name in $Path"
}

function Invoke-Controller {
    param([Parameter(Mandatory = $true)][string]$Body)

    return Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body $Body
}

function Test-DispatchJobIdentity {
    param(
        [object]$ResponseJobId,
        [Parameter(Mandatory = $true)][string]$ExpectedJobId
    )

    $reportedJobId = ([string]$ResponseJobId).Trim()
    if ($reportedJobId) {
        return $reportedJobId -eq $ExpectedJobId
    }

    $status = [string](
        @(Invoke-LocalSql -Sql @"
select status
from public.jobs
where id = '$ExpectedJobId'::uuid;
"@) | Select-Object -Last 1
    )

    return $status.Trim() -eq "completed"
}

Write-Host "=== VYRA controlled OpenAI content test ===" -ForegroundColor Cyan
Write-Host "Target: $SupabaseUrl"
Write-Host "External calls: exactly one OpenAI Content-worker request"
Write-Host "Research: mock; Publisher: mock"
Write-Host ""

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root not found: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $RuntimeEnvFile -PathType Leaf)) {
    throw "Runtime env file not found: $RuntimeEnvFile"
}
if (@(& docker ps --format "{{.Names}}") -notcontains $DatabaseContainer) {
    throw "Database container is not running: $DatabaseContainer"
}

$controllerSecret = Get-EnvSetting `
    -Path $RuntimeEnvFile `
    -Name "VYRA_CONTROLLER_SECRET"

$edgeRuntimeContainer = $DatabaseContainer -replace `
    '^supabase_db_', `
    'supabase_edge_runtime_'

$runtimeState = @(
    & docker exec $edgeRuntimeContainer sh -lc 'test -n "$OPENAI_API_KEY" && echo key=present || echo key=missing; echo content="$CONTENT_PROVIDER"; echo research="$RESEARCH_PROVIDER"; echo publish="$PUBLISH_PROVIDER"; echo model="$OPENAI_CONTENT_MODEL"; echo reservation="$VYRA_OPENAI_CONTENT_RESERVATION_EUR_MICROS"'
)

if (
    $runtimeState -notcontains "key=present" -or
    $runtimeState -notcontains "content=openai" -or
    $runtimeState -notcontains "research=mock" -or
    $runtimeState -notcontains "publish=mock" -or
    $runtimeState -notcontains "model=gpt-5-mini-2025-08-07" -or
    $runtimeState -notcontains "reservation=50000"
) {
    throw "Runtime provider configuration does not match the controlled OpenAI test profile"
}
Write-Pass "Runtime profile is OpenAI-only for Content-worker"

$budgetMode = [string](
    @(Invoke-LocalSql -Sql @"
select mode || '|' || daily_limit_eur_micros
from public.vyra_cost_budget_policy
where singleton = true;
"@) | Select-Object -Last 1
)

if ($budgetMode.Trim() -ne "enforce|450000") {
    throw "Cost budget must be enforce|450000; actual: $budgetMode"
}
Write-Pass "EUR budget enforcement is active"

$scoutJobId = [guid]::NewGuid().Guid
$runtimeTopicSeed = "openai controlled integration test"
$runtimeProgramUrl =
    "https://example.local/research/ai-tools-pricing/" +
    [uri]::EscapeDataString($runtimeTopicSeed) +
    "?run=$scoutJobId"

$contentJobId = $null

try {
    $scoutPayload = @{
        request_id = $scoutJobId
        language = "ru"
        region = "EU"
        topic_seed = $runtimeTopicSeed
        constraints = @{
            min_score = 0.7
            max_topics = 1
        }
    } | ConvertTo-Json -Depth 8 -Compress

    $payloadSql = $scoutPayload.Replace("'", "''")

    Invoke-LocalSql -Sql @"
insert into public.jobs (
  id, agent, task_type, status, priority, payload, max_attempts
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

    $scout = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"topic_scout"}'

    if (
        -not $scout.ok -or
        -not $scout.claimed -or
        -not (Test-DispatchJobIdentity $scout.job_id $scoutJobId)
    ) {
        throw "Topic Scout did not claim the controlled test job"
    }

    $researchJobId = [string](
        @(Invoke-LocalSql -Sql @"
select id
from public.jobs
where agent = 'research'
  and task_type = 'topic_research'
  and payload->>'request_id' = '$scoutJobId'
order by created_at desc
limit 1;
"@) | Select-Object -Last 1
    )

    if (-not $researchJobId) {
        throw "Topic Scout created no Research job"
    }

    $research = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"research"}'

    if (
        -not $research.ok -or
        -not $research.claimed -or
        $research.provider -ne "mock" -or
        -not (Test-DispatchJobIdentity $research.job_id $researchJobId)
    ) {
        throw "Research did not complete with the mock provider"
    }

    $contentJobId = [string]$research.content_job.id
    if (-not $contentJobId) {
        throw "Research returned no Content job"
    }

    Write-Pass "Mock Research created the controlled Content job"

    $content = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"content"}'

    if (
        -not $content.ok -or
        -not $content.claimed -or
        $content.provider -ne "openai" -or
        -not $content.content.created -or
        -not (Test-DispatchJobIdentity $content.job_id $contentJobId)
    ) {
        throw "OpenAI Content-worker did not complete the controlled job"
    }

    $ledger = [string](
        @(Invoke-LocalSql -Sql @"
select
  r.status || '|' ||
  r.reserved_eur_micros || '|' ||
  o.mode || '|' ||
  coalesce(o.pricing_version, '') || '|' ||
  coalesce(o.estimated_usd_micros::text, '')
from public.vyra_cost_reservations r
join public.vyra_cost_observations o
  on o.job_id = r.job_id
where r.job_id = '$contentJobId'::uuid
  and r.provider = 'openai'
  and r.operation = 'content_draft'
  and o.provider = 'openai'
  and o.operation = 'content_draft';
"@) | Select-Object -Last 1
    )

    $ledgerParts = $ledger.Trim().Split('|')
    if (
        $ledgerParts.Count -ne 5 -or
        $ledgerParts[0] -ne "settled" -or
        $ledgerParts[1] -ne "50000" -or
        $ledgerParts[2] -ne "enforce" -or
        $ledgerParts[3] -ne "openai-gpt-5-mini-standard-2026-09-10" -or
        [long]$ledgerParts[4] -le 0
    ) {
        throw "OpenAI reservation or estimated USD ledger record is invalid: $ledger"
    }

    Write-Pass "One OpenAI call completed with settled reservation and USD ledger"
}
finally {
    $cleanup = Invoke-LocalSql -Sql @"
delete from public.referral_links
where program_id in (
  select id
  from public.programs
  where official_url = '$runtimeProgramUrl'
);

delete from public.programs
where official_url = '$runtimeProgramUrl';

delete from public.content
where evidence->>'request_id' = '$scoutJobId';

delete from public.jobs
where (id = '$scoutJobId'::uuid
   or payload->>'request_id' = '$scoutJobId')
  and id is distinct from nullif('$contentJobId', '')::uuid;

select
  (select count(*) from public.jobs
   where (id = '$scoutJobId'::uuid
      or payload->>'request_id' = '$scoutJobId')
     and id is distinct from nullif('$contentJobId', '')::uuid)
  || '|' ||
  (select count(*) from public.content
   where evidence->>'request_id' = '$scoutJobId')
  || '|' ||
  (select count(*) from public.programs
   where official_url = '$runtimeProgramUrl')
  || '|' ||
  (select count(*) from public.referral_links
   where program_id in (
     select id from public.programs
     where official_url = '$runtimeProgramUrl'
   ));
"@

    $cleanupResult = [string](@($cleanup) | Select-Object -Last 1)
    if ($cleanupResult.Trim() -ne "0|0|0|0") {
        throw "Controlled OpenAI test cleanup failed: $cleanupResult"
    }
}

Write-Pass "Diagnostic rows cleaned; paid Content job and cost ledger retained"
Write-Host "RESULT: PASS" -ForegroundColor Green
