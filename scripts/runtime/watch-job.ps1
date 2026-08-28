param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')]
    [string]$JobId,

    [string]$SupabaseUrl = "http://127.0.0.1:54321",

    [ValidateRange(1, 300)]
    [int]$IntervalSeconds = 2,

    [ValidateRange(1, 1000)]
    [int]$Iterations = 10,

    [switch]$AllowRemote
)

$ErrorActionPreference = "Stop"

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

$baseUrl = $SupabaseUrl.TrimEnd("/")
$escapedJobId = [System.Uri]::EscapeDataString($JobId)
$select = @(
    "id",
    "agent",
    "task_type",
    "status",
    "attempts",
    "max_attempts",
    "next_run_at",
    "error_message",
    "started_at",
    "completed_at"
) -join ","

$endpoint = (
    "$baseUrl/rest/v1/jobs" +
    "?id=eq.$escapedJobId" +
    "&select=$select"
)

$headers = @{
    "Accept-Profile" = "public"
}

$publishableKey = $env:SUPABASE_PUBLISHABLE_KEY
if (-not $publishableKey) {
    $publishableKey = $env:SUPABASE_ANON_KEY
}

if ($publishableKey) {
    $headers["apikey"] = $publishableKey
    $headers["Authorization"] = "Bearer $publishableKey"
}
elseif (-not $isLocalHost) {
    throw (
        "SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY " +
        "is required for remote read-only access."
    )
}

Write-Host "=== VYRA job watch ===" -ForegroundColor Cyan
Write-Host "Target: $($uri.Scheme)://$($uri.Authority)"
Write-Host "JobId: $JobId"
Write-Host "Mode: READ ONLY"

$successfulReads = 0
$readErrors = 0

for ($i = 1; $i -le $Iterations; $i++) {
    try {
        $rows = Invoke-RestMethod `
            -Uri $endpoint `
            -Headers $headers `
            -Method Get

        $row = $rows | Select-Object -First 1

        if (-not $row) {
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
