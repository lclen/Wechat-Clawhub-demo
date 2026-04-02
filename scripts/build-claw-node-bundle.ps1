param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist"
}

$BundleRoot = Join-Path $OutputDir "claw-node-bundle"
$ZipPath = Join-Path $OutputDir "claw-node-bundle.zip"

Write-Host "Preparing bundle output at $BundleRoot"
New-Item -ItemType Directory -Force $OutputDir | Out-Null
if (Test-Path $BundleRoot) {
    Remove-Item -Recurse -Force $BundleRoot
}
New-Item -ItemType Directory -Force $BundleRoot | Out-Null

$NodeSource = Join-Path $RepoRoot "services\claw-node"
$WinSWSource = Join-Path $RepoRoot "infra\windows\winsw"

Copy-Item -Recurse -Force $NodeSource (Join-Path $BundleRoot "claw-node")
Copy-Item -Recurse -Force $WinSWSource (Join-Path $BundleRoot "winsw")

$EnvExample = @"
CLAW_NODE_ID=node-1
CLAW_GATEWAY_BASE_URL=http://192.168.1.10:8000
CLAW_NODE_TOKEN=replace-me
CLAW_PAIRING_KEY=replace-me
CLAW_DISCOVERY_ENABLED=true
CLAW_DISCOVERY_PORT=9531
CLAW_PAIRING_LABEL=node-1
CLAW_LOCAL_CACHE_ENABLED=false
CLAW_LOCAL_CACHE_REDIS_URL=
CLAW_LOCAL_CACHE_TTL_SECONDS=900
CLAW_DIFY_BASE_URL=http://192.168.1.20/v1
CLAW_DIFY_API_KEY=replace-me
CLAW_MAX_CONCURRENCY=2
CLAW_PULL_INTERVAL_MS=1500
CLAW_HEARTBEAT_INTERVAL_SECONDS=5
CLAW_NODE_VERSION=0.1.0
"@
Set-Content -Path (Join-Path $BundleRoot ".env.example") -Value $EnvExample -Encoding UTF8

if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}
Compress-Archive -Path (Join-Path $BundleRoot "*") -DestinationPath $ZipPath

Write-Host "Bundle created:"
Write-Host "  Directory: $BundleRoot"
Write-Host "  Archive  : $ZipPath"
