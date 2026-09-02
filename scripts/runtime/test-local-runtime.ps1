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
$programId = "00000000-0000-0000-0000-000000000000"
$referralLinkId = "00000000-0000-0000-0000-000000000000"
$runtimeProgramUrl =
    "https://example.local/runtime-program/$scoutJobId"
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
  jsonb_set(
    payload,
    '{recommended_action}',
    to_jsonb('investigate_referral_program'::text),
    true
  ),
  '{candidate,url}',
  to_jsonb('$runtimeProgramUrl'::text),
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
    if (-not $workerResponse.program) {
        throw "Controller research dispatch created no program candidate"
    }
    if (-not $workerResponse.program.created) {
        throw "Controller research dispatch did not create a new program"
    }
    if ($workerResponse.program.status -ne "candidate") {
        throw "Controller research dispatch returned an unexpected program status"
    }

    $programId = [string]$workerResponse.program.id
    if (-not $programId) {
        throw "Controller research dispatch returned no program id"
    }
    if (-not $workerResponse.referral_link) {
        throw "Controller research dispatch created no referral link"
    }
    if (-not $workerResponse.referral_link.created) {
        throw "Controller research dispatch did not create a new referral link"
    }
    if ($workerResponse.referral_link.status -ne "paused") {
        throw "Discovered referral link was not paused"
    }
    if ($workerResponse.referral_link.program_id -ne $programId) {
        throw "Referral link was connected to an unexpected program"
    }

    $referralLinkId =
        [string]$workerResponse.referral_link.id
    if (-not $referralLinkId) {
        throw "Controller research dispatch returned no referral link id"
    }

    $programStateSql = @"
select
  p.status || '|' ||
  r.status || '|' ||
  (r.program_id = p.id) || '|' ||
  (p.notes::jsonb->>'request_id' = '$scoutJobId')
from public.programs p
join public.referral_links r
  on r.program_id = p.id
where p.id = '$programId'::uuid
  and r.id = '$referralLinkId'::uuid
  and p.official_url = '$runtimeProgramUrl';
"@

    $programState =
        Invoke-LocalSql -Sql $programStateSql
    $programStateValue = [string](
        @($programState) |
            Select-Object -Last 1
    )

    if (
        $programStateValue.Trim() -ne
            "candidate|paused|true|true"
    ) {
        throw "Program and referral link state was not persisted correctly"
    }

    Write-Pass "Research result persisted a candidate program"
    Write-Pass "Research result persisted a paused referral link"
    if (-not $workerResponse.content_job) {
        throw "Controller research dispatch created no content job"
    }

    $contentJobId = [string]$workerResponse.content_job.id
    if (-not $contentJobId) {
        throw "Controller research dispatch returned no content job id"
    }

    $expectedContentDedupeKey =
        "$researchJobId`:content_draft:$runtimeProgramUrl"

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

    $activateExistingLinkSql = @"
update public.referral_links
set
  status = 'active',
  updated_at = now()
