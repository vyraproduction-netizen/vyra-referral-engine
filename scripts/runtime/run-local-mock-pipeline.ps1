param(
    [string]$ProjectRoot = (
        Split-Path -Parent (
            Split-Path -Parent $PSScriptRoot
        )
    ),

    [string]$RuntimeRoot = "C:\VYRA-LOCAL",

    [string]$SupabaseUrl = "http://127.0.0.1:55321",

    [string]$DatabaseContainer =
        "supabase_db_vyra-local-permanent",

    [string]$TopicSeed = "image enhancement"
)

$ErrorActionPreference = "Stop"

function Get-LocalEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvFile,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        return $null
    }

    $pattern = "^\s*$([regex]::Escape($Name))\s*="

    $line = Get-Content -LiteralPath $EnvFile |
        Where-Object { $_ -match $pattern } |
        Select-Object -Last 1

    if (-not $line) {
        return $null
    }

    return (
        $line -replace $pattern, ""
    ).Trim().Trim('"').Trim("'")
}

function Invoke-LocalSql {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sql
    )

    $output = $Sql | & docker exec -i $DatabaseContainer `
        psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At

    if ($LASTEXITCODE -ne 0) {
        throw (
            "Local PostgreSQL command failed with exit code " +
            $LASTEXITCODE
        )
    }

    return @($output)
}

function Get-LastSqlValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sql
    )

    return [string](
        @(Invoke-LocalSql -Sql $Sql) |
            Select-Object -Last 1
    ).Trim()
}

function Test-DispatchJobIdentity {
    param(
        [object]$ResponseJobId,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedJobId
    )

    $reportedJobId = ([string]$ResponseJobId).Trim()

    if ($reportedJobId) {
        return $reportedJobId -eq $ExpectedJobId.Trim()
    }

    $persistedStatus = Get-LastSqlValue `
        -Sql (
            "select status from public.jobs " +
            "where id = '$ExpectedJobId'::uuid"
        )

    return $persistedStatus -eq "completed"
}

function Invoke-Controller {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Body
    )

    return Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/functions/v1/vyra-controller" `
        -Headers @{ apikey = $controllerSecret } `
        -ContentType "application/json" `
        -Body $Body
}

$uri = $null

if (
    -not [System.Uri]::TryCreate(
        $SupabaseUrl,
        [System.UriKind]::Absolute,
        [ref]$uri
    )
) {
    throw "SupabaseUrl is invalid: $SupabaseUrl"
}

if (
    $uri.Host -notin @(
        "127.0.0.1",
        "localhost",
        "::1"
    )
) {
    throw "This script allows only a local Supabase URL"
}

$containerRunning = (
    & docker inspect `
        --format "{{.State.Running}}" `
        $DatabaseContainer
)

if ($LASTEXITCODE -ne 0 -or $containerRunning.Trim() -ne "true") {
    throw (
        "Local PostgreSQL container is not running: " +
        $DatabaseContainer
    )
}

$localEnvPath = Join-Path `
    $RuntimeRoot `
    "supabase\functions\.env"

foreach ($providerName in @(
    "CONTENT_PROVIDER",
    "RESEARCH_PROVIDER",
    "PUBLISH_PROVIDER"
)) {
    $providerValue = Get-LocalEnvValue `
        -EnvFile $localEnvPath `
        -Name $providerName

    if ($providerValue -ne "mock") {
        throw (
            "$providerName must be mock for this local pipeline; " +
            "actual value: $providerValue"
        )
    }
}

$controllerSecret = Get-LocalEnvValue `
    -EnvFile $localEnvPath `
    -Name "VYRA_CONTROLLER_SECRET"

if (-not $controllerSecret) {
    throw (
        "VYRA_CONTROLLER_SECRET is required in: " +
        $localEnvPath
    )
}

$scoutJobId = [guid]::NewGuid().Guid
$runtimeTopicSeed = "$TopicSeed $scoutJobId"
$runtimeProgramUrl = (
    "https://example.local/research/ai-tools-pricing/" +
    [uri]::EscapeDataString($runtimeTopicSeed)
)

$scoutPayload = @{
    request_id = $scoutJobId
    language = "ru"
    region = "EU"
    topic_seed = $runtimeTopicSeed
    constraints = @{
        min_score = 0.7
        max_topics = 3
    }
}

$payloadJson = $scoutPayload |
    ConvertTo-Json -Depth 8 -Compress

$payloadSql = $payloadJson.Replace("'", "''")

$insertScoutSql = @"
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
  3
);
"@

Invoke-LocalSql -Sql $insertScoutSql | Out-Null

Write-Host "=== VYRA local mock pipeline ===" -ForegroundColor Cyan
Write-Host "Target: $SupabaseUrl"
Write-Host "Source: local mock providers only"
Write-Host "Topic Scout job: $scoutJobId"
Write-Host ""

$scoutResponse = Invoke-Controller `
    -Body '{"action":"dispatch","agent":"topic_scout"}'

if (
    -not $scoutResponse.ok -or
    -not $scoutResponse.claimed -or
    -not (
        Test-DispatchJobIdentity `
            -ResponseJobId $scoutResponse.job_id `
            -ExpectedJobId $scoutJobId
    )
) {
    throw "Topic Scout dispatch did not claim the created job"
}

$researchJobId = Get-LastSqlValue -Sql @"
select id
from public.jobs
where agent = 'research'
  and task_type = 'topic_research'
  and status = 'queued'
  and payload->>'request_id' = '$scoutJobId'
order by created_at desc
limit 1;
"@

if (-not $researchJobId) {
    throw "Topic Scout created no queued Research job"
}

Write-Host "[PASS] Topic Scout completed: $scoutJobId" `
    -ForegroundColor Green
