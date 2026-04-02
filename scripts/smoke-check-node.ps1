param(
    [string]$GatewayBaseUrl = "",
    [string]$NodeId = "",
    [string]$NodeEnvPath = "services/claw-node/.env",
    [int]$HeartbeatFreshSeconds = 60,
    [switch]$RequirePairingKey
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

function Read-DotEnv([string]$Path) {
    $result = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $result
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
            continue
        }
        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) {
            continue
        }
        $result[$parts[0].Trim()] = $parts[1].Trim()
    }

    return $result
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri
    )

    return Invoke-RestMethod -Method $Method -Uri $Uri -TimeoutSec 15 -ErrorAction Stop
}

$envValues = Read-DotEnv -Path $NodeEnvPath

if ([string]::IsNullOrWhiteSpace($NodeId) -and $envValues.ContainsKey("CLAW_NODE_ID")) {
    $NodeId = $envValues["CLAW_NODE_ID"]
}
if ([string]::IsNullOrWhiteSpace($GatewayBaseUrl) -and $envValues.ContainsKey("CLAW_GATEWAY_BASE_URL")) {
    $GatewayBaseUrl = $envValues["CLAW_GATEWAY_BASE_URL"]
}

if ([string]::IsNullOrWhiteSpace($NodeId)) {
    Add-Failure "Missing NodeId. Use -NodeId or set CLAW_NODE_ID in $NodeEnvPath."
}
else {
    Write-Pass "Node ID: $NodeId"
}

if ([string]::IsNullOrWhiteSpace($GatewayBaseUrl)) {
    Add-Failure "Missing GatewayBaseUrl. Use -GatewayBaseUrl or set CLAW_GATEWAY_BASE_URL in $NodeEnvPath."
}
else {
    $GatewayBaseUrl = Normalize-BaseUrl $GatewayBaseUrl
    Write-Pass "Gateway URL: $GatewayBaseUrl"
}

if ($envValues.ContainsKey("CLAW_NODE_TOKEN") -and -not [string]::IsNullOrWhiteSpace($envValues["CLAW_NODE_TOKEN"])) {
    Write-Pass "Node token detected."
}
else {
    Add-Failure "CLAW_NODE_TOKEN is missing."
}

if ($RequirePairingKey.IsPresent) {
    if ($envValues.ContainsKey("CLAW_PAIRING_KEY") -and -not [string]::IsNullOrWhiteSpace($envValues["CLAW_PAIRING_KEY"])) {
        Write-Pass "Pairing key detected."
    }
    else {
        Add-Failure "RequirePairingKey is set but CLAW_PAIRING_KEY is missing."
    }
}
elseif ($envValues.ContainsKey("CLAW_PAIRING_KEY") -and -not [string]::IsNullOrWhiteSpace($envValues["CLAW_PAIRING_KEY"])) {
    Write-Pass "Pairing key detected."
}
else {
    Write-Info "Pairing key not found. Add CLAW_PAIRING_KEY if you want to verify LAN pairing."
}

if ($Failures.Count -eq 0) {
    try {
        $system = Invoke-JsonRequest -Method "GET" -Uri "$GatewayBaseUrl/api/system/status"
        if (-not $system.redis_ok) {
            Add-Failure "Host Redis is not ready (redis_ok=false)."
        }
        else {
            Write-Pass "Host system status OK, active nodes: $($system.active_nodes)"
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
        $node = @($nodesResponse.nodes) | Where-Object { $_.node_id -eq $NodeId } | Select-Object -First 1
        if ($null -eq $node) {
            Add-Failure "Node not found in host node list: $NodeId"
        }
        else {
            Write-Pass "Host sees node $NodeId (status: $($node.status))"

            if ($node.status -eq "offline") {
                Add-Failure "Node status is offline."
            }

            if (-not [string]::IsNullOrWhiteSpace($node.last_heartbeat_at)) {
                $heartbeatAt = [datetimeoffset]::Parse($node.last_heartbeat_at)
                $age = [math]::Abs(([datetimeoffset]::UtcNow - $heartbeatAt.ToUniversalTime()).TotalSeconds)
                if ($age -gt $HeartbeatFreshSeconds) {
                    Add-Failure "Last heartbeat is stale: about $([int]$age) second(s) ago."
                }
                else {
                    Write-Pass "Last heartbeat is fresh: about $([int]$age) second(s) ago."
                }
            }
            else {
                Add-Failure "Node last_heartbeat_at is missing."
            }
        }
    }
    catch {
        Add-Failure "GET /api/nodes failed: $($_.Exception.Message)"
    }
}

if ($envValues.ContainsKey("CLAW_LOCAL_CACHE_ENABLED")) {
    Write-Info "Local cache Redis enabled: $($envValues["CLAW_LOCAL_CACHE_ENABLED"])"
}

if ($Failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Node smoke check failed with $($Failures.Count) issue(s):" -ForegroundColor Red
    $Failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}

Write-Host ""
Write-Host "Node smoke check passed." -ForegroundColor Green
