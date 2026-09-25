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
        if ($line -match $pattern) { return $Matches[1].Trim() }
    }
    return $null
}

function Invoke-LocalSql {
    param([string]$Sql)

    $result = $Sql |
        docker exec -i $DatabaseContainer `
            psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt

    if ($LASTEXITCODE -ne 0) { throw "Local PostgreSQL command failed" }
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

function Get-ContainerEnv {
    param([string]$Name)

    return ((docker exec $EdgeRuntimeContainer printenv $Name | Out-String).Trim())
}

function Convert-FromBase64Utf8 {
    param([string]$Value)

    $bytes = [Convert]::FromBase64String(($Value -replace '\s', ''))
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Get-HttpStatusCode {
    param([System.Management.Automation.ErrorRecord]$ErrorRecord)

    $response = $ErrorRecord.Exception.Response
    if ($response -and $response.StatusCode) {
        return [int]$response.StatusCode
    }
    return $null
}

$controllerSecret = Get-EnvValue `
    -Path $RuntimeEnvPath `
    -Name "VYRA_CONTROLLER_SECRET"

if (-not $controllerSecret) {
    throw "VYRA_CONTROLLER_SECRET is missing from the local runtime environment"
}

$runtime = @{}
foreach ($name in @(
    "GITHUB_PUBLISH_TOKEN",
    "GITHUB_PUBLISH_REPOSITORY",
    "GITHUB_PUBLISH_BRANCH",
    "GITHUB_PUBLISH_BASE_URL",
    "GITHUB_PUBLISH_ROBOTS",
    "RESEARCH_PROVIDER",
    "CONTENT_PROVIDER",
    "PUBLISH_PROVIDER"
)) {
    $runtime[$name] = Get-ContainerEnv -Name $name
}

$tokenState = if ($runtime["GITHUB_PUBLISH_TOKEN"]) { "present" } else { "missing" }
$runtimeState = "{0}|{1}|{2}|{3}|{4}" -f `
    $tokenState, `
    $runtime["RESEARCH_PROVIDER"], `
    $runtime["CONTENT_PROVIDER"], `
    $runtime["PUBLISH_PROVIDER"], `
    $runtime["GITHUB_PUBLISH_REPOSITORY"]

if ($runtimeState -ne "present|mock|mock|cloudflare_pages|vyraproduction-netizen/vyraproduction-site") {
    throw "Runtime profile is unsafe or incomplete: $runtimeState"
}

if ($runtime["GITHUB_PUBLISH_BRANCH"] -and $runtime["GITHUB_PUBLISH_BRANCH"] -ne "main") {
    throw "Controlled Publisher test requires GITHUB_PUBLISH_BRANCH=main"
}

if ($runtime["GITHUB_PUBLISH_BASE_URL"] -ne "https://vyraproduction.pages.dev") {
    throw "Controlled Publisher test requires the VYRA Cloudflare Pages site"
}

if ($runtime["GITHUB_PUBLISH_ROBOTS"] -and $runtime["GITHUB_PUBLISH_ROBOTS"] -ne "noindex,nofollow") {
    throw "Controlled Publisher test requires articles to remain noindex,nofollow"
}

$queuedPublisherJobs = Invoke-LocalSql -Sql @"
select count(*)
from public.jobs
where agent = 'publisher'
  and status in ('queued', 'retry');
"@

if ($queuedPublisherJobs -ne "0") {
    throw "Refusing to dispatch while Publisher jobs are queued: $queuedPublisherJobs"
}

$contentId = [guid]::NewGuid().ToString()
$publishJobId = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()
$slug = "vyra-controlled-publisher-" + $contentId.Substring(0, 8)
$githubPath = "docs/articles/$slug.html"
$expectedUrl = "https://vyraproduction.pages.dev/articles/$slug"
$marker = "<!-- vyra-content-id: $contentId -->"

try {
    $payload = @{
        request_id = $requestId
        source_qa_job_id = [guid]::NewGuid().ToString()
        source_content_job_id = [guid]::NewGuid().ToString()
        source_research_job_id = [guid]::NewGuid().ToString()
        content_id = $contentId
        language = "en"
        title = "VYRA controlled GitHub Pages publication"
        slug = $slug
        qa_score = 0.90
    } | ConvertTo-Json -Compress
    $payloadSql = $payload.Replace("'", "''")

    Invoke-LocalSql -Sql @"
insert into public.content (
  id, title, slug, language, status, body, excerpt,
  meta_title, meta_description, evidence, qa_score
)
values (
  '$contentId'::uuid,
  'VYRA controlled Cloudflare Pages publication',
  '$slug',
  'en',
  'approved',
  '# Controlled VYRA Publisher Test' || E'\n\n' ||
    'This diagnostic article is removed after verification.',
  'Controlled diagnostic article.',
  'VYRA Production Publisher Test',
  'Controlled Cloudflare Pages publication test.',
  jsonb_build_object('source_job_id', '$publishJobId', 'controlled_test', true),
  0.90
);

insert into public.jobs (
  id, agent, task_type, status, priority, payload, max_attempts
)
values (
  '$publishJobId'::uuid,
  'publisher',
  'content_publish',
  'queued',
  100000,
  '$payloadSql'::jsonb,
  1
);
"@ | Out-Null

    Write-Host "=== VYRA controlled Cloudflare Pages Publisher test ===" -ForegroundColor Cyan
    Write-Host "Target: $SupabaseUrl"
    Write-Host "External operations: one Cloudflare Pages publication and one verified cleanup"
    Write-Host "Research and Content: not dispatched"
    Write-Host ""

    $publisherResponse = Invoke-Controller `
        -Body '{"action":"dispatch","agent":"publisher"}'

    if (
        -not $publisherResponse.ok -or
        -not $publisherResponse.claimed -or
        $publisherResponse.job_id -ne $publishJobId -or
        $publisherResponse.provider -ne "cloudflare_pages" -or
        $publisherResponse.publication.published_url -ne $expectedUrl
    ) {
        throw "Publisher did not complete the controlled Cloudflare Pages job"
    }

    $finalState = Invoke-LocalSql -Sql @"
select
  publish_job.status || '|' ||
  draft.status || '|' ||
  coalesce(draft.published_url, '') || '|' ||
  (draft.published_at is not null) || '|' ||
  coalesce(publish_job.result->>'provider', '')
from public.jobs publish_job
join public.content draft on draft.id = '$contentId'::uuid
where publish_job.id = '$publishJobId'::uuid;
"@

    if ($finalState -ne "completed|published|$expectedUrl|true|cloudflare_pages") {
        throw "Cloudflare Pages Publisher final state is invalid: $finalState"
    }

    $livePage = Invoke-WebRequest `
        -Uri "https://vyraproduction.pages.dev/articles/$slug" `
        -UseBasicParsing `
        -ErrorAction Stop
    $liveHtml = [string]$livePage.Content
    if (-not $liveHtml.Contains($marker) -or
        -not $liveHtml.Contains('<meta name="robots" content="noindex,nofollow">') -or
        -not $liveHtml.Contains('https://vyraproduction.pages.dev/disclosure') -or
        -not $liveHtml.Contains('https://vyraproduction.pages.dev/privacy')) {
        throw "Live Cloudflare diagnostic article is missing marker, noindex, or site navigation"
    }

    Write-Host "[PASS] Cloudflare Pages Publisher published and verified the live diagnostic page" -ForegroundColor Green
    Write-Host "[PASS] VYRA persisted the verified URL only after Pages became live" -ForegroundColor Green
}
finally {
    $githubCleanupError = $null

    if ($contentId -and $slug) {
        try {
            $repositoryParts = $runtime["GITHUB_PUBLISH_REPOSITORY"].Split("/", 2)
            $apiPath = $githubPath.Split("/") | ForEach-Object { [uri]::EscapeDataString($_) }
            $apiUrl = "https://api.github.com/repos/$($repositoryParts[0])/$($repositoryParts[1])/contents/$($apiPath -join '/')?ref=main"
            $headers = @{
                Accept = "application/vnd.github+json"
                Authorization = "Bearer $($runtime['GITHUB_PUBLISH_TOKEN'])"
                "X-GitHub-Api-Version" = "2022-11-28"
                "User-Agent" = "VYRA-controlled-publisher-test"
            }
            $source = Invoke-RestMethod -Method Get -Uri $apiUrl -Headers $headers
            $sourceText = Convert-FromBase64Utf8 -Value ([string]$source.content)

            if (-not $sourceText.Contains($marker)) {
                throw "Refusing GitHub cleanup: diagnostic file marker does not match"
            }

            $deleteBody = @{
                message = "Remove VYRA controlled publisher diagnostic"
                sha = [string]$source.sha
                branch = "main"
            } | ConvertTo-Json -Compress

            Invoke-RestMethod `
                -Method Delete `
                -Uri $apiUrl `
                -Headers $headers `
                -ContentType "application/json" `
                -Body $deleteBody | Out-Null

            Write-Host "[PASS] Verified GitHub diagnostic source removed" -ForegroundColor Green
        }
        catch {
            if ((Get-HttpStatusCode -ErrorRecord $_) -eq 404) {
                Write-Host "[PASS] No GitHub diagnostic source remained to remove" -ForegroundColor Green
            }
            else {
                $githubCleanupError = $_
            }
        }
    }

    $cleanupState = Invoke-LocalSql -Sql @"
begin;

delete from public.jobs
where id = '$publishJobId'::uuid;

delete from public.content
where id = '$contentId'::uuid;

select
  (select count(*) from public.jobs where id = '$publishJobId'::uuid) || '|' ||
  (select count(*) from public.content where id = '$contentId'::uuid);

commit;
"@

    $cleanupResult = (
        $cleanupState -split "\r?\n" |
        Where-Object { $_ -match "^\d+\|\d+$" } |
        Select-Object -Last 1
    )

    if ($cleanupResult -ne "0|0") {
        throw "Controlled Publisher database cleanup failed: $cleanupState"
    }

    Write-Host "[PASS] Diagnostic database data cleaned: $cleanupResult" -ForegroundColor Green

    if ($githubCleanupError) {
        throw "Controlled Publisher GitHub cleanup failed: $githubCleanupError"
    }
}

Write-Host "RESULT: PASS" -ForegroundColor Green
