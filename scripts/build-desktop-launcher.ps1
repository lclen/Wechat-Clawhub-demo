param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist\desktop-launcher"
}

Write-Host "Building agent console bundle..."
Push-Location (Join-Path $RepoRoot "apps\agent-console")
try {
    npm run build
}
finally {
    Pop-Location
}

Write-Host "Building desktop launcher EXE..."
Push-Location (Join-Path $RepoRoot "apps\desktop-launcher")
try {
    python -m pip install -e .[build]
    pyinstaller `
      --noconfirm `
      --clean `
      --onefile `
      --name wechat-claw-hub-launcher `
      --add-data "$RepoRoot\apps\agent-console\dist;apps/agent-console/dist" `
      --add-data "$RepoRoot\apps\gateway;apps/gateway" `
      --add-data "$RepoRoot\services\claw-node;services/claw-node" `
      --distpath $OutputDir `
      launcher\main.py
}
finally {
    Pop-Location
}

Write-Host "Desktop launcher build complete: $OutputDir"
