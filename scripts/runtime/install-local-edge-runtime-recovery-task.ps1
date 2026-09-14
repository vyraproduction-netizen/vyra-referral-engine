param(
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

$taskName = "VYRA Local Edge Runtime Recovery"
$recoveryScript = Join-Path `
    $PSScriptRoot `
    "ensure-local-edge-runtime.ps1"

if (-not (Test-Path -LiteralPath $recoveryScript -PathType Leaf)) {
    throw "Recovery script was not found: $recoveryScript"
}

$existingTask = Get-ScheduledTask `
    -TaskName $taskName `
    -ErrorAction SilentlyContinue

if ($Remove) {
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

    exit 0
}

$currentUser =
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$actionArguments = (
    "-NoProfile -ExecutionPolicy Bypass -File " +
    "`"$recoveryScript`" -Repair"
)

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $actionArguments

$trigger = New-ScheduledTaskTrigger `
    -AtLogOn `
    -User $currentUser

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description (
        "Checks and safely recovers local VYRA Edge Runtime after sign-in."
    ) `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName

Write-Host (
    "[PASS] Scheduled task installed: {0} ({1})" -f
    $task.TaskName,
    $task.State
) -ForegroundColor Green