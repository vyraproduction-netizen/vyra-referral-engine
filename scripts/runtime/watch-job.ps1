param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern(
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    )]
    [string]$JobId,

    [string]$SupabaseUrl = "http://127.0.0.1:55321",

    [string]$DatabaseContainer =
        "supabase_db_vyra-local-permanent",

    [ValidateRange(1, 300)]
    [int]$IntervalSeconds = 2,

    [ValidateRange(1, 1000)]
    [int]$Iterations = 10,

    [switch]$AllowRemote
)

$ErrorActionPreference = "Stop"

function Get-LocalJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,

        [Parameter(Mandatory = $true)]
        [string]$Id
    )

    $query = @"
BEGIN;
SET TRANSACTION READ ONLY;

select row_to_json(job)::text
from (
    select
        id,
        agent,
        task_type,
        status,
        attempts,
        max_attempts,
        next_run_at,
        error_message,
        started_at,
        completed_at
    from public.jobs
    where id = '$Id'::uuid
) as job;

COMMIT;
"@

    $json = & docker exec `
        $ContainerName `
        psql `
        -U postgres `
        -d postgres `
        -X `
        -q `
        -t `
        -A `
        -v ON_ERROR_STOP=1 `
        -c $query

    if ($LASTEXITCODE -ne 0) {
        throw "Local database query failed"
    }

    $json = $json |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -First 1

    if (-not $json) {
        return $null
    }

    return $json | ConvertFrom-Json
}

$uri = $null

if (-not [System.Uri]::TryCreate(
    $SupabaseUrl,
    [System.UriKind]::Absolute,
    [ref]$uri
)) {
    throw "Invalid SupabaseUrl"
}

$isLocalHost = $uri.Host -in @(
    "127.0.0.1",
    "localhost",
    "::1"
)

if (-not $isLocalHost -and -not $AllowRemote) {
    throw (
        "Remote Supabase access is blocked. " +
        "Use -AllowRemote only after explicit approval."
    )
}

if (-not $isLocalHost) {
    $trustedRemoteHosts = @(
        "gyqldlwromvmldxyhoip.supabase.co"
    )

    if (
        $uri.Scheme -ne "https" -or
        $uri.Host -notin $trustedRemoteHosts
    ) {
        throw (
            "Remote job watching is allowed only for the configured " +
            "HTTPS Supabase production host."
        )
    }
}

$baseUrl = $SupabaseUrl.TrimEnd("/")
$method = "Get"
$requestBody = $null
$endpoint = $null
$headers = $null

if (-not $isLocalHost) {
    $controllerSecret = $env:VYRA_CONTROLLER_SECRET

    if (-not $controllerSecret) {
        $secureSecret = Read-Host `
            "Enter VYRA_CONTROLLER_SECRET for the remote status request" `
            -AsSecureString

        $secretPointer =
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
                $secureSecret
            )

        try {
            $controllerSecret =
                [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
                    $secretPointer
                )
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR(
                $secretPointer
            )
        }
    }

    if (-not $controllerSecret) {
        throw "VYRA_CONTROLLER_SECRET is required for remote job watching."
    }

    $endpoint = "$baseUrl/functions/v1/vyra-controller"

    $headers = @{
        apikey = $controllerSecret
        "Content-Type" = "application/json"
    }

    $method = "Post"

    $requestBody = @{
        action = "job_status"
        job_id = $JobId
    } | ConvertTo-Json -Compress
}

Write-Host "=== VYRA job watch ===" -ForegroundColor Cyan
Write-Host "Target: $($uri.Scheme)://$($uri.Authority)"
Write-Host "JobId: $JobId"
Write-Host "Mode: READ ONLY"

if ($isLocalHost) {
    Write-Host "Source: local PostgreSQL container"
}

$successfulReads = 0
$readErrors = 0

for ($i = 1; $i -le $Iterations; $i++) {
    try {
        if ($isLocalHost) {
            $row = Get-LocalJob `
                -ContainerName $DatabaseContainer `
                -Id $JobId
        }
        else {
            $response = Invoke-RestMethod `
                -Uri $endpoint `
                -Headers $headers `
                -Method $method `
                -ContentType "application/json" `
                -Body $requestBody

            if (-not $response.ok) {
                throw "Remote controller returned ok=false"
            }

            $row = $response.job
        }

        if (-not $row) {
            $successfulReads++

            Write-Host (
                "[{0}/{1}] Job not found" -f $i, $Iterations
            ) -ForegroundColor Yellow
        }
        else {
            $successfulReads++
            $ready = $false

            if ($row.next_run_at) {
                $nextRun = [DateTimeOffset]::Parse(
                    $row.next_run_at
                ).ToUniversalTime()

                $ready = $nextRun -le [DateTimeOffset]::UtcNow
            }

            [PSCustomObject]@{
                iteration = "$i/$Iterations"
                id = $row.id
                agent = $row.agent
                task_type = $row.task_type
                status = $row.status
                attempts = $row.attempts
                max_attempts = $row.max_attempts
                next_run_at = $row.next_run_at
                ready_now = $ready
                error_message = $row.error_message
                started_at = $row.started_at
                completed_at = $row.completed_at
            } | Format-List

            if ($row.status -in @("completed", "failed")) {
                Write-Host "Terminal status reached." -ForegroundColor Green
                break
            }
        }
    }
    catch {
        $readErrors++

        Write-Host (
            "[{0}/{1}] READ ERROR: {2}" -f
            $i,
            $Iterations,
            $_.Exception.Message
        ) -ForegroundColor Red
    }

    if ($i -lt $Iterations) {
        Start-Sleep -Seconds $IntervalSeconds
    }
}

Write-Host ""
Write-Host "Successful reads: $successfulReads"
Write-Host "Read errors: $readErrors"

if ($readErrors -gt 0 -and $successfulReads -eq 0) {
    exit 1
}

exit 0