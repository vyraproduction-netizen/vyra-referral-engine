[CmdletBinding()]
param(
    [string]$ProjectRef = "gyqldlwromvmldxyhoip",
    [string]$SupabaseUrl = "https://gyqldlwromvmldxyhoip.supabase.co",
    [string]$TopicSeed = "image enhancement"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProjectRef = "gyqldlwromvmldxyhoip"
$ExpectedSupabaseUrl = "https://gyqldlwromvmldxyhoip.supabase.co"

function Assert-ExitCode {
    param([string]$Operation)
    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE"
    }
}

function Invoke-PilotSql {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $Path = Join-Path ([System.IO.Path]::GetTempPath()) (
        "vyra-pilot-" + [guid]::NewGuid().ToString() + ".sql"
    )

    try {
        [System.IO.File]::WriteAllText(
            $Path,
            $Sql,
            [System.Text.UTF8Encoding]::new($false)
        )
        $Output = & supabase db query --linked --project-ref $ProjectRef --file $Path
        Assert-ExitCode "Pilot SQL query"
        return ($Output | Out-String)
    }
    finally {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
}

function Get-PilotUuid {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [Parameter(Mandatory = $true)][string]$Description
    )

    $Output = Invoke-PilotSql -Sql $Sql
    $Match = [regex]::Match(
        $Output,
        "(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"
    )
    if (-not $Match.Success) {
        throw "$Description was not found: $Output"
    }
    return $Match.Value.ToLowerInvariant()
}

function Test-DispatchJob {
    param(
        [object]$ResponseJobId,
        [Parameter(Mandatory = $true)][string]$ExpectedJobId
    )

    $Reported = ([string]$ResponseJobId).Trim()
    if ($Reported) {
        return $Reported -eq $ExpectedJobId
    }

    $Output = Invoke-PilotSql -Sql @"
select status from public.jobs where id = '$ExpectedJobId'::uuid;
"@
    return $Output -match "completed"
}

function ConvertFrom-SecureStringPlainText {
    param([Parameter(Mandatory = $true)][Security.SecureString]$Value)

    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    }
}

function Invoke-Controller {
    param([Parameter(Mandatory = $true)][string]$Body)

    $Request = @{
        Method = "Post"
        Uri = "$SupabaseUrl/functions/v1/vyra-controller"
        Headers = @{ apikey = $ControllerKey }
        ContentType = "application/json"
        Body = $Body
    }
    return Invoke-RestMethod @Request
}

if ($ProjectRef -ne $ExpectedProjectRef) {
    throw "This test is locked to pilot project $ExpectedProjectRef"
}

if ($SupabaseUrl.TrimEnd("/") -ne $ExpectedSupabaseUrl) {
    throw "This test is locked to pilot URL $ExpectedSupabaseUrl"
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    throw "Supabase CLI is not available in PATH"
}

$ControllerKey = $null
$ScoutJobId = [guid]::NewGuid().ToString()
$ResearchJobId = ""
$ContentJobId = ""
$QaJobId = ""
$PublishJobId = ""
$TopicSeed = $TopicSeed.Trim()

if (-not $TopicSeed) {
    throw "TopicSeed is required"
}

$ProgramUrl = "https://example.local/research/ai-tools-pricing/" +
    [uri]::EscapeDataString($TopicSeed) + "?run=$ScoutJobId"

