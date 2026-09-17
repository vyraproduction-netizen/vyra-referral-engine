[CmdletBinding(DefaultParameterSetName = "None")]
param(
    [Parameter(Mandatory, ParameterSetName = "Engage")]
    [switch]$Engage,

    [Parameter(Mandatory, ParameterSetName = "Resume")]
    [ValidateRange(2, 9223372036854775807)]
    [long]$ResumeDailyLimitEurMicros,

    [string]$DatabaseContainer = "supabase_db_vyra-local-permanent",
    [string]$EdgeRuntimeContainer =
        "supabase_edge_runtime_vyra-local-permanent",
    [string]$RuntimeEnvPath =
        "C:\VYRA-LOCAL\supabase\functions\.env",
    [string]$ProjectRoot = "C:\VYRA-LOCAL"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Get-ProviderProfile {
    $values = @{}

    foreach ($name in @(
        "RESEARCH_PROVIDER",
        "CONTENT_PROVIDER",
        "PUBLISH_PROVIDER"
    )) {
        $values[$name] = (
            docker exec $EdgeRuntimeContainer printenv $name |
            Out-String
        ).Trim()
    }

    return (
        "$($values['RESEARCH_PROVIDER'])|" +
        "$($values['CONTENT_PROVIDER'])|" +
        "$($values['PUBLISH_PROVIDER'])"
    )
}

if ($PSCmdlet.ParameterSetName -eq "Resume") {
    $state = Invoke-LocalSql -Sql @"
begin;

update public.vyra_cost_budget_policy
set
  mode = 'enforce',
  daily_limit_eur_micros = $ResumeDailyLimitEurMicros,
  updated_at = now()
where singleton = true;

select
  mode || '|' || currency || '|' || daily_limit_eur_micros
from public.vyra_cost_budget_policy
where singleton = true;

commit;
"@

    if ($state -ne "enforce|EUR|$ResumeDailyLimitEurMicros") {
        throw "Budget restore returned an invalid state: $state"
    }

    Write-Host (
        "[PASS] Budget restored to " +
        "$ResumeDailyLimitEurMicros EUR micros"
    ) -ForegroundColor Green
    Write-Host (
        "[INFO] Providers were not changed; they remain mock " +
        "until changed manually."
    ) -ForegroundColor Yellow
    exit 0
}

if (-not (Test-Path -LiteralPath $RuntimeEnvPath -PathType Leaf)) {
    throw "Runtime environment file was not found: $RuntimeEnvPath"
}

$envLines = Get-Content -LiteralPath $RuntimeEnvPath

foreach ($name in @(
    "RESEARCH_PROVIDER",
    "CONTENT_PROVIDER",
    "PUBLISH_PROVIDER"
)) {
    $count = @(
        $envLines |
        Where-Object {
            $_ -match "^\s*$([regex]::Escape($name))="
        }
    ).Count

    if ($count -ne 1) {
        throw "$name must occur exactly once in $RuntimeEnvPath; found $count"
    }
}

$budgetState = Invoke-LocalSql -Sql @"
begin;

update public.vyra_cost_budget_policy
set
  mode = 'enforce',
  daily_limit_eur_micros = 1,
  updated_at = now()
where singleton = true;

select
  mode || '|' || currency || '|' || daily_limit_eur_micros
from public.vyra_cost_budget_policy
where singleton = true;

commit;
"@

if ($budgetState -ne "enforce|EUR|1") {
    throw "Emergency budget state is invalid: $budgetState"
}

$probeSql = @'
do $$
begin
  perform public.reserve_vyra_cost_budget(
    gen_random_uuid(),
    'tavily',
    'topic_scout_search',
    20000
  );

  raise exception 'Emergency budget probe unexpectedly reserved funds';
exception
  when others then
    if position('VYRA daily budget exceeded' in SQLERRM) = 0 then
      raise;
    end if;
end;
$$;
'@

Invoke-LocalSql -Sql $probeSql | Out-Null

$updatedEnvLines = foreach ($line in $envLines) {
    if ($line -match '^\s*(RESEARCH_PROVIDER|CONTENT_PROVIDER|PUBLISH_PROVIDER)=') {
        "$($Matches[1])=mock"
    } else {
        $line
    }
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllLines(
    $RuntimeEnvPath,
    [string[]]$updatedEnvLines,
    $utf8WithoutBom
)

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    throw "Supabase CLI is not available in this PowerShell session"
}

Push-Location $ProjectRoot

try {
    & supabase stop
    if ($LASTEXITCODE -ne 0) {
        throw "Supabase stop failed"
    }

    & supabase start
    if ($LASTEXITCODE -ne 0) {
        throw "Supabase start failed"
    }
}
finally {
    Pop-Location
}

$profile = Get-ProviderProfile

if ($profile -ne "mock|mock|mock") {
    throw "Emergency stop Runtime profile is invalid: $profile"
}

Write-Host "[PASS] Budget preflight blocks paid provider calls" `
    -ForegroundColor Green
Write-Host "[PASS] Runtime restarted with mock providers only" `
    -ForegroundColor Green
Write-Host "RESULT: EMERGENCY STOP ENGAGED" `
    -ForegroundColor Yellow