Write-Host "[PASS] Research job created: $researchJobId" `
    -ForegroundColor Green

$researchResponse = Invoke-Controller `
    -Body '{"action":"dispatch","agent":"research"}'

if (
    -not $researchResponse.ok -or
    -not $researchResponse.claimed -or
    -not (
        Test-DispatchJobIdentity `
            -ResponseJobId $researchResponse.job_id `
            -ExpectedJobId $researchJobId
    )
) {
    throw "Research dispatch did not claim the expected job"
}

if ($researchResponse.provider -ne "mock") {
    throw "Research dispatch did not use the mock provider"
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

$programState = Get-LastSqlValue -Sql @"
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

if ($programState -ne "candidate|paused|true|true") {
    throw "Research result was not persisted correctly: $programState"
}

Write-Host "[PASS] Research completed: $researchJobId" `
    -ForegroundColor Green
Write-Host "[PASS] Candidate program: $programId" `
    -ForegroundColor Green
Write-Host "[PASS] Paused referral link: $referralLinkId" `
    -ForegroundColor Green
Write-Host "[PASS] Content job created: $contentJobId" `
    -ForegroundColor Green

$contentResponse = Invoke-Controller `
    -Body '{"action":"dispatch","agent":"content"}'

if (
    -not $contentResponse.ok -or
    -not $contentResponse.claimed -or
    -not (
        Test-DispatchJobIdentity `
            -ResponseJobId $contentResponse.job_id `
            -ExpectedJobId $contentJobId
    )
) {
    throw "Content dispatch did not claim the expected job"
}

$qaJobId = [string]$contentResponse.qa_job.id

if (-not $qaJobId) {
    throw "Content response omitted the QA job"
}

Write-Host "[PASS] Content completed: $contentJobId" `
    -ForegroundColor Green
Write-Host "[PASS] QA job created: $qaJobId" `
    -ForegroundColor Green

$qaResponse = Invoke-Controller `
    -Body '{"action":"dispatch","agent":"qa"}'

if (
    -not $qaResponse.ok -or
    -not $qaResponse.claimed -or
    -not (
        Test-DispatchJobIdentity `
            -ResponseJobId $qaResponse.job_id `
            -ExpectedJobId $qaJobId
    )
) {
    throw "QA dispatch did not claim the expected job"
}

if (
    $qaResponse.qa.status -ne "approved" -or
    [decimal]$qaResponse.qa.score -lt [decimal]0.8
) {
    throw "QA did not approve the mock content"
}

$publishJobId = [string]$qaResponse.publish_job.id

if (-not $publishJobId) {
    throw "QA response omitted the Publisher job"
}

Write-Host "[PASS] QA approved the content: $qaJobId" `
    -ForegroundColor Green
Write-Host "[PASS] Publisher job created: $publishJobId" `
    -ForegroundColor Green

$verifiedReferralUrl =
    "$runtimeProgramUrl/referral?verified=local"
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
    countries = @("US", "GR")
    verified_by = "local-mock-pipeline"
    verification_note =
        "Local mock pipeline verification only"
} | ConvertTo-Json -Depth 8

$activationResponse = Invoke-Controller `
    -Body $activationBody

if (
    -not $activationResponse.ok -or
    $activationResponse.action -ne "activate_program" -or
    $activationResponse.activation.program_id -ne $programId -or
    $activationResponse.activation.program_status -ne "active" -or
    -not $activationResponse.activation.terms_verified
) {
    throw "Program activation did not complete correctly"
}

$verifiedReferralLinkId =
    [string]$activationResponse.activation.referral_link_id

if (-not $verifiedReferralLinkId) {
    throw "Activation returned no verified referral link id"
}

Write-Host "[PASS] Program activated: $programId" `
    -ForegroundColor Green
Write-Host "[PASS] Verified referral link: $verifiedReferralLinkId" `
    -ForegroundColor Green

$publisherResponse = Invoke-Controller `
    -Body '{"action":"dispatch","agent":"publisher"}'

if (
    -not $publisherResponse.ok -or
    -not $publisherResponse.claimed -or
    -not (
        Test-DispatchJobIdentity `
            -ResponseJobId $publisherResponse.job_id `
            -ExpectedJobId $publishJobId
    )
) {
    throw "Publisher dispatch did not claim the expected job"
}

if ($publisherResponse.provider -ne "mock") {
    throw "Publisher dispatch did not use the mock provider"
}

$finalState = Get-LastSqlValue -Sql @"
select
  j.status || '|' ||
  c.status || '|' ||
  coalesce(c.published_url, '') || '|' ||
  coalesce(c.published_at::text, '')
from public.jobs j
join public.content c
  on c.id = (j.payload->>'content_id')::uuid
where j.id = '$publishJobId'::uuid;
"@

$finalStateParts = $finalState -split '\|', 4

if (
    $finalStateParts.Count -ne 4 -or
    $finalStateParts[0] -ne "completed" -or
    $finalStateParts[1] -ne "published" -or
    -not $finalStateParts[2] -or
    -not $finalStateParts[3]
) {
    throw "Publisher result was not persisted correctly: $finalState"
}

Write-Host "[PASS] Publisher completed: $publishJobId" `
    -ForegroundColor Green

Write-Host ""
Write-Host "=== Preserved local mock result ===" `
    -ForegroundColor Cyan

[pscustomobject]@{
    topic_scout_job_id = $scoutJobId
    research_job_id = $researchJobId
    content_job_id = $contentJobId
    qa_job_id = $qaJobId
    publisher_job_id = $publishJobId
    program_id = $programId
    referral_link_id = $verifiedReferralLinkId
    published_url = $finalStateParts[2]
    published_at = $finalStateParts[3]
} | Format-List

Write-Host "RESULT: PASS" -ForegroundColor Green