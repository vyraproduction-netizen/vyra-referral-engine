param(
    [ValidateRange(5, 60)]
    [int]$WatchdogIntervalMinutes = 15,

    [switch]$Remove
)

$ErrorActionPreference = "Stop"

$recoveryTaskName = "VYRA Local Edge Runtime Recovery"
$watchdogTaskName = "VYRA Local Edge Runtime Watchdog"

$recoveryScript = Join-Path `
    $PSScriptRoot `
    "ensure-local-edge-runtime.ps1"

if (-not (Test-Path -LiteralPath $recoveryScript -PathType Leaf)) {
    throw "Recovery script was not found: $recoveryScript"
}

$taskNames = @(
    $recoveryTaskName,
    $watchdogTaskName
)

if ($Remove) {
    foreach ($taskName in $taskNames) {
        $existingTask = Get-ScheduledTask `
            -TaskName $taskName `
            -ErrorAction SilentlyContinue

        if ($existingTask) {
            Unregister-ScheduledTask `
                -TaskName $taskName `
                -Confirm:$false

            Write-Host (
                "[PASS] Removed scheduled task: $taskName"
            ) -ForegroundColor Green
        }
        else {
            Write-Host (
                "[PASS] Scheduled task was already absent: $taskName"
            ) -ForegroundColor Green
        }
    }

    exit 0
}

$currentUser =
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$recoveryArguments = (
    "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " +
    "`"$recoveryScript`" -Repair"
)

$watchdogArguments = (
    "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " +
    "`"$recoveryScript`" -Repair -Watchdog"
)

$recoveryAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $recoveryArguments

$watchdogAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $watchdogArguments

$recoveryTrigger = New-ScheduledTaskTrigger `
    -AtLogOn `
    -User $currentUser

$watchdogTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (
        New-TimeSpan -Minutes $WatchdogIntervalMinutes
    ) `
    -RepetitionDuration (
        New-TimeSpan -Days 3650
    )

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (
        New-TimeSpan -Minutes 5
    )

Register-ScheduledTask `
    -TaskName $recoveryTaskName `
    -Action $recoveryAction `
    -Trigger $recoveryTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description (
        "Checks and safely recovers local VYRA Edge Runtime after sign-in."
    ) `
    -Force | Out-Null

Register-ScheduledTask `
    -TaskName $watchdogTaskName `
    -Action $watchdogAction `
    -Trigger $watchdogTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description (
        "Checks running local VYRA Edge Runtime every " +
        "$WatchdogIntervalMinutes minutes without starting a stopped container."
    ) `
    -Force | Out-Null

Get-ScheduledTask `
    -TaskName $taskNames |
    Select-Object TaskName, State, TaskPath