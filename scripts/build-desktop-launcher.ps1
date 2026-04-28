param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist\desktop-launcher"
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

Write-Host "Building agent console bundle..."
Push-Location (Join-Path $RepoRoot "apps\agent-console")
try {
    Invoke-Checked { npm run build } "npm run build"
}
finally {
    Pop-Location
}

Write-Host "Building desktop launcher EXE..."
Push-Location (Join-Path $RepoRoot "apps\desktop-launcher")
try {
    Invoke-Checked { python -m pip install -e "$RepoRoot\services\claw-node" } "pip install claw-node"
    Invoke-Checked { python -m pip install -e ".[build]" } "pip install desktop-launcher"
    Invoke-Checked {
        pyinstaller `
          --noconfirm `
          --clean `
          --onefile `
          --name wechat-claw-hub-launcher `
          --add-data "$RepoRoot\apps\agent-console\dist;apps/agent-console/dist" `
          --add-data "$RepoRoot\apps\gateway;apps/gateway" `
          --add-data "$RepoRoot\services\claw-node;services/claw-node" `
          --add-data "$RepoRoot\scripts\install-claw-node.ps1;scripts" `
          --add-data "$RepoRoot\dist\claw-node-bundle.zip;dist" `
          --add-data "$RepoRoot\infra\windows\winsw;infra/windows/winsw" `
          --collect-submodules fastapi.middleware `
          --collect-submodules pydantic_settings `
          --collect-submodules redis `
          --collect-submodules qrcode `
          --collect-submodules Crypto `
          --distpath $OutputDir `
          launcher\main.py
    } "pyinstaller"
}
finally {
    Pop-Location
}

Write-Host "Desktop launcher build complete: $OutputDir"
