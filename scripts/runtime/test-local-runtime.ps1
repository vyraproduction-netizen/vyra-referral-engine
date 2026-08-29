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

$workerJobId = [guid]::NewGuid().Guid
$workerInsertSql = @"
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
  '$workerJobId',
  'research',
  'topic_research',
  'queued',
  -1000,
  '{
    "request_id":"$workerJobId",
    "language":"ru",
    "region":"EU",
    "topic_seed":"diagnostic image enhancement",
    "candidate":{
      "title":"Diagnostic mock candidate",
      "url":"https://example.local/runtime-worker",
      "opportunity_score":0.8,
      "commercial_intent":0.8,
      "content_potential":0.8,
      "referral_potential":0.8,
      "relevance":0.8,
      "evidence_source":"local-diagnostic"
    },
    "recommended_action":"investigate_referral_program",
    "_meta":{
      "dedupe_key":"diagnostic:research-worker:$workerJobId"
    }
  }'::jsonb,
  3
);
"@

Invoke-LocalSql -Sql $workerInsertSql | Out-Null

try {
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
    if ($workerResponse.job_id -ne $workerJobId) {
        throw "Controller research dispatch claimed an unexpected job"
    }
    if ($workerResponse.provider -ne "mock") {
        throw "Controller research dispatch did not use the mock provider"
    }
    if ($workerResponse.research.results_count -ne 1) {
        throw "Controller research dispatch returned an unexpected result count"
    }

    $workerStateSql = @"
select status || '|' || attempts || '|' ||
       coalesce(result->'research'->>'results_count', '')
from public.jobs
where id = '$workerJobId'::uuid;
"@

    $workerState = Invoke-LocalSql -Sql $workerStateSql
    $workerStateValue = [string](
        $workerState |
            Select-Object -Last 1
    )
    if ($workerStateValue.Trim() -ne "completed|1|1") {
        throw "Controller research dispatch did not persist completed|1|1"
    }

    Write-Pass "Controller Research dispatch completion passed"
}
finally {
    $workerCleanupSql = @"
delete from public.jobs
where id = '$workerJobId'::uuid;

select count(*)
from public.jobs
where id = '$workerJobId'::uuid;
"@

    $workerCleanup = Invoke-LocalSql -Sql $workerCleanupSql
    if ($workerCleanup[-1].Trim() -ne "0") {
        throw "Controller dispatch cleanup left a diagnostic row behind"
    }
}

Write-Pass "Controller dispatch diagnostic row cleaned up"
Write-Host "RESULT: PASS" -ForegroundColor Green
