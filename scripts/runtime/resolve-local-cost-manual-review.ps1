param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern(
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    )]
    [string]$ReservationId,

    [Parameter(Mandatory = $true)]
    [ValidateSet("settled", "released")]
    [string]$Decision,

    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 1000)]
    [string]$Reason,

    [string]$SupabaseUrl = "http://127.0.0.1:55321",

    [string]$RuntimeRoot = "C:\VYRA-LOCAL",

    [switch]$Apply
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
        throw "Runtime environment file was not found: $EnvFile"
    }

    $escapedName = [regex]::Escape($Name)
    $line = Get-Content -LiteralPath $EnvFile |
        Where-Object { $_ -match "^\s*$escapedName\s*=" } |
        Select-Object -First 1

    if (-not $line) {
        throw "$Name was not found in $EnvFile"
    }

    return (
        $line -replace "^\s*$escapedName\s*=", ""
    ).Trim().Trim('"').Trim("'")
}

$uri = [Uri]$SupabaseUrl
if (
    $uri.Scheme -ne "http" -or
    $uri.Host -notin @("127.0.0.1", "localhost", "::1")
) {
    throw "Only a local HTTP Supabase URL is allowed: $SupabaseUrl"
}

$envFile = Join-Path $RuntimeRoot "supabase\functions\.env"
$controllerSecret = Get-LocalEnvValue `
    -EnvFile $envFile `
    -Name "VYRA_CONTROLLER_SECRET"

if (-not $controllerSecret) {
    throw "VYRA_CONTROLLER_SECRET is empty in $envFile"
}

$baseUrl = $SupabaseUrl.TrimEnd("/")
$headers = @{ apikey = $controllerSecret }

$costStatus = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/functions/v1/vyra-controller" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body '{"action":"cost_status"}'

if (
    -not $costStatus.ok -or
    $costStatus.action -ne "cost_status" -or
    -not $costStatus.read_only -or
    $costStatus.external_calls -ne 0
) {
    throw "Controller cost_status did not return a safe read-only response"
}

$reservation = @($costStatus.manual_review_reservations) |
    Where-Object { $_.reservation_id -eq $ReservationId } |
    Select-Object -First 1

if (-not $reservation) {
    throw (
        "Manual-review reservation was not found in local cost_status: " +
        $ReservationId
    )
}

Write-Host "=== VYRA local manual-review resolution ===" -ForegroundColor Cyan

[PSCustomObject]@{
    reservation_id = $reservation.reservation_id
    provider = $reservation.provider
    operation = $reservation.operation
    reserved_eur_micros = $reservation.reserved_eur_micros
    decision = $Decision
    reason = $Reason
    provider_calls = 0
} | Format-List

if (-not $Apply) {
    Write-Host (
        "[DRY RUN] No reservation was changed. " +
        "Re-run with -Apply to continue."
    ) -ForegroundColor Yellow

    return
}

$typedReservationId = Read-Host (
    "Type the reservation ID exactly to confirm $Decision"
)

if ($typedReservationId.Trim() -ne $ReservationId) {
    throw "Confirmation did not match the reservation ID"
}

$response = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/functions/v1/vyra-controller" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body (
        @{
            action = "resolve_cost_manual_review"
            reservation_id = $ReservationId
            decision = $Decision
            reason = $Reason
        } | ConvertTo-Json -Compress
    )

if (
    -not $response.ok -or
    $response.action -ne "resolve_cost_manual_review" -or
    $response.external_calls -ne 0 -or
    $response.reservation.status -ne $Decision
) {
    throw "Controller returned an invalid manual-review resolution response"
}

Write-Host (
    "[PASS] Manual-review reservation resolved without provider calls"
) -ForegroundColor Green