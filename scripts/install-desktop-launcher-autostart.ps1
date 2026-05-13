$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$StartScript = Resolve-Path (Join-Path $PSScriptRoot "start-desktop-launcher.ps1")
$TaskName = "WeChat Claw Hub Desktop Launcher"
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$TaskArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""

$action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $TaskArgs -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Start wechat-claw-hub desktop launcher after the current user logs on." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Start script: $StartScript"
Write-Host "To test now: Start-ScheduledTask -TaskName `"$TaskName`""
