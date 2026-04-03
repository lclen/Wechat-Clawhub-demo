param(
    [Parameter(Mandatory = $true)][string]$NodeId,
    [Parameter(Mandatory = $true)][string]$GatewayBaseUrl,
    [Parameter(Mandatory = $true)][string]$NodeToken,
    [string]$PairingKey = "",
    [string]$DifyBaseUrl = "",
    [string]$DifyApiKey = "",
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

function Write-Step([string]$Message) {
    Write-Host "[step] $Message"
}

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path $Path)) {
        return ""
    }
    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Read-InstallState([string]$Path) {
    if (-not (Test-Path $Path)) {
        return @{}
    }
    try {
        return Get-Content $Path -Raw | ConvertFrom-Json -AsHashtable
    }
    catch {
        return @{}
    }
}

function Write-InstallState([string]$Path, [hashtable]$State) {
    ($State | ConvertTo-Json -Depth 6) | Set-Content -Path $Path -Encoding UTF8
}

function Test-ServiceInstalled([string]$Name) {
    $null = & sc.exe query $Name 2>$null
    return $LASTEXITCODE -eq 0
}

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

$StatePath = Join-Path $InstallDir "install-state.json"
$BundleHash = Get-FileSha256 $BundlePath
$PreviousState = Read-InstallState $StatePath
$PythonVersion = (& python --version 2>&1).ToString().Trim()

$StagingDir = Join-Path $InstallDir "bundle"
$ReuseBundle = (
    ($PreviousState["bundle_sha256"] -eq $BundleHash) -and
    (Test-Path $StagingDir)
)
if (-not $ReuseBundle) {
    Write-Step "bundle 发生变化，重新解压节点运行包"
    if (Test-Path $StagingDir) {
        Remove-Item -Recurse -Force $StagingDir
    }
    Ensure-Directory $StagingDir
    Expand-Archive -Path $BundlePath -DestinationPath $StagingDir -Force
}
else {
    Write-Step "检测到相同 bundle，复用已有解压目录"
}

$NodeRoot = Join-Path $StagingDir "claw-node"
$ProjectRoot = Join-Path $NodeRoot "services\claw-node"
if (-not (Test-Path $ProjectRoot)) {
    $ProjectRoot = $NodeRoot
}

$VenvDir = Join-Path $InstallDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$PipExe = Join-Path $VenvDir "Scripts\pip.exe"
$ReuseVenv = (
    ($PreviousState["bundle_sha256"] -eq $BundleHash) -and
    ($PreviousState["python_version"] -eq $PythonVersion) -and
    (Test-Path $PythonExe) -and
    (Test-Path $PipExe)
)
if (-not $ReuseVenv) {
    Write-Step "准备 Python 虚拟环境"
    & python -m venv $VenvDir
}
else {
    Write-Step "检测到可复用的 Python 虚拟环境，跳过重建"
}

$RequiresDependencyInstall = -not (
    ($PreviousState["bundle_sha256"] -eq $BundleHash) -and
    ($PreviousState["project_root"] -eq $ProjectRoot) -and
    (Test-Path $PythonExe) -and
    (Test-Path $PipExe)
)
if ($RequiresDependencyInstall) {
    Write-Step "安装或更新节点 Python 依赖"
    & $PipExe install --upgrade pip
    & $PipExe install -e $ProjectRoot
}
else {
    Write-Step "检测到依赖未变化，跳过 pip 安装"
}

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
Write-Step "写入节点 .env 配置"
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
    if (Test-ServiceInstalled $ServiceName) {
        Write-Step "检测到服务已存在，尝试停止后复用现有服务"
        & $ServiceExeTarget stop 2>$null
    }
    else {
        Write-Step "注册 Windows 服务"
        & $ServiceExeTarget install
    }
    Write-Step "启动节点服务"
    & $ServiceExeTarget start
}
finally {
    Pop-Location
}

Write-InstallState $StatePath @{
    bundle_sha256 = $BundleHash
    python_version = $PythonVersion
    project_root = $ProjectRoot
    service_name = $ServiceName
    updated_at = (Get-Date).ToString("s")
}

Write-Host "claw-node installation complete."
Write-Host "Service name: $ServiceName"
Write-Host "Install dir : $InstallDir"
Write-Host "Project root: $ProjectRoot"
Write-Host "Logs dir    : $LogDir"
