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

$localEnvPath = Join-Path `
    $ProjectRoot `
    "supabase/functions/.env"

if (-not (Test-Path -LiteralPath $localEnvPath -PathType Leaf)) {
    throw "Local functions env file not found: $localEnvPath"
}

$providerSetting = Get-Content -LiteralPath $localEnvPath |
    Where-Object {
        $_ -match '^\s*RESEARCH_PROVIDER\s*='
    } |
    Select-Object -Last 1

if ($providerSetting -notmatch '^\s*RESEARCH_PROVIDER\s*=\s*mock\s*$') {
    throw "Runtime worker test requires RESEARCH_PROVIDER=mock"
}
Write-Pass "Explicit local mock provider configuration detected"

$controllerSecretSetting = Get-Content -LiteralPath $localEnvPath |
    Where-Object {
        $_ -match '^\s*VYRA_CONTROLLER_SECRET\s*='
    } |
    Select-Object -Last 1

if (-not $controllerSecretSetting) {
    throw "VYRA_CONTROLLER_SECRET is required for the local controller test"
}

$controllerSecret = (
    $controllerSecretSetting -split '=', 2
)[1].Trim()

if (-not $controllerSecret) {
    throw "VYRA_CONTROLLER_SECRET is empty"
}

$unauthorizedStatus = $null
try {
    $unauthorizedResponse = Invoke-WebRequest `
        -UseBasicParsing `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -ContentType "application/json" `
        -Body '{"action":"health"}'

    $unauthorizedStatus = [int]$unauthorizedResponse.StatusCode
}
catch {
    if ($_.Exception.Response) {
        $unauthorizedStatus = [int]$_.Exception.Response.StatusCode
    }
    else {
        throw
    }
}

if ($unauthorizedStatus -ne 401) {
    throw "Controller request without a secret must return HTTP 401"
}
Write-Pass "Controller rejects unauthenticated requests"

$controllerHealth = Invoke-RestMethod `
    -Method Post `
    -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
    -Headers @{ apikey = $controllerSecret } `
    -ContentType "application/json" `
    -Body '{"action":"health"}'

if (-not $controllerHealth.ok) {
    throw "Authenticated controller health returned ok=false"
}
if ($controllerHealth.status -ne "online") {
    throw "Authenticated controller health is not online"
}
Write-Pass "Controller authenticated health passed"

$scoutJobId = [guid]::NewGuid().Guid
$scoutInsertSql = @"
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
  '$scoutJobId',
  'topic_scout',
  'topic_discovery',
  'queued',
  -1000,
  '{
    "request_id":"$scoutJobId",
    "language":"ru",
    "region":"EU",
    "topic_seed":"image enhancement",
    "constraints":{
      "min_score":0.7,
      "max_topics":3
    }
  }'::jsonb,
  3
);
"@

Invoke-LocalSql -Sql $scoutInsertSql | Out-Null

try {
    $scoutResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"topic_scout"}'

    if (-not $scoutResponse.ok) {
        throw "Controller Topic Scout dispatch returned ok=false"
    }
    if ($scoutResponse.action -ne "dispatch") {
        throw "Controller returned an unexpected Topic Scout action"
    }
    if ($scoutResponse.agent -ne "topic_scout") {
        throw "Controller returned an unexpected Topic Scout agent"
    }
    if (-not $scoutResponse.claimed) {
        throw "Controller Topic Scout dispatch claimed no job"
    }
    if ($scoutResponse.job_id -ne $scoutJobId) {
        throw "Controller Topic Scout dispatch claimed an unexpected job"
    }
    if ($scoutResponse.completed.status -ne "completed") {
        throw "Controller Topic Scout dispatch did not complete the scout job"
    }

    $insertedResearchJobs = @(
        $scoutResponse.scout.result.inserted_research_jobs
    )
    if ($insertedResearchJobs.Count -ne 1) {
        throw "Topic Scout must insert exactly one diagnostic research job"
    }

    $researchJobId = [string]$insertedResearchJobs[0].id
    if (-not $researchJobId) {
        throw "Topic Scout returned no research job id"
    }

    Write-Pass "Controller Topic Scout dispatch created a research job"

    $promoteResearchSql = @"
update public.jobs
set payload = jsonb_set(
  payload,
  '{recommended_action}',
  to_jsonb('investigate_referral_program'::text),
  true
)
where id = '$researchJobId'::uuid;

select payload->>'recommended_action'
from public.jobs
where id = '$researchJobId'::uuid;
"@

    $promotionResult = Invoke-LocalSql -Sql $promoteResearchSql
    if (
        $promotionResult[-1].Trim() -ne
            "investigate_referral_program"
    ) {
        throw "Unable to promote the diagnostic research job"
    }

    Write-Pass "Diagnostic research job promoted to a content candidate"

    $workerResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"research"}'

    if (-not $workerResponse.ok) {
        throw "Controller research dispatch returned ok=false"
    }
    if ($workerResponse.action -ne "dispatch") {
        throw "Controller returned an unexpected action"
    }
    if ($workerResponse.agent -ne "research") {
        throw "Controller returned an unexpected agent"
    }
    if (-not $workerResponse.claimed) {
        throw "Controller research dispatch claimed no job"
    }
    if ($workerResponse.job_id -ne $researchJobId) {
        throw "Controller research dispatch claimed an unexpected job"
    }
    if ($workerResponse.provider -ne "mock") {
        throw "Controller research dispatch did not use the mock provider"
    }
    if ($workerResponse.research.results_count -ne 1) {
        throw "Controller research dispatch returned an unexpected result count"
    }
    if (-not $workerResponse.content_job) {
        throw "Controller research dispatch created no content job"
    }

    $contentJobId = [string]$workerResponse.content_job.id
    if (-not $contentJobId) {
        throw "Controller research dispatch returned no content job id"
    }

    $expectedContentDedupeKey =
        "$researchJobId`:content_draft:https://example.local/research/ai-tools"

    if (
        $workerResponse.content_job.dedupeKey -ne
            $expectedContentDedupeKey
    ) {
        throw "Controller research dispatch returned an unexpected content dedupe key"
    }

    Write-Pass "Controller Research dispatch created a content job"

    $pipelineStateSql = @"
select agent || '|' || status || '|' || attempts
from public.jobs
where id = '$scoutJobId'::uuid
   or payload->>'request_id' = '$scoutJobId'
order by agent;
"@

    $pipelineState = Invoke-LocalSql -Sql $pipelineStateSql
    $pipelineStateText = $pipelineState -join "`n"
    if ($pipelineStateText -notmatch "research\|completed\|1") {
        throw "Research job did not persist completed|1"
    }
    if ($pipelineStateText -notmatch "content\|queued\|0") {
        throw "Content job did not persist queued|0"
    }
    if ($pipelineStateText -notmatch "topic_scout\|completed\|1") {
        throw "Topic Scout job did not persist completed|1"
    }

    Write-Pass "Controller three-agent queue pipeline passed"

    $contentResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"content"}'

    if (-not $contentResponse.ok) {
        throw "Controller Content dispatch returned ok=false"
    }
    if ($contentResponse.action -ne "dispatch") {
        throw "Controller returned an unexpected Content action"
    }
    if ($contentResponse.agent -ne "content") {
        throw "Controller returned an unexpected Content agent"
    }
    if (-not $contentResponse.claimed) {
        throw "Controller Content dispatch claimed no job"
    }
    if ($contentResponse.job_id -ne $contentJobId) {
        throw "Controller Content dispatch claimed an unexpected job"
    }
    if ($contentResponse.provider -ne "mock") {
        throw "Controller Content dispatch did not use the mock provider"
    }
    if (-not $contentResponse.content.created) {
        throw "Controller Content dispatch created no draft"
    }
    if (-not $contentResponse.qa_job) {
        throw "Controller Content dispatch created no QA job"
    }

    $qaJobId = [string]$contentResponse.qa_job.id
    if (-not $qaJobId) {
        throw "Controller Content dispatch returned no QA job id"
    }

    $expectedQaDedupeKey =
        "$($contentResponse.content.id):content_qa"

    if (
        $contentResponse.qa_job.dedupeKey -ne
            $expectedQaDedupeKey
    ) {
        throw "Controller Content dispatch returned an unexpected QA dedupe key"
    }

    Write-Pass "Controller Content dispatch created a QA job"

    $contentStateSql = @"
