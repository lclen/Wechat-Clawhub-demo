param(
    [Parameter(Mandatory = $true)][string]$NodeId,
    [Parameter(Mandatory = $true)][string]$GatewayBaseUrl,
    [Parameter(Mandatory = $true)][string]$NodeToken,
    [string]$PairingKey = "",
    [Parameter(Mandatory = $true)][string]$DifyBaseUrl,
    [Parameter(Mandatory = $true)][string]$DifyApiKey,
    [Parameter(Mandatory = $true)][int]$MaxConcurrency,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [string]$BundlePath = "",
    [bool]$DiscoveryEnabled = $true,
    [int]$DiscoveryPort = 9531,
    [bool]$LocalCacheEnabled = $false,
    [string]$LocalCacheRedisUrl = "",
    [int]$LocalCacheTtlSeconds = 900
)

$ErrorActionPreference = "Stop"

function Test-PythonVersion {
    $output = & python --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.11+ is required but 'python' was not found."
    }
    if ($output -notmatch "Python 3\.1[1-9]") {
        throw "Python 3.11+ is required. Detected: $output"
    }
}

function Ensure-Directory([string]$Path) {
    New-Item -ItemType Directory -Force $Path | Out-Null
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($BundlePath)) {
    $BundlePath = Join-Path (Split-Path -Parent $ScriptDir) "dist\claw-node-bundle.zip"
}

if (-not (Test-Path $BundlePath)) {
    throw "Bundle archive not found: $BundlePath"
}

Test-PythonVersion
Ensure-Directory $InstallDir

$StagingDir = Join-Path $InstallDir "bundle"
if (Test-Path $StagingDir) {
    Remove-Item -Recurse -Force $StagingDir
}
Ensure-Directory $StagingDir

Expand-Archive -Path $BundlePath -DestinationPath $StagingDir -Force

$NodeRoot = Join-Path $StagingDir "claw-node"
$ProjectRoot = Join-Path $NodeRoot "services\claw-node"
if (-not (Test-Path $ProjectRoot)) {
    $ProjectRoot = $NodeRoot
}

$VenvDir = Join-Path $InstallDir ".venv"
& python -m venv $VenvDir

$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$PipExe = Join-Path $VenvDir "Scripts\pip.exe"

& $PipExe install --upgrade pip
& $PipExe install -e $ProjectRoot

$EnvContent = @"
CLAW_NODE_ID=$NodeId
CLAW_GATEWAY_BASE_URL=$GatewayBaseUrl
CLAW_NODE_TOKEN=$NodeToken
CLAW_PAIRING_KEY=$PairingKey
CLAW_DISCOVERY_ENABLED=$DiscoveryEnabled
CLAW_DISCOVERY_PORT=$DiscoveryPort
CLAW_PAIRING_LABEL=$NodeId
CLAW_LOCAL_CACHE_ENABLED=$LocalCacheEnabled
CLAW_LOCAL_CACHE_REDIS_URL=$LocalCacheRedisUrl
CLAW_LOCAL_CACHE_TTL_SECONDS=$LocalCacheTtlSeconds
CLAW_DIFY_BASE_URL=$DifyBaseUrl
CLAW_DIFY_API_KEY=$DifyApiKey
CLAW_MAX_CONCURRENCY=$MaxConcurrency
CLAW_PULL_INTERVAL_MS=1500
CLAW_HEARTBEAT_INTERVAL_SECONDS=5
CLAW_NODE_VERSION=0.1.0
CLAW_NODE_ADVERTISED_HOST=
CLAW_NODE_ADVERTISED_PORT=0
CLAW_NODE_HOSTNAME=
"@
Set-Content -Path (Join-Path $ProjectRoot ".env") -Value $EnvContent -Encoding UTF8

$ServiceName = "wechat-claw-node-$NodeId"
$LogDir = Join-Path $InstallDir "logs"
Ensure-Directory $LogDir

$TemplatePath = Join-Path $StagingDir "winsw\service.xml.template"
if (-not (Test-Path $TemplatePath)) {
    throw "WinSW XML template not found: $TemplatePath"
}
$Template = Get-Content $TemplatePath -Raw
$Rendered = $Template `
    -replace "__SERVICE_ID__", $ServiceName `
    -replace "__SERVICE_NAME__", $ServiceName `
    -replace "__SERVICE_DESCRIPTION__", "wechat-claw-hub worker node $NodeId" `
    -replace "__PYTHON_EXE__", ($PythonExe -replace "\\", "\\") `
    -replace "__PROJECT_ROOT__", ($ProjectRoot -replace "\\", "\\") `
    -replace "__LOG_DIR__", ($LogDir -replace "\\", "\\")

$ServiceExeSource = Join-Path $StagingDir "winsw\WinSW-x64.exe"
if (-not (Test-Path $ServiceExeSource)) {
    $ServiceExeSource = Join-Path $StagingDir "winsw\WinSW.exe"
}
if (-not (Test-Path $ServiceExeSource)) {
    throw "WinSW executable not found in bundle. Put WinSW-x64.exe or WinSW.exe under infra/windows/winsw before building the bundle."
}

$ServiceExeTarget = Join-Path $InstallDir "$ServiceName.exe"
$ServiceXmlTarget = Join-Path $InstallDir "$ServiceName.xml"

Copy-Item -Force $ServiceExeSource $ServiceExeTarget
Set-Content -Path $ServiceXmlTarget -Value $Rendered -Encoding UTF8

Push-Location $InstallDir
try {
    & $ServiceExeTarget install
    & $ServiceExeTarget start
}
finally {
    Pop-Location
}

Write-Host "claw-node installation complete."
Write-Host "Service name: $ServiceName"
Write-Host "Install dir : $InstallDir"
Write-Host "Project root: $ProjectRoot"
Write-Host "Logs dir    : $LogDir"