where id = '$referralLinkId'::uuid;
"@

    Invoke-LocalSql -Sql $activateExistingLinkSql |
        Out-Null

    $verifiedReferralUrl =
        "$runtimeProgramUrl/referral?verified=runtime"
    $programTermsUrl =
        "$runtimeProgramUrl/terms"

    $activationBody = @{
        action = "activate_program"
        program_id = $programId
        affiliate_url = $verifiedReferralUrl
        terms_url = $programTermsUrl
        commission_type = "percentage"
        commission_value = 25
        recurring = $true
        cookie_duration_days = 30
        countries = @("us", "GR", "US")
        verified_by = "local-runtime-auditor"
        verification_note =
            "Verified by the permanent local runtime test"
    } | ConvertTo-Json -Depth 8

    $activationUnauthorizedStatus = $null

    try {
        $activationUnauthorizedResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
            -ContentType "application/json" `
            -Body $activationBody

        $activationUnauthorizedStatus =
            [int]$activationUnauthorizedResponse.StatusCode
    }
    catch {
        if ($_.Exception.Response) {
            $activationUnauthorizedStatus =
                [int]$_.Exception.Response.StatusCode
        }
        else {
            throw
        }
    }

    if ($activationUnauthorizedStatus -ne 401) {
        throw (
            "Unauthenticated program activation must " +
            "return HTTP 401"
        )
    }

    Write-Pass "Controller rejects unauthenticated program activation"

    $activationResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body $activationBody

    if (-not $activationResponse.ok) {
        throw "Controller program activation returned ok=false"
    }
    if ($activationResponse.action -ne "activate_program") {
        throw "Controller returned an unexpected activation action"
    }
    if (
        $activationResponse.activation.program_id -ne
            $programId
    ) {
        throw "Controller activated an unexpected program"
    }
    if (
        $activationResponse.activation.program_status -ne
            "active"
    ) {
        throw "Controller did not activate the program"
    }
    if (-not $activationResponse.activation.terms_verified) {
        throw "Controller did not verify the program terms"
    }
    if (
        $activationResponse.activation.referral_link_status -ne
            "active"
    ) {
        throw "Controller did not activate the verified referral link"
    }

    $verifiedReferralLinkId = [string](
        $activationResponse.activation.referral_link_id
    )
    if (-not $verifiedReferralLinkId) {
        throw "Controller activation returned no referral link id"
    }

    Write-Pass "Controller authenticated program activation passed"

    $activationStateSql = @"
select
  p.status || '|' ||
  p.terms_verified || '|' ||
  p.commission_type || '|' ||
  p.commission_value || '|' ||
  p.recurring || '|' ||
  p.cookie_duration_days || '|' ||
  (p.countries = '["US", "GR"]'::jsonb) || '|' ||
  (p.affiliate_url = '$verifiedReferralUrl') || '|' ||
  (p.terms_url = '$programTermsUrl') || '|' ||
  (
    p.notes::jsonb->'activation'->>'verified_by' =
      'local-runtime-auditor'
  ) || '|' ||
  (
    select status
    from public.referral_links
    where id = '$referralLinkId'::uuid
  ) || '|' ||
  (
    select count(*)
    from public.referral_links
    where program_id = p.id
      and id = '$verifiedReferralLinkId'::uuid
      and url = '$verifiedReferralUrl'
      and status = 'active'
      and source = 'verified_activation'
      and placement = 'program_activation'
  )
from public.programs p
where p.id = '$programId'::uuid;
"@

    $activationState =
        Invoke-LocalSql -Sql $activationStateSql
    $activationStateValue = [string](
        @($activationState) |
            Select-Object -Last 1
    )

    if (
        $activationStateValue.Trim() -ne
            "active|true|percentage|25.00|true|30|" +
            "true|true|true|true|paused|1"
    ) {
        throw (
            "Program activation state was not persisted " +
            "correctly: $activationStateValue"
        )
    }

    Write-Pass "Program activation state persisted correctly"

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
    if (-not $publisherResponse.publication.monetization) {
        throw "Controller Publisher returned no monetization placement"
    }
    if (
        $publisherResponse.publication.monetization.program_id -ne
            $programId
    ) {
        throw "Controller Publisher monetized with an unexpected program"
    }
    if (
        $publisherResponse.publication.monetization.referral_link_id -ne
            $verifiedReferralLinkId
    ) {
        throw "Controller Publisher monetized with an unexpected link"
    }

    Write-Pass "Controller Publisher dispatch published the content"
    Write-Pass "Controller Publisher selected verified monetization"

    $publishedStateSql = @"
select
  j.status || '|' ||
  j.attempts || '|' ||
  c.status || '|' ||
  (c.published_url = '$expectedPublishedUrl') || '|' ||
  (c.program_id = '$programId'::uuid) || '|' ||
  (c.referral_link_id = '$verifiedReferralLinkId'::uuid) || '|' ||
  (c.monetized_at is not null) || '|' ||
  (position('vyra-monetization:' in c.body) > 0) || '|' ||
  (position('$verifiedReferralUrl' in c.body) > 0) || '|' ||
  (
    position(
      U&'\041C\0430\0442\0435\0440\0438\0430\043B'
      in c.body
    ) > 0
  ) || '|' ||
  (j.result->>'provider' = 'mock') || '|' ||
  (
    j.result->'monetization'->>'referral_link_id' =
      '$verifiedReferralLinkId'
  ) || '|' ||
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
            "completed|1|published|true|true|true|true|true|" +
            "true|true|true|true|true"
    ) {
        throw (
            "Publisher pipeline did not persist " +
            "the verified monetization state: " +
            $publishedStateValue
        )
    }

    Write-Pass "Publisher result persisted as published"
    Write-Pass "Publisher monetization persisted correctly"

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

    $duplicateResearchJobId = [guid]::NewGuid().Guid
    $duplicateResearchSql = @"
insert into public.jobs (
  id,
  agent,
  task_type,
  status,
  priority,
  payload,
  max_attempts
)
select
  '$duplicateResearchJobId'::uuid,
  agent,
  task_type,
  'queued',
  -1000,
  payload,
  max_attempts
from public.jobs
where id = '$researchJobId'::uuid;
"@

    Invoke-LocalSql -Sql $duplicateResearchSql |
        Out-Null

    $duplicateResearchResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"research"}'

    if (-not $duplicateResearchResponse.ok) {
        throw "Duplicate research dispatch returned ok=false"
    }
    if (
        $duplicateResearchResponse.job_id -ne
            $duplicateResearchJobId
    ) {
        throw "Duplicate research dispatch claimed an unexpected job"
    }
    if (
        $duplicateResearchResponse.program.id -ne
            $programId -or
        $duplicateResearchResponse.program.created
    ) {
        throw "Duplicate research dispatch did not reuse the program"
    }
    if (
        $duplicateResearchResponse.referral_link.id -ne
            $verifiedReferralLinkId -or
        $duplicateResearchResponse.referral_link.created
    ) {
        throw "Duplicate research dispatch did not reuse the referral link"
    }

    $dedupeStateSql = @"
select
  (select count(*)
   from public.programs
   where official_url = '$runtimeProgramUrl')
  || '|' ||
  (select count(*)
   from public.referral_links
   where program_id = '$programId'::uuid
     and url = 'https://example.local/referral-program');
"@

    $dedupeState =
        Invoke-LocalSql -Sql $dedupeStateSql
    $dedupeStateValue = [string](
        @($dedupeState) |
            Select-Object -Last 1
    )

    if ($dedupeStateValue.Trim() -ne "1|1") {
        throw "Program or referral link dedupe check failed"
    }

    Write-Pass "Repeated research reused the program and referral link"
    Write-Pass "Controller nine-stage monetized pipeline passed"
}
finally {
    $pipelineCleanupSql = @"
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
   where evidence->>'request_id' = '$scoutJobId')
  || '|' ||
  (select count(*)
   from public.programs
   where official_url = '$runtimeProgramUrl')
  || '|' ||
  (select count(*)
   from public.referral_links
   where id = '$referralLinkId'::uuid);
"@

    $pipelineCleanup = Invoke-LocalSql -Sql $pipelineCleanupSql
    $pipelineCleanupValue = [string](
        @($pipelineCleanup) |
            Select-Object -Last 1
    )
    if ($pipelineCleanupValue.Trim() -ne "0|0|0|0") {
        throw "Nine-stage monetized pipeline cleanup left diagnostic rows behind"
    }
}

Write-Pass "Nine-stage monetized pipeline diagnostic rows cleaned up"
$analyticsProgramId =
    "00000000-0000-4000-8000-000000001000"
$analyticsLinkId =
    "00000000-0000-4000-8000-000000001001"
$analyticsJobId =
    "00000000-0000-4000-8000-000000001002"
$analyticsRequestId =
    "00000000-0000-4000-8000-000000001009"

$analyticsSetupSql = @"
insert into public.programs (
  id,
  name,
  official_url,
  status,
  countries,
  terms_verified
)
values (
  '$analyticsProgramId'::uuid,
  'Runtime Analytics Program',
  'https://example.local/runtime-program',
  'active',
  '["EU"]'::jsonb,
  true
);

insert into public.referral_links (
  id,
  program_id,
  name,
  url,
  source,
  placement,
  status
)
values (
  '$analyticsLinkId'::uuid,
  '$analyticsProgramId'::uuid,
  'Runtime Analytics Link',
  'https://example.local/ref/runtime',
  'runtime-test',
  'diagnostic',
  'active'
);

insert into public.analytics_events (
  id,
  event_type,
  referral_link_id,
  session_id,
  source,
  value,
  created_at
)
values
(
  '00000000-0000-4000-8000-000000001003'::uuid,
  'referral_click',
  '$analyticsLinkId'::uuid,
  'runtime-analytics-1',
  'runtime-test',
  0,
  '2026-08-31T07:00:00Z'
),
(
  '00000000-0000-4000-8000-000000001004'::uuid,
  'referral_click',
  '$analyticsLinkId'::uuid,
  'runtime-analytics-2',
  'runtime-test',
  0,
  '2026-08-31T08:00:00Z'
),
(
  '00000000-0000-4000-8000-000000001005'::uuid,
  'conversion',
  '$analyticsLinkId'::uuid,
  'runtime-analytics-2',
  'runtime-test',
  0,
  '2026-08-31T09:00:00Z'
),
(
  '00000000-0000-4000-8000-000000001006'::uuid,
  'commission',
  '$analyticsLinkId'::uuid,
  'runtime-analytics-2',
  'runtime-test',
  12.34,
  '2026-08-31T09:01:00Z'
),
(
  '00000000-0000-4000-8000-000000001007'::uuid,
  'commission',
  '$analyticsLinkId'::uuid,
  'runtime-analytics-2',
  'runtime-test',
  7.66,
  '2026-08-31T09:02:00Z'
);

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
  '$analyticsJobId'::uuid,
  'analytics',
  'referral_rollup',
  'queued',
  -1000,
  jsonb_build_object(
    'request_id', '$analyticsRequestId',
    'scope', 'all',
    '_meta', jsonb_build_object(
      'dedupe_key',
      '${analyticsRequestId}:referral_rollup'
    )
  ),
  3
);
"@

try {
    Invoke-LocalSql -Sql $analyticsSetupSql | Out-Null

    $analyticsResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"analytics"}'

    if (-not $analyticsResponse.ok) {
        throw "Controller Analytics dispatch returned ok=false"
    }
    if ($analyticsResponse.action -ne "dispatch") {
        throw "Controller Analytics returned an unexpected action"
    }
    if ($analyticsResponse.agent -ne "analytics") {
        throw "Controller Analytics returned an unexpected agent"
    }
    if (-not $analyticsResponse.claimed) {
        throw "Controller Analytics claimed no job"
    }
    if ($analyticsResponse.job_id -ne $analyticsJobId) {
        throw "Controller Analytics claimed an unexpected job"
    }

    $analytics = $analyticsResponse.analytics

    if (
        $analytics.links_processed -ne 1 -or
        $analytics.events_processed -ne 5 -or
        $analytics.clicks -ne 2 -or
        $analytics.conversions -ne 1 -or
        [decimal]$analytics.revenue -ne [decimal]20
    ) {
        throw "Controller Analytics returned unexpected metrics"
    }

    Write-Pass "Controller Analytics dispatch calculated metrics"

    $analyticsStateSql = @"
select
  j.status || '|' ||
  j.attempts || '|' ||
  r.clicks || '|' ||
  r.conversions || '|' ||
  r.revenue
from public.jobs j
cross join public.referral_links r
where j.id = '$analyticsJobId'::uuid
  and r.id = '$analyticsLinkId'::uuid;
"@

    $analyticsState =
        Invoke-LocalSql -Sql $analyticsStateSql

    $analyticsStateValue = [string](
        @($analyticsState) |
            Select-Object -Last 1
    )

    if (
        $analyticsStateValue.Trim() -ne
            "completed|1|2|1|20.00"
    ) {
        throw (
            "Analytics pipeline did not persist " +
            "completed|1|2|1|20.00"
        )
    }

    Write-Pass "Analytics metrics persisted correctly"
}
finally {
    $analyticsCleanupSql = @"
delete from public.jobs
where id = '$analyticsJobId'::uuid;

delete from public.analytics_events
where referral_link_id = '$analyticsLinkId'::uuid;

delete from public.referral_links
where id = '$analyticsLinkId'::uuid;

delete from public.programs
where id = '$analyticsProgramId'::uuid;

select
  (select count(*)
   from public.jobs
   where id = '$analyticsJobId'::uuid)
  || '|' ||
  (select count(*)
   from public.analytics_events
   where referral_link_id = '$analyticsLinkId'::uuid)
  || '|' ||
  (select count(*)
   from public.referral_links
   where id = '$analyticsLinkId'::uuid)
  || '|' ||
  (select count(*)
   from public.programs
   where id = '$analyticsProgramId'::uuid);
"@

    $analyticsCleanup =
        Invoke-LocalSql -Sql $analyticsCleanupSql

    $analyticsCleanupValue = [string](
        @($analyticsCleanup) |
            Select-Object -Last 1
    )

    if ($analyticsCleanupValue.Trim() -ne "0|0|0|0") {
        throw "Analytics cleanup left diagnostic rows behind"
    }
}

Write-Pass "Analytics diagnostic rows cleaned up"
$attributionProgramId =
    "00000000-0000-4000-8000-000000001900"
$attributionLinkId =
    "00000000-0000-4000-8000-000000001901"
$attributionContentId =
    "00000000-0000-4000-8000-000000001902"
$attributionJobId =
    "00000000-0000-4000-8000-000000001903"
$attributionRequestId =
    "00000000-0000-4000-8000-000000001909"
$attributionDedupePrefix =
    "runtime:controller-attribution:1900"

$attributionSetupSql = @"
insert into public.programs (
  id, name, official_url, status, countries, terms_verified
)
values (
  '$attributionProgramId'::uuid,
  'Runtime Attributed Analytics Program',
  'https://example.local/attributed-analytics-program',
  'active',
  '["EU"]'::jsonb,
  true
);

insert into public.referral_links (
  id, program_id, name, url, source, placement, status
)
values (
  '$attributionLinkId'::uuid,
  '$attributionProgramId'::uuid,
  'Runtime Attributed Analytics Link',
  'https://example.local/ref/attributed-analytics',
  'verified_activation',
  'program_activation',
  'active'
);

insert into public.content (
  id, title, slug, status, evidence, published_url,
  published_at, program_id, referral_link_id, monetized_at
)
values (
  '$attributionContentId'::uuid,
  'Runtime Attributed Analytics Content',
  'runtime-attributed-analytics-content',
  'published',
  '{}'::jsonb,
  'https://example.local/published/runtime-attributed-analytics-content',
  now(),
  '$attributionProgramId'::uuid,
  '$attributionLinkId'::uuid,
  now()
);

insert into public.jobs (
  id, agent, task_type, status, priority, payload, max_attempts
)
values (
  '$attributionJobId'::uuid,
  'analytics',
  'referral_rollup',
  'queued',
  -3000,
  jsonb_build_object(
    'request_id', '$attributionRequestId',
    'scope', 'all',
    '_meta', jsonb_build_object(
      'dedupe_key',
      '${attributionRequestId}:referral_rollup'
    )
  ),
  3
);
"@

try {
    Invoke-LocalSql -Sql $attributionSetupSql | Out-Null

    $clickRequest = @{
        action = "record_analytics_event"
        content_id = $attributionContentId
        dedupe_key = "$attributionDedupePrefix`:click"
        event_type = "referral_click"
        occurred_at = "2026-09-02T07:00:00Z"
        session_id = "runtime-attribution-session"
        country = "gr"
        language = "RU"
        source = "controller-runtime-test"
        metadata = @{ placement = "article-cta" }
        value = 0
    }

    $clickBody = $clickRequest | ConvertTo-Json -Depth 8
    $attributionUnauthorizedStatus = $null

    try {
        $attributionUnauthorizedResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
            -ContentType "application/json" `
            -Body $clickBody

        $attributionUnauthorizedStatus =
            [int]$attributionUnauthorizedResponse.StatusCode
    }
    catch {
        if ($_.Exception.Response) {
            $attributionUnauthorizedStatus =
                [int]$_.Exception.Response.StatusCode
        }
        else {
            throw
        }
    }

    if ($attributionUnauthorizedStatus -ne 401) {
        throw (
            "Unauthenticated analytics attribution must " +
            "return HTTP 401"
        )
    }

    Write-Pass "Controller rejects unauthenticated analytics attribution"

    $controllerHeaders = @{ apikey = $controllerSecret }
    $clickResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers $controllerHeaders `
        -ContentType "application/json" `
        -Body $clickBody

    if (-not $clickResponse.ok -or $clickResponse.reused) {
        throw "Controller did not create the attributed referral click"
    }

    $reusedClickResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers $controllerHeaders `
        -ContentType "application/json" `
        -Body $clickBody

    if (
        -not $reusedClickResponse.ok -or
        -not $reusedClickResponse.reused -or
        $reusedClickResponse.event.id -ne $clickResponse.event.id
    ) {
        throw "Repeated attributed referral click was not reused"
    }

    Write-Pass "Controller attributed referral click and reused its dedupe key"

    $collisionRequest = @{} + $clickRequest
    $collisionRequest.event_type = "conversion"
    $collisionBody = $collisionRequest | ConvertTo-Json -Depth 8
    $collisionStatus = $null

    try {
        $collisionResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
            -Headers $controllerHeaders `
            -ContentType "application/json" `
            -Body $collisionBody

        $collisionStatus = [int]$collisionResponse.StatusCode
    }
    catch {
        if ($_.Exception.Response) {
            $collisionStatus =
                [int]$_.Exception.Response.StatusCode
        }
        else {
            throw
        }
    }

    if ($collisionStatus -ne 409) {
        throw "Analytics dedupe collision must return HTTP 409"
    }

    Write-Pass "Controller rejects analytics attribution dedupe collisions"

    $conversionRequest = @{} + $clickRequest
    $conversionRequest.dedupe_key =
        "$attributionDedupePrefix`:conversion"
    $conversionRequest.event_type = "conversion"
    $conversionRequest.occurred_at =
        "2026-09-02T07:01:00Z"

    $commissionRequest = @{} + $clickRequest
    $commissionRequest.dedupe_key =
        "$attributionDedupePrefix`:commission"
    $commissionRequest.event_type = "commission"
    $commissionRequest.occurred_at =
        "2026-09-02T07:02:00Z"
    $commissionRequest.value = 18.75

    foreach ($eventRequest in @(
        $conversionRequest,
        $commissionRequest
    )) {
        $eventResponse = Invoke-RestMethod `
            -Method Post `
            -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
            -Headers $controllerHeaders `
            -ContentType "application/json" `
            -Body ($eventRequest | ConvertTo-Json -Depth 8)

        if (-not $eventResponse.ok -or $eventResponse.reused) {
            throw "Controller did not create an attributed analytics event"
        }
    }

    $attributionResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers $controllerHeaders `
        -ContentType "application/json" `
        -Body '{"action":"dispatch","agent":"analytics"}'

    if (
        -not $attributionResponse.ok -or
        -not $attributionResponse.claimed -or
        $attributionResponse.job_id -ne $attributionJobId
    ) {
        throw "Controller did not dispatch attributed analytics"
    }

    $attributionMetrics = $attributionResponse.analytics
    if (
        $attributionMetrics.links_processed -ne 1 -or
        $attributionMetrics.events_processed -ne 3 -or
        $attributionMetrics.clicks -ne 1 -or
        $attributionMetrics.conversions -ne 1 -or
        [decimal]$attributionMetrics.revenue -ne [decimal]18.75
    ) {
        throw "Attributed analytics returned unexpected metrics"
    }

    Write-Pass "Controller Analytics rolled up attributed events"

    $attributionStateSql = @"
select
  j.status || '|' ||
  j.attempts || '|' ||
  r.clicks || '|' ||
  r.conversions || '|' ||
  r.revenue || '|' ||
  count(e.id) || '|' ||
  count(distinct e.dedupe_key) || '|' ||
  bool_and(e.content_id = '$attributionContentId'::uuid)
from public.jobs j
cross join public.referral_links r
join public.analytics_events e
  on e.referral_link_id = r.id
where j.id = '$attributionJobId'::uuid
  and r.id = '$attributionLinkId'::uuid
group by j.status, j.attempts, r.clicks,
  r.conversions, r.revenue;
"@

    $attributionState =
        Invoke-LocalSql -Sql $attributionStateSql
    $attributionStateValue = [string](
        @($attributionState) |
            Select-Object -Last 1
    )

    if (
        $attributionStateValue.Trim() -ne
            "completed|1|1|1|18.75|3|3|true"
    ) {
        throw (
            "Attributed analytics state was not persisted: " +
            $attributionStateValue
        )
    }

    Write-Pass "Attributed analytics metrics persisted correctly"
}
finally {
    $attributionCleanupSql = @"
delete from public.jobs
where id = '$attributionJobId'::uuid;

delete from public.analytics_events
where dedupe_key like '${attributionDedupePrefix}:%'
   or content_id = '$attributionContentId'::uuid;

delete from public.content
where id = '$attributionContentId'::uuid;

delete from public.referral_links
where id = '$attributionLinkId'::uuid;

delete from public.programs
where id = '$attributionProgramId'::uuid;

select
  (select count(*) from public.jobs
   where id = '$attributionJobId'::uuid)
  || '|' ||
  (select count(*) from public.analytics_events
   where dedupe_key like '${attributionDedupePrefix}:%'
      or content_id = '$attributionContentId'::uuid)
  || '|' ||
  (select count(*) from public.content
   where id = '$attributionContentId'::uuid)
  || '|' ||
  (select count(*) from public.referral_links
   where id = '$attributionLinkId'::uuid)
  || '|' ||
  (select count(*) from public.programs
   where id = '$attributionProgramId'::uuid);
"@

    $attributionCleanup =
        Invoke-LocalSql -Sql $attributionCleanupSql
    $attributionCleanupValue = [string](
        @($attributionCleanup) |
            Select-Object -Last 1
    )

    if ($attributionCleanupValue.Trim() -ne "0|0|0|0|0") {
        throw "Attributed analytics cleanup left diagnostic rows behind"
    }
}

Write-Pass "Attributed analytics diagnostic rows cleaned up"
Write-Host "RESULT: PASS" -ForegroundColor Green
