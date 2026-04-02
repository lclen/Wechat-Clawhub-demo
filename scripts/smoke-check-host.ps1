param(
    [string]$GatewayBaseUrl = "http://127.0.0.1:8000",
    [string]$LauncherBaseUrl = "",
    [string]$ExpectedNodeId = "",
    [int]$DiscoveryTimeoutMs = 1200,
    [switch]$RunDiscoveryScan
)

$ErrorActionPreference = "Stop"

$Failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) {
    $Failures.Add($Message) | Out-Null
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Write-Pass([string]$Message) {
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Write-Info([string]$Message) {
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Normalize-BaseUrl([string]$Value) {
    return $Value.TrimEnd("/")
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [object]$Body = $null
    )

    $params = @{
        Method      = $Method
        Uri         = $Uri
        TimeoutSec  = 15
        ErrorAction = "Stop"
    }

    if ($null -ne $Body) {
        $params["ContentType"] = "application/json"
        $params["Body"] = ($Body | ConvertTo-Json -Depth 8)
    }

    return Invoke-RestMethod @params
}

function Test-DirectoryValue([string]$Label, [string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        Add-Failure "$Label is empty."
        return
    }
    if (-not (Test-Path -LiteralPath $PathValue)) {
        Add-Failure "$Label does not exist: $PathValue"
        return
    }
    Write-Pass "$Label exists: $PathValue"
}

$GatewayBaseUrl = Normalize-BaseUrl $GatewayBaseUrl
if (-not [string]::IsNullOrWhiteSpace($LauncherBaseUrl)) {
    $LauncherBaseUrl = Normalize-BaseUrl $LauncherBaseUrl
}

Write-Info "Checking host API: $GatewayBaseUrl"

try {
    $system = Invoke-JsonRequest -Method "GET" -Uri "$GatewayBaseUrl/api/system/status"
    if (-not $system.redis_ok) {
        Add-Failure "Host Redis is not ready (redis_ok=false)."
    }
    else {
        Write-Pass "System status OK, Redis ready, active nodes: $($system.active_nodes)"
    }
}
catch {
    Add-Failure "GET /api/system/status failed: $($_.Exception.Message)"
}

try {
    $profile = Invoke-JsonRequest -Method "GET" -Uri "$GatewayBaseUrl/api/setup/profile"
    Write-Pass "Setup profile loaded, recommended workspace: $($profile.recommended_workspace)"
}
catch {
    Add-Failure "GET /api/setup/profile failed: $($_.Exception.Message)"
}

try {
    $nodesResponse = Invoke-JsonRequest -Method "GET" -Uri "$GatewayBaseUrl/api/nodes"
    $nodeCount = @($nodesResponse.nodes).Count
    Write-Pass "Node list loaded, current node count: $nodeCount"

    if (-not [string]::IsNullOrWhiteSpace($ExpectedNodeId)) {
        $expectedNode = @($nodesResponse.nodes) | Where-Object { $_.node_id -eq $ExpectedNodeId } | Select-Object -First 1
        if ($null -eq $expectedNode) {
            Add-Failure "Expected node not found: $ExpectedNodeId"
        }
        else {
            Write-Pass "Expected node found: $ExpectedNodeId (status: $($expectedNode.status))"
        }
    }
}
catch {
    Add-Failure "GET /api/nodes failed: $($_.Exception.Message)"
}

try {
    $sessionsResponse = Invoke-JsonRequest -Method "GET" -Uri "$GatewayBaseUrl/api/sessions"
    $sessionCount = @($sessionsResponse.sessions).Count
    Write-Pass "Session list loaded, current session count: $sessionCount"
}
catch {
    Add-Failure "GET /api/sessions failed: $($_.Exception.Message)"
}

if ($RunDiscoveryScan.IsPresent) {
    try {
        $scanResponse = Invoke-JsonRequest -Method "POST" -Uri "$GatewayBaseUrl/api/setup/discovery/scan" -Body @{ timeout_ms = $DiscoveryTimeoutMs }
        $discoveredCount = @($scanResponse.nodes).Count
        Write-Pass "Discovery scan succeeded, discovered candidates: $discoveredCount"
    }
    catch {
        Add-Failure "POST /api/setup/discovery/scan failed: $($_.Exception.Message)"
    }
}

if (-not [string]::IsNullOrWhiteSpace($LauncherBaseUrl)) {
    Write-Info "Checking desktop launcher: $LauncherBaseUrl"
    try {
        $launcher = Invoke-JsonRequest -Method "GET" -Uri "$LauncherBaseUrl/local/bootstrap/status"
        Write-Pass "Launcher status loaded, workdir: $($launcher.layout.root)"

        if (-not [string]::IsNullOrWhiteSpace($launcher.layout.root)) {
            Test-DirectoryValue -Label "Workdir" -PathValue $launcher.layout.root
            Test-DirectoryValue -Label "TranscriptDir" -PathValue $launcher.layout.transcript_dir
            Test-DirectoryValue -Label "IdentityDir" -PathValue $launcher.layout.identity_dir
            Test-DirectoryValue -Label "MemoryDir" -PathValue $launcher.layout.memory_dir
            Test-DirectoryValue -Label "RuntimeDir" -PathValue $launcher.layout.runtime_dir
        }
    }
    catch {
        Add-Failure "GET /local/bootstrap/status failed: $($_.Exception.Message)"
    }
}

if ($Failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Host smoke check failed with $($Failures.Count) issue(s):" -ForegroundColor Red
    $Failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}

Write-Host ""
Write-Host "Host smoke check passed." -ForegroundColor Green
