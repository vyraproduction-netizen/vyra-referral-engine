[CmdletBinding()]
param(
    [ValidateRange(5, 30)]
    [int]$IntervalMinutes = 5,
    [ValidateRange(2, 24)]
    [int]$DurationHours = 12,
    [switch]$Apply,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $Remove) { throw 'Choose Apply or Remove, not both' }
$taskName = 'VYRA Local Mock Queue Pilot'
$tickScript = Join-Path $PSScriptRoot 'run-local-mock-queue-tick.ps1'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($Remove) {
    if ($existing) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "[PASS] Removed local mock queue task: $taskName"
    } else {
        Write-Host '[PASS] Local mock queue task was already absent'
    }
    return
}

if (-not (Test-Path -LiteralPath $tickScript -PathType Leaf)) {
    throw "Mock queue tick script not found: $tickScript"
}

if ($existing) {
    throw "Task already exists; inspect or remove it before changing: $taskName"
}

$userName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$start = (Get-Date).AddMinutes(2)
Write-Host "Task: $taskName"
Write-Host "Account: $userName (interactive session only)"
Write-Host "Script: $tickScript"
Write-Host "First run: $start"
Write-Host "Interval: $IntervalMinutes minutes"
Write-Host "Test window: $DurationHours hours"
Write-Host 'Provider safety: active runtime and local file must all be mock'
Write-Host 'Each run handles at most one local queue job'

if (-not $Apply) {
    Write-Host '[DRY RUN] No scheduled task created; use -Apply after review'
    return
}

$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    '"' + $tickScript + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At $start `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Hours $DurationHours)
$principal = New-ScheduledTaskPrincipal -UserId $userName `
    -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3)

Register-ScheduledTask -TaskName $taskName -Action $action `
    -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Temporary local mock-only VYRA queue pilot.' | Out-Null

$registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if (-not $registered) { throw 'Task registration could not be verified' }
Write-Host "[PASS] Registered temporary local mock queue task: $taskName"