try {
    Write-Host "=== VYRA pilot mock pipeline ===" -ForegroundColor Cyan
    Write-Host "Target: $SupabaseUrl"
    Write-Host "Safety: locked pilot project; mock providers are reapplied now"
    Write-Host "External paid providers and GitHub Pages are not dispatched"
    Write-Host ""

    & supabase secrets set "RESEARCH_PROVIDER=mock" "CONTENT_PROVIDER=mock" "PUBLISH_PROVIDER=mock" --project-ref $ProjectRef
    Assert-ExitCode "Setting pilot mock providers"

    $WorkerSecretSecure = Read-Host "Paste VYRA_WORKER_SECRET from KeePassXC" -AsSecureString
    $WorkerSecret = ConvertFrom-SecureStringPlainText -Value $WorkerSecretSecure
    try {
        $DiagnosticsRequest = @{
            Method = "Post"
            Uri = "$SupabaseUrl/functions/v1/vyra-diagnostics"
            Headers = @{ "x-vyra-worker-secret" = $WorkerSecret }
        }
        $Diagnostics = Invoke-RestMethod @DiagnosticsRequest
    }
    finally {
        Remove-Variable WorkerSecret -ErrorAction SilentlyContinue
    }

    if (-not $Diagnostics.ok) {
        throw "Pilot diagnostics did not return ok"
    }

    foreach ($Name in @("RESEARCH_PROVIDER", "CONTENT_PROVIDER", "PUBLISH_PROVIDER")) {
        if ($Diagnostics.environment.$Name -ne "SET") {
            throw "Pilot diagnostics reports missing $Name"
        }
    }

    $ControllerKeySecure = Read-Host "Paste vyra_controller API key from KeePassXC" -AsSecureString
    $ControllerKey = ConvertFrom-SecureStringPlainText -Value $ControllerKeySecure

    $Health = Invoke-Controller -Body '{"action":"health"}'
    if (-not $Health.ok -or $Health.service -ne "vyra-controller") {
        throw "Pilot controller health check failed"
    }

    Invoke-PilotSql -Sql @"
do $([char]36)$([char]36)
begin
  if not exists (
    select 1 from public.vyra_cost_budget_policy
    where singleton = true and mode = 'enforce'
      and currency = 'EUR' and daily_limit_eur_micros = 450000
  ) then
    raise exception 'Pilot budget is not enforce|EUR|450000';
  end if;
end
$([char]36)$([char]36);
"@ | Out-Null

    Invoke-PilotSql -Sql @"
do $([char]36)$([char]36)
declare queued_count bigint;
begin
  select count(*) into queued_count
  from public.jobs
  where status in ('queued', 'retry', 'running');
  if queued_count <> 0 then
    raise exception 'Refusing test: % unfinished job(s) already exist', queued_count;
  end if;
end
$([char]36)$([char]36);
"@ | Out-Null

    $ScoutPayload = @{
        request_id = $ScoutJobId
        language = "ru"
        region = "EU"
        topic_seed = $TopicSeed
        constraints = @{ min_score = 0.7; max_topics = 3 }
    }
    $PayloadSql = ($ScoutPayload | ConvertTo-Json -Depth 8 -Compress).Replace("'", "''")

    Invoke-PilotSql -Sql @"
insert into public.jobs (
  id, agent, task_type, status, priority, payload, max_attempts
)
values (
  '$ScoutJobId'::uuid,
  'topic_scout',
  'topic_discovery',
  'queued',
  100000,
  '$PayloadSql'::jsonb,
  3
);
"@ | Out-Null

    $ScoutResponse = Invoke-Controller -Body '{"action":"dispatch","agent":"topic_scout"}'
    if (
        -not $ScoutResponse.ok -or
        -not $ScoutResponse.claimed -or
        -not (Test-DispatchJob -ResponseJobId $ScoutResponse.job_id -ExpectedJobId $ScoutJobId)
    ) {
        throw "Topic Scout did not claim the diagnostic job"
    }

    $ResearchJobId = Get-PilotUuid -Description "Topic Scout Research job" -Sql @"
select id from public.jobs
where agent = 'research'
  and task_type = 'topic_research'
  and status = 'queued'
  and payload->>'request_id' = '$ScoutJobId'
order by created_at desc
limit 1;
"@

    $ResearchResponse = Invoke-Controller -Body '{"action":"dispatch","agent":"research"}'
    if (
        -not $ResearchResponse.ok -or
        -not $ResearchResponse.claimed -or
        -not (Test-DispatchJob -ResponseJobId $ResearchResponse.job_id -ExpectedJobId $ResearchJobId) -or
        $ResearchResponse.provider -ne "mock"
    ) {
        throw "Research did not complete with the mock provider"
    }

    $ProgramId = [string]$ResearchResponse.program.id
    $ReferralLinkId = [string]$ResearchResponse.referral_link.id
    $ContentJobId = [string]$ResearchResponse.content_job.id
    if (-not $ProgramId -or -not $ReferralLinkId -or -not $ContentJobId) {
        throw "Research response omitted a program, link, or Content job"
    }

    Invoke-PilotSql -Sql @"
do $([char]36)$([char]36)
begin
  if not exists (
    select 1 from public.programs p
    join public.referral_links r on r.program_id = p.id
    where p.id = '$ProgramId'::uuid
      and r.id = '$ReferralLinkId'::uuid
      and p.status = 'candidate'
      and r.status = 'paused'
      and p.official_url = '$ProgramUrl'
      and p.notes::jsonb->>'request_id' = '$ScoutJobId'
  ) then
    raise exception 'Mock Research persistence check failed';
  end if;
end
$([char]36)$([char]36);
"@ | Out-Null

    $ContentResponse = Invoke-Controller -Body '{"action":"dispatch","agent":"content"}'
    if (
        -not $ContentResponse.ok -or
        -not $ContentResponse.claimed -or
        $ContentResponse.provider -ne "mock" -or
        -not (Test-DispatchJob -ResponseJobId $ContentResponse.job_id -ExpectedJobId $ContentJobId)
    ) {
        throw "Content did not claim the diagnostic job"
    }

    $QaJobId = [string]$ContentResponse.qa_job.id
    if (-not $QaJobId) {
        throw "Content response omitted the QA job"
    }

    $QaResponse = Invoke-Controller -Body '{"action":"dispatch","agent":"qa"}'
    if (
        -not $QaResponse.ok -or
        -not $QaResponse.claimed -or
        -not (Test-DispatchJob -ResponseJobId $QaResponse.job_id -ExpectedJobId $QaJobId) -or
        $QaResponse.qa.status -ne "approved" -or
        [decimal]$QaResponse.qa.score -lt [decimal]0.8
    ) {
        throw "QA did not approve the mock draft"
    }

    $PublishJobId = [string]$QaResponse.publish_job.id
    if (-not $PublishJobId) {
        throw "QA response omitted the Publisher job"
    }

    $ActivationBody = @{
        action = "activate_program"
        program_id = $ProgramId
        affiliate_url = "$ProgramUrl/referral?verified=pilot"
        terms_url = "$ProgramUrl/terms"
        commission_type = "percentage"
        commission_value = 25
        recurring = $true
        cookie_duration_days = 30
        countries = @("US", "GR")
        verified_by = "pilot-mock-pipeline"
        verification_note = "Controlled pilot mock verification only"
    } | ConvertTo-Json -Depth 8 -Compress

    $ActivationResponse = Invoke-Controller -Body $ActivationBody
    if (
        -not $ActivationResponse.ok -or
        $ActivationResponse.activation.program_id -ne $ProgramId -or
        $ActivationResponse.activation.program_status -ne "active" -or
        -not $ActivationResponse.activation.terms_verified
    ) {
        throw "Program activation did not complete correctly"
    }

    $PublisherResponse = Invoke-Controller -Body '{"action":"dispatch","agent":"publisher"}'
    if (
        -not $PublisherResponse.ok -or
        -not $PublisherResponse.claimed -or
        -not (Test-DispatchJob -ResponseJobId $PublisherResponse.job_id -ExpectedJobId $PublishJobId) -or
        $PublisherResponse.provider -ne "mock"
    ) {
        throw "Publisher did not complete with the mock provider"
    }

    Invoke-PilotSql -Sql @"
do $([char]36)$([char]36)
begin
  if not exists (
    select 1
    from public.jobs publish_job
    join public.content draft
      on draft.id = (publish_job.payload->>'content_id')::uuid
    where publish_job.id = '$PublishJobId'::uuid
      and publish_job.status = 'completed'
      and draft.status = 'published'
      and draft.published_url like 'https://example.local/published/%'
      and draft.published_at is not null
  ) then
    raise exception 'Mock Publisher persistence check failed';
  end if;
end
$([char]36)$([char]36);
"@ | Out-Null

    Write-Host "[PASS] Research, Content, QA and Publisher used mock-safe flow" -ForegroundColor Green
    Write-Host "[PASS] Pilot persisted the complete pipeline" -ForegroundColor Green
}
finally {
    try {
        Invoke-PilotSql -Sql @"
begin;

-- Never remove a paid provider ledger or its job during diagnostic cleanup.
do $([char]36)$([char]36)
begin
  if exists (
    select 1 from public.vyra_cost_reservations
    where job_id in (
      select id from public.jobs where payload->>'request_id' = '$ScoutJobId'
    )
       or job_id = '$ScoutJobId'::uuid
       or job_id = nullif('$ResearchJobId', '')::uuid
       or job_id = nullif('$ContentJobId', '')::uuid
  ) or exists (
    select 1 from public.vyra_cost_observations
    where job_id in (
      select id from public.jobs where payload->>'request_id' = '$ScoutJobId'
    )
       or job_id = '$ScoutJobId'::uuid
       or job_id = nullif('$ResearchJobId', '')::uuid
       or job_id = nullif('$ContentJobId', '')::uuid
  ) then
    raise exception 'Paid provider ledger detected: leave diagnostic jobs intact for review';
  end if;
end
$([char]36)$([char]36);

delete from public.jobs
where agent = 'publisher'
  and payload->>'content_id' in (
    select id::text from public.content
    where evidence->>'request_id' = '$ScoutJobId'
  );

delete from public.jobs
where agent = 'qa'
  and payload->>'source_research_job_id' = nullif('$ResearchJobId', '');

delete from public.jobs
where id = nullif('$PublishJobId', '')::uuid
   or id = nullif('$QaJobId', '')::uuid;

delete from public.content
where evidence->>'request_id' = '$ScoutJobId'
   or evidence->>'source_job_id' = nullif('$ResearchJobId', '');

delete from public.jobs
where agent = 'content'
  and payload->>'source_job_id' = nullif('$ResearchJobId', '');

delete from public.jobs
where id = nullif('$ResearchJobId', '')::uuid;

delete from public.jobs
where payload->>'request_id' = '$ScoutJobId'
   or id = '$ScoutJobId'::uuid;

delete from public.referral_links
where program_id in (
  select id from public.programs where official_url = '$ProgramUrl'
);

delete from public.programs
where official_url = '$ProgramUrl';

do $([char]36)$([char]36)
declare leftovers bigint;
begin
  select
    (select count(*) from public.jobs
     where id = '$ScoutJobId'::uuid
        or id = nullif('$ResearchJobId', '')::uuid
        or id = nullif('$ContentJobId', '')::uuid
        or id = nullif('$QaJobId', '')::uuid
        or id = nullif('$PublishJobId', '')::uuid
        or payload->>'request_id' = '$ScoutJobId') +
    (select count(*) from public.content
     where evidence->>'request_id' = '$ScoutJobId'
        or evidence->>'source_job_id' = nullif('$ResearchJobId', '')) +
    (select count(*) from public.programs
     where official_url = '$ProgramUrl')
  into leftovers;

  if leftovers <> 0 then
    raise exception 'Pilot cleanup left % diagnostic row(s)', leftovers;
  end if;
end
$([char]36)$([char]36);

commit;
"@ | Out-Null

        Write-Host "[PASS] Pilot diagnostic data cleaned" -ForegroundColor Green
    }
    finally {
        Remove-Variable ControllerKey -ErrorAction SilentlyContinue
    }
}

Write-Host "RESULT: PASS" -ForegroundColor Green