select
  j.status || '|' ||
  j.attempts || '|' ||
  c.status || '|' ||
  (c.id::text = j.result->>'content_id')
from public.jobs j
join public.content c
  on c.id = (j.result->>'content_id')::uuid
where j.id = '$contentJobId'::uuid
  and c.evidence->>'request_id' = '$scoutJobId';
"@

    $contentState = Invoke-LocalSql -Sql $contentStateSql
    $contentStateValue = [string](
        @($contentState) |
            Select-Object -Last 1
    )
    if ($contentStateValue.Trim() -ne "completed|1|draft|true") {
        throw "Content pipeline did not persist completed|1|draft|true"
    }

    Write-Pass "Controller Content dispatch completed a draft"

    $qaStateSql = @"
select status || '|' || attempts || '|' || task_type
from public.jobs
where id = '$qaJobId'::uuid;
"@

    $qaState = Invoke-LocalSql -Sql $qaStateSql
    $qaStateValue = [string](
        @($qaState) |
            Select-Object -Last 1
    )
    if ($qaStateValue.Trim() -ne "queued|0|content_qa") {
        throw "QA job did not persist queued|0|content_qa"
    }

    Write-Pass "QA job persisted as queued"

    $qaResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"qa"}'

    if (-not $qaResponse.ok) {
        throw "Controller QA dispatch returned ok=false"
    }
    if ($qaResponse.action -ne "dispatch") {
        throw "Controller QA dispatch returned an unexpected action"
    }
    if ($qaResponse.agent -ne "qa") {
        throw "Controller QA dispatch returned an unexpected agent"
    }
    if (-not $qaResponse.claimed) {
        throw "Controller QA dispatch claimed no job"
    }
    if ($qaResponse.job_id -ne $qaJobId) {
        throw "Controller QA dispatch claimed an unexpected job"
    }
    if ($qaResponse.qa.status -ne "approved") {
        throw "Controller QA dispatch did not approve the content"
    }
    if ([decimal]$qaResponse.qa.score -ne [decimal]1) {
        throw "Controller QA dispatch returned an unexpected score"
    }
    if ($qaResponse.reused) {
        throw "Controller QA dispatch unexpectedly reused a result"
    }

    Write-Pass "Controller QA dispatch approved the content"

    if (-not $qaResponse.publish_job) {
        throw "Controller QA dispatch created no Publisher job"
    }

    $publishJobId =
        [string]$qaResponse.publish_job.id

    if (-not $publishJobId) {
        throw "Controller QA dispatch returned no Publisher job id"
    }

    $expectedPublishDedupeKey =
        "$($contentResponse.content.id):content_publish"

    if (
        $qaResponse.publish_job.dedupeKey -ne
            $expectedPublishDedupeKey
    ) {
        throw (
            "Controller QA dispatch returned an unexpected " +
            "Publisher dedupe key"
        )
    }

    Write-Pass "Controller QA dispatch created a Publisher job"

    $publishStateSql = @"
