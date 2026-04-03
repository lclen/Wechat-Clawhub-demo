param(
    [Parameter(Mandatory = $true)][string]$NodeId,
    [Parameter(Mandatory = $true)][string]$GatewayBaseUrl,
    [Parameter(Mandatory = $true)][string]$NodeToken,
    [string]$PairingKey = "",
    [string]$DifyBaseUrl = "",
    [string]$DifyApiKey = "",
    [string]$OpenAIBaseUrl = "",
    [string]$OpenAIApiKey = "",
    [string]$OpenAIModel = "",
    [string]$OpenAIEnableThinking = "false",
    [Parameter(Mandatory = $true)][int]$MaxConcurrency,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [string]$BundlePath = "",
    [string]$DiscoveryEnabled = "true",
    [int]$DiscoveryPort = 9531,
    [string]$LocalCacheEnabled = "false",
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
function Stop-ServiceIfInstalled([string]$Name, [string]$ExecutablePath) {
    if (-not (Test-ServiceInstalled $Name)) {
        return
    }
    Write-Step "检测到服务已存在，先停止现有服务以释放文件句柄"
    if (Test-Path $ExecutablePath) {
        & $ExecutablePath stop 2>$null
    }
    else {
        $null = & sc.exe stop $Name 2>$null
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $service = Get-Service -Name $Name -ErrorAction Stop
            if ($service.Status -eq "Stopped") {
                return
            }
        }
        catch {
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Service '$Name' did not stop within the expected time."
}
function Wait-ForServiceDeletion([string]$Name) {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Test-ServiceInstalled $Name)) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Service '$Name' did not uninstall within the expected time."
}
function Remove-ServiceIfInstalled([string]$Name, [string]$ExecutablePath) {
    if (-not (Test-ServiceInstalled $Name)) {
        return
    }
    Stop-ServiceIfInstalled -Name $Name -ExecutablePath $ExecutablePath
    Write-Step "清理历史节点服务：$Name"
    if (Test-Path -LiteralPath $ExecutablePath) {
        & $ExecutablePath uninstall 2>$null
    }
    if (Test-ServiceInstalled $Name) {
        $null = & sc.exe delete $Name 2>$null
    }
    Wait-ForServiceDeletion -Name $Name
}
function Get-StaleServiceNames([string]$InstallDir, [string]$CurrentServiceName, [hashtable]$PreviousState) {
    $serviceNames = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    if ($PreviousState.ContainsKey("service_name")) {
        $previousServiceName = [string]$PreviousState["service_name"]
        if (-not [string]::IsNullOrWhiteSpace($previousServiceName) -and $previousServiceName -ne $CurrentServiceName) {
            $null = $serviceNames.Add($previousServiceName)
        }
    }
    Get-ChildItem -LiteralPath $InstallDir -Filter "wechat-claw-node-*.xml" -ErrorAction SilentlyContinue | ForEach-Object {
        $candidate = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and $candidate -ne $CurrentServiceName) {
            $null = $serviceNames.Add($candidate)
        }
    }
    return [string[]]$serviceNames
}
function Remove-StaleNodeServices([string]$InstallDir, [string]$CurrentServiceName, [hashtable]$PreviousState) {
    $staleNames = Get-StaleServiceNames -InstallDir $InstallDir -CurrentServiceName $CurrentServiceName -PreviousState $PreviousState
    foreach ($staleName in $staleNames) {
        $staleExePath = Join-Path $InstallDir "$staleName.exe"
        $staleXmlPath = Join-Path $InstallDir "$staleName.xml"
        Remove-ServiceIfInstalled -Name $staleName -ExecutablePath $staleExePath
        if (Test-Path -LiteralPath $staleExePath) {
            Remove-Item -LiteralPath $staleExePath -Force
        }
        if (Test-Path -LiteralPath $staleXmlPath) {
            Remove-Item -LiteralPath $staleXmlPath -Force
        }
    }
}
function Convert-ToBoolean([object]$Value, [bool]$Default = $false) {
    if ($null -eq $Value) {
        return $Default
    }
    if ($Value -is [bool]) {
        return $Value
    }
    $normalized = $Value.ToString().Trim().ToLowerInvariant()
    switch ($normalized) {
        '$true' { return $true }
        'true' { return $true }
        '1' { return $true }
        'yes' { return $true }
        'y' { return $true }
        '$false' { return $false }
        'false' { return $false }
        '0' { return $false }
        'no' { return $false }
        'n' { return $false }
        default {
            throw "Invalid boolean value: $Value"
        }
    }
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

function Get-BundlePathCandidates([string]$InputPath, [string]$ScriptDir, [string]$RepoRoot) {
    $candidates = New-Object System.Collections.Generic.List[string]

    function Add-Candidate([string]$Candidate) {
        if ([string]::IsNullOrWhiteSpace($Candidate)) {
            return
        }
        try {
            $full = [System.IO.Path]::GetFullPath($Candidate)
        }
        catch {
            return
        }
        if (-not $candidates.Contains($full)) {
            $candidates.Add($full)
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($InputPath)) {
        Add-Candidate $InputPath
        if (Test-Path $InputPath -PathType Container) {
            Add-Candidate (Join-Path $InputPath "claw-node-bundle.zip")
        }
        if (-not [System.IO.Path]::IsPathRooted($InputPath)) {
            Add-Candidate (Join-Path (Get-Location) $InputPath)
            Add-Candidate (Join-Path $RepoRoot $InputPath)
            if (Test-Path (Join-Path (Get-Location) $InputPath) -PathType Container) {
                Add-Candidate (Join-Path (Join-Path (Get-Location) $InputPath) "claw-node-bundle.zip")
            }
            if (Test-Path (Join-Path $RepoRoot $InputPath) -PathType Container) {
                Add-Candidate (Join-Path (Join-Path $RepoRoot $InputPath) "claw-node-bundle.zip")
            }
        }
    }

    Add-Candidate (Join-Path $RepoRoot "dist\claw-node-bundle.zip")
    Add-Candidate (Join-Path $RepoRoot "claw-node-bundle.zip")
    Add-Candidate (Join-Path (Get-Location) "dist\claw-node-bundle.zip")
    Add-Candidate (Join-Path (Get-Location) "claw-node-bundle.zip")
    Add-Candidate (Join-Path (Split-Path -Parent $ScriptDir) "dist\claw-node-bundle.zip")

    return $candidates
}

function Resolve-BundleArchivePath([string]$InputPath, [string]$ScriptDir, [string]$RepoRoot) {
    $candidates = Get-BundlePathCandidates -InputPath $InputPath -ScriptDir $ScriptDir -RepoRoot $RepoRoot
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate -PathType Leaf) {
            return @{
                Found = $true
                Path = $candidate
                Tried = $candidates
            }
        }
    }
    return @{
        Found = $false
        Path = $candidates[0]
        Tried = $candidates
    }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ResolvedBundle = Resolve-BundleArchivePath -InputPath $BundlePath -ScriptDir $ScriptDir -RepoRoot $RepoRoot
$BundlePath = $ResolvedBundle.Path

if (-not (Test-Path $BundlePath)) {
    $BuildScriptPath = Join-Path $ScriptDir "build-claw-node-bundle.ps1"
    if (-not (Test-Path $BuildScriptPath)) {
        throw "Bundle archive not found: $BundlePath; build script also missing: $BuildScriptPath"
    }
    Write-Host "Bundle archive not found, trying to build it. Candidates:"
    foreach ($candidate in $ResolvedBundle.Tried) {
        Write-Host "  - $candidate"
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $BuildScriptPath
    if ($LASTEXITCODE -ne 0) {
        throw "Bundle build failed with exit code $LASTEXITCODE"
    }
    $ResolvedBundle = Resolve-BundleArchivePath -InputPath $BundlePath -ScriptDir $ScriptDir -RepoRoot $RepoRoot
    $BundlePath = $ResolvedBundle.Path
    if (-not $ResolvedBundle.Found) {
        $TriedSummary = ($ResolvedBundle.Tried | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
        throw "Bundle archive not found after build. Tried:`n$TriedSummary"
    }
}

Test-PythonVersion
Ensure-Directory $InstallDir

$ServiceName = "wechat-claw-node-$NodeId"
$ServiceExeTarget = Join-Path $InstallDir "$ServiceName.exe"
$ServiceXmlTarget = Join-Path $InstallDir "$ServiceName.xml"
Stop-ServiceIfInstalled -Name $ServiceName -ExecutablePath $ServiceExeTarget

$StatePath = Join-Path $InstallDir "install-state.json"
$BundleHash = Get-FileSha256 $BundlePath
$PreviousState = Read-InstallState $StatePath
$PythonVersion = (& python --version 2>&1).ToString().Trim()
Remove-StaleNodeServices -InstallDir $InstallDir -CurrentServiceName $ServiceName -PreviousState $PreviousState

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

$DiscoveryEnabledBool = Convert-ToBoolean $DiscoveryEnabled $true
$LocalCacheEnabledBool = Convert-ToBoolean $LocalCacheEnabled $false
$OpenAIEnableThinkingBool = Convert-ToBoolean $OpenAIEnableThinking $false
$ModelProvider = "auto"
if (-not [string]::IsNullOrWhiteSpace($OpenAIBaseUrl) -and -not [string]::IsNullOrWhiteSpace($OpenAIApiKey) -and -not [string]::IsNullOrWhiteSpace($OpenAIModel)) {
    $ModelProvider = "openai"
}
elseif (-not [string]::IsNullOrWhiteSpace($DifyBaseUrl) -and -not [string]::IsNullOrWhiteSpace($DifyApiKey)) {
    $ModelProvider = "dify"
}

$EnvContent = @"
CLAW_NODE_ID=$NodeId
CLAW_GATEWAY_BASE_URL=$GatewayBaseUrl
CLAW_NODE_TOKEN=$NodeToken
CLAW_PAIRING_KEY=$PairingKey
CLAW_DISCOVERY_ENABLED=$DiscoveryEnabledBool
CLAW_DISCOVERY_PORT=$DiscoveryPort
CLAW_PAIRING_LABEL=$NodeId
CLAW_LOCAL_CACHE_ENABLED=$LocalCacheEnabledBool
CLAW_LOCAL_CACHE_REDIS_URL=$LocalCacheRedisUrl
CLAW_LOCAL_CACHE_TTL_SECONDS=$LocalCacheTtlSeconds
CLAW_MODEL_PROVIDER=$ModelProvider
CLAW_DIFY_BASE_URL=$DifyBaseUrl
CLAW_DIFY_API_KEY=$DifyApiKey
CLAW_OPENAI_BASE_URL=$OpenAIBaseUrl
CLAW_OPENAI_API_KEY=$OpenAIApiKey
CLAW_OPENAI_MODEL=$OpenAIModel
CLAW_OPENAI_ENABLE_THINKING=$OpenAIEnableThinkingBool
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

Copy-Item -Force $ServiceExeSource $ServiceExeTarget
Set-Content -Path $ServiceXmlTarget -Value $Rendered -Encoding UTF8

Push-Location $InstallDir
try {
    if (Test-ServiceInstalled $ServiceName) {
        Write-Step "检测到服务已存在，复用现有服务定义"
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
