[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$SkipPipUpgrade
)

$ErrorActionPreference = "Stop"

function Resolve-PythonCommand {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @("py", "-3")
    }

    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @("python")
    }

    throw "Python 未安装或未加入 PATH。"
}

$pythonCommand = Resolve-PythonCommand

if (-not $SkipPipUpgrade) {
    if ($pythonCommand.Length -gt 1) {
        & $pythonCommand[0] $pythonCommand[1] -m pip install --upgrade graphifyy
    }
    else {
        & $pythonCommand[0] -m pip install --upgrade graphifyy
    }
}

Push-Location $ProjectRoot
try {
    if ($pythonCommand.Length -gt 1) {
        & $pythonCommand[0] $pythonCommand[1] -m graphify install --platform codex
    }
    else {
        & $pythonCommand[0] -m graphify install --platform codex
    }
    Write-Host "graphify 已安装到 Codex，并已在项目目录执行 codex 平台集成。"
    Write-Host "建议继续运行: graphify ."
}
finally {
    Pop-Location
}
