param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$LauncherOutput = Join-Path $RepoRoot "dist\desktop-launcher"
$ClientProject = Join-Path $RepoRoot "apps\winui-client\WechatClawHub.WinUI.csproj"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist\winui-client"
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

Write-Host "Building embedded desktop launcher..."
Invoke-Checked { & (Join-Path $ScriptDir "build-desktop-launcher.ps1") -OutputDir $LauncherOutput } "build-desktop-launcher.ps1"

Write-Host "Publishing WinUI client..."
Invoke-Checked {
    dotnet publish $ClientProject `
        -c $Configuration `
        -r $Runtime `
        --self-contained false `
        -p:WindowsPackageType=None `
        -p:WindowsAppSDKSelfContained=true `
        -o $OutputDir
} "dotnet publish"

Write-Host "WinUI client publish complete: $OutputDir"