select
  status || '|' ||
  attempts || '|' ||
  task_type || '|' ||
  (payload->>'content_id' = '$($contentResponse.content.id)')
from public.jobs
where id = '$publishJobId'::uuid;
"@

    $publishState =
        Invoke-LocalSql -Sql $publishStateSql

    $publishStateValue = [string](
        @($publishState) |
            Select-Object -Last 1
    )

    if (
        $publishStateValue.Trim() -ne
            "queued|0|content_publish|true"
    ) {
        throw (
            "Publisher job did not persist " +
            "queued|0|content_publish|true"
        )
    }

    Write-Pass "Publisher job persisted as queued"

    $publisherResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"publisher"}'

    if (-not $publisherResponse.ok) {
        throw "Controller Publisher dispatch returned ok=false"
    }
    if ($publisherResponse.action -ne "dispatch") {
        throw "Controller Publisher dispatch returned an unexpected action"
    }
    if ($publisherResponse.agent -ne "publisher") {
        throw "Controller Publisher dispatch returned an unexpected agent"
    }
    if (-not $publisherResponse.claimed) {
        throw "Controller Publisher dispatch claimed no job"
    }
    if ($publisherResponse.job_id -ne $publishJobId) {
        throw "Controller Publisher dispatch claimed an unexpected job"
    }
    if ($publisherResponse.provider -ne "mock") {
        throw "Controller Publisher dispatch did not use the mock provider"
    }
    if (
        $publisherResponse.publication.content_id -ne
            $contentResponse.content.id
    ) {
        throw "Controller Publisher returned an unexpected content id"
    }

    $expectedPublishedUrl =
        "https://example.local/published/$($contentResponse.content.slug)"

    if (
        $publisherResponse.publication.published_url -ne
            $expectedPublishedUrl
    ) {
        throw "Controller Publisher returned an unexpected URL"
    }
    if ($publisherResponse.reused) {
        throw "Controller Publisher unexpectedly reused a result"
    }

    Write-Pass "Controller Publisher dispatch published the content"

    $publishedStateSql = @"
