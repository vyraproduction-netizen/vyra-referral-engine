param(
    [string]$SupabaseUrl = "http://127.0.0.1:55321",

    [string]$RuntimeRoot = "C:\VYRA-LOCAL",

    [string]$ContainerName =
        "supabase_edge_runtime_vyra-local-permanent",
		[string]$LogDirectory = "C:\VYRA-BACKUPS\vyra-local\logs",

    [ValidateRange(5, 180)]
    [int]$RecoveryTimeoutSeconds = 45,
	[ValidateRange(10, 300)]
    [int]$DockerReadyTimeoutSeconds = 120,

    [switch]$Repair
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

function Get-EndpointHealth {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [Parameter(Mandatory = $true)]
        [string]$WorkerSecret
    )

    try {
        $response = Invoke-RestMethod `
            -Method Post `
            -Uri "$($Url.TrimEnd('/'))/functions/v1/vyra-diagnostics" `
            -Headers @{ "x-vyra-worker-secret" = $WorkerSecret } `
            -ContentType "application/json" `
            -Body "{}" `
            -TimeoutSec 10

        if (-not $response.ok) {
            throw "vyra-diagnostics returned ok=false"
        }

        return [PSCustomObject]@{
            healthy = $true
            error = $null
        }
    }
    catch {
        return [PSCustomObject]@{
            healthy = $false
            error = $_.Exception.Message
        }
    }
}

function Write-RecoveryEvent {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("INFO", "WARNING", "ERROR")]
        [string]$Level,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    try {
        if (-not (Test-Path -LiteralPath $LogDirectory -PathType Container)) {
            New-Item `
                -ItemType Directory `
                -Path $LogDirectory `
                -Force | Out-Null
        }

        $logPath = Join-Path `
            $LogDirectory `
            "edge-runtime-recovery.log"

        $timestamp = (Get-Date).ToUniversalTime().ToString("o")

        Add-Content `
            -LiteralPath $logPath `
            -Value "[$timestamp] [$Level] $Message" `
            -Encoding utf8
    }
    catch {
        Write-Warning "Unable to write the local Edge Runtime recovery log"
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI not found"
}

$dockerReady = $false
$dockerDeadline = [DateTimeOffset]::UtcNow.AddSeconds(
    $DockerReadyTimeoutSeconds
)

do {
    docker info 2>$null | Out-Null

    if ($LASTEXITCODE -eq 0) {
        $dockerReady = $true
        break
    }

    Start-Sleep -Seconds 3
}
while ([DateTimeOffset]::UtcNow -lt $dockerDeadline)

if (-not $dockerReady) {
    throw (
        "Docker Engine did not become ready within " +
        "$DockerReadyTimeoutSeconds seconds"
    )
}

$uri = [Uri]$SupabaseUrl

$uri = [Uri]$SupabaseUrl
if (
    $uri.Scheme -ne "http" -or
    $uri.Host -notin @("127.0.0.1", "localhost", "::1")
) {
    throw "Only a local HTTP Supabase URL is allowed: $SupabaseUrl"
}

$envFile = Join-Path $RuntimeRoot "supabase\functions\.env"
$workerSecret = Get-LocalEnvValue `
    -EnvFile $envFile `
    -Name "VYRA_WORKER_SECRET"

if (-not $workerSecret) {
    throw "VYRA_WORKER_SECRET is empty in $envFile"
}

$containerRunning = (
    docker inspect `
        --format '{{.State.Running}}' `
        $ContainerName 2>$null
)

if ($LASTEXITCODE -ne 0) {
    throw "Edge Runtime container was not found: $ContainerName"
}

$health = Get-EndpointHealth `
    -Url $SupabaseUrl `
    -WorkerSecret $workerSecret

if ($health.healthy) {
    Write-Host "[PASS] Local Edge Runtime is healthy" -ForegroundColor Green
    exit 0
}

Write-Host (
    "[WARNING] Local Edge Runtime is unhealthy: {0}" -f $health.error
) -ForegroundColor Yellow

Write-RecoveryEvent `
    -Level "WARNING" `
    -Message "Local diagnostics endpoint is unhealthy."

if (-not $Repair) {
    Write-Host (
        "No restart was performed. Re-run with -Repair to restart only " +
        "the Edge Runtime container."
    ) -ForegroundColor Yellow
    exit 1
}

if ($containerRunning -eq "true") {
    Write-Host (
        "Restarting local Edge Runtime container..."
    ) -ForegroundColor Yellow

    Write-RecoveryEvent `
        -Level "INFO" `
        -Message "Restarting local Edge Runtime container."

    docker restart $ContainerName | Out-Null
}
else {
    Write-Host (
        "Starting local Edge Runtime container..."
    ) -ForegroundColor Yellow

    Write-RecoveryEvent `
        -Level "INFO" `
        -Message "Starting local Edge Runtime container."

    docker start $ContainerName | Out-Null
}

if ($LASTEXITCODE -ne 0) {
    throw "Unable to restart local Edge Runtime container"
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds(
    $RecoveryTimeoutSeconds
)

do {
    Start-Sleep -Seconds 3

    $health = Get-EndpointHealth `
        -Url $SupabaseUrl `
        -WorkerSecret $workerSecret

    if ($health.healthy) {
        Write-Host (
            "[PASS] Local Edge Runtime recovered successfully"
        ) -ForegroundColor Green
	Write-RecoveryEvent `
        -Level "INFO" `
        -Message "Local Edge Runtime recovered successfully."
        exit 0
    }
}
while ([DateTimeOffset]::UtcNow -lt $deadline)

Write-RecoveryEvent `
    -Level "ERROR" `
    -Message "Local Edge Runtime did not recover within the recovery timeout."

throw (
    "Local Edge Runtime did not recover within " +
    "$RecoveryTimeoutSeconds seconds: $($health.error)"
)