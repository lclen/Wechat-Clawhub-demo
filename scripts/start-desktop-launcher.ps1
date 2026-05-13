$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LauncherDir = Resolve-Path (Join-Path $RepoRoot "apps\desktop-launcher")
$LogDir = Join-Path $RepoRoot "logs\desktop-launcher"
$LogPath = Join-Path $LogDir "autostart.log"
$Port = 8765

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-LauncherLog {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogPath -Value "[$timestamp] $Message"
}

function Test-LauncherPort {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(500, $false)) {
            $client.Close()
            return $false
        }
        $client.EndConnect($connect)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Resolve-UvPath {
    $command = Get-Command "uv.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        "D:\miniconda3\Scripts\uv.exe",
        "$env:USERPROFILE\.local\bin\uv.exe",
        "$env:USERPROFILE\.cargo\bin\uv.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    throw "uv.exe was not found. Install uv or add it to PATH before enabling desktop launcher autostart."
}

if (Test-LauncherPort) {
    Write-LauncherLog "Launcher already responds on 127.0.0.1:$Port; skip autostart."
    exit 0
}

$UvPath = Resolve-UvPath
$Arguments = @("run", "python", "-m", "launcher.main")
Write-LauncherLog "Starting launcher from $LauncherDir with $UvPath $($Arguments -join ' ')"

$process = Start-Process `
    -FilePath $UvPath `
    -ArgumentList $Arguments `
    -WorkingDirectory $LauncherDir `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "launcher.stdout.log") `
    -RedirectStandardError (Join-Path $LogDir "launcher.stderr.log")

Write-LauncherLog "Started launcher process PID=$($process.Id)."