select
  j.status || '|' ||
  j.attempts || '|' ||
  c.status || '|' ||
  (c.published_url = '$expectedPublishedUrl') || '|' ||
  (j.result->>'provider' = 'mock') || '|' ||
  (j.result->>'reused' = 'false')
from public.jobs j
join public.content c
  on c.id = (j.payload->>'content_id')::uuid
where j.id = '$publishJobId'::uuid;
"@

    $publishedState =
        Invoke-LocalSql -Sql $publishedStateSql

    $publishedStateValue = [string](
        @($publishedState) |
            Select-Object -Last 1
    )

    if (
        $publishedStateValue.Trim() -ne
            "completed|1|published|true|true|true"
    ) {
        throw (
            "Publisher pipeline did not persist " +
            "completed|1|published|true|true|true"
        )
    }

    Write-Pass "Publisher result persisted as published"

    $qaCompletedStateSql = @"
select
  j.status || '|' ||
  j.attempts || '|' ||
  c.status || '|' ||
  (c.qa_score = 1) || '|' ||
  (j.result->>'content_id' = c.id::text)
from public.jobs j
join public.content c
  on c.id = (j.payload->>'content_id')::uuid
where j.id = '$qaJobId'::uuid;
"@

    $qaCompletedState =
        Invoke-LocalSql -Sql $qaCompletedStateSql

    $qaCompletedStateValue = [string](
        @($qaCompletedState) |
            Select-Object -Last 1
    )

    if (
        $qaCompletedStateValue.Trim() -ne
            "completed|1|published|true|true"
    ) {
        throw (
            "QA pipeline did not persist " +
            "completed|1|published|true|true"
        )
    }

    Write-Pass "QA result remained valid after publication"
    Write-Pass "Controller eight-stage pipeline passed"
}
finally {
    $pipelineCleanupSql = @"
delete from public.content
where evidence->>'request_id' = '$scoutJobId';

delete from public.jobs
where id = '$scoutJobId'::uuid
   or payload->>'request_id' = '$scoutJobId';

select
  (select count(*)
   from public.jobs
   where id = '$scoutJobId'::uuid
      or payload->>'request_id' = '$scoutJobId')
  || '|' ||
  (select count(*)
   from public.content
   where evidence->>'request_id' = '$scoutJobId');
"@

    $pipelineCleanup = Invoke-LocalSql -Sql $pipelineCleanupSql
    $pipelineCleanupValue = [string](
        @($pipelineCleanup) |
            Select-Object -Last 1
    )
    if ($pipelineCleanupValue.Trim() -ne "0|0") {
        throw "Eight-stage pipeline cleanup left diagnostic rows behind"
    }
}

Write-Pass "Eight-stage pipeline diagnostic rows cleaned up"
Write-Host "RESULT: PASS" -ForegroundColor Green
