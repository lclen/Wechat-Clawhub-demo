using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace WechatClawHub.WinUI.Services;

public sealed class LauncherSupervisor : IDisposable
{
    private const string LauncherExecutableName = "wechat-claw-hub-launcher.exe";
    private const string LauncherHost = "127.0.0.1";
    private const int LauncherPort = 8765;
    private static readonly Uri LauncherBaseUri = new($"http://{LauncherHost}:{LauncherPort}/");
    private static readonly Uri LauncherStatusUri = new(LauncherBaseUri, "local/bootstrap/status");
    private static readonly Uri LauncherStopUri = new(LauncherBaseUri, "local/bootstrap/stop");

    private readonly HttpClient httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(2),
    };

    private Process? ownedProcess;

    public async Task<LauncherStartResult> EnsureRunningAsync(CancellationToken cancellationToken)
    {
        if (await IsLauncherHealthyAsync(cancellationToken))
        {
            AppLog.Info("Reusing healthy external launcher.");
            return new LauncherStartResult(
                LauncherRuntimeState.ExternalRunning,
                "检测到已有本地桌面启动器，已复用当前实例。",
                LauncherBaseUri);
        }

        string? launcherPath = ResolveLauncherPath();
        if (string.IsNullOrWhiteSpace(launcherPath))
        {
            return new LauncherStartResult(
                LauncherRuntimeState.Failed,
                $"未找到 {LauncherExecutableName}。请先运行 scripts\\build-winui-client.ps1 生成内置 launcher。",
                LauncherBaseUri);
        }

        ownedProcess = StartLauncher(launcherPath);
        AppLog.Info($"Started owned launcher process: {ownedProcess.Id}.");
        LauncherStartResult result = await WaitForLauncherAsync(cancellationToken);
        if (result.State == LauncherRuntimeState.Ready)
        {
            return result;
        }

        await StopOwnedRuntimeAsync();
        return result;
    }

    public async Task StopOwnedRuntimeAsync()
    {
        Process? process = ownedProcess;
        if (process is null)
        {
            return;
        }

        ownedProcess = null;

        if (!process.HasExited)
        {
            try
            {
                AppLog.Info("Stopping owned launcher runtime through local API.");
                using StringContent content = new("{}", Encoding.UTF8, "application/json");
                await httpClient.PostAsync(LauncherStopUri, content);
            }
            catch (Exception)
            {
            }
        }

        if (!process.HasExited)
        {
            try
            {
                AppLog.Info("Killing owned launcher process tree.");
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
            }
            catch (Exception)
            {
            }
        }

        process.Dispose();
    }

    public void Dispose()
    {
        httpClient.Dispose();
        ownedProcess?.Dispose();
    }

    private static Process StartLauncher(string launcherPath)
    {
        ProcessStartInfo startInfo = new()
        {
            FileName = launcherPath,
            WorkingDirectory = Path.GetDirectoryName(launcherPath) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add("--host");
        startInfo.ArgumentList.Add(LauncherHost);
        startInfo.ArgumentList.Add("--port");
        startInfo.ArgumentList.Add(LauncherPort.ToString());

        Process? process = Process.Start(startInfo);
        return process ?? throw new InvalidOperationException("无法启动桌面启动器进程。");
    }

    private async Task<LauncherStartResult> WaitForLauncherAsync(CancellationToken cancellationToken)
    {
        for (int attempt = 0; attempt < 90; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (ownedProcess is { HasExited: true })
            {
                return new LauncherStartResult(
                    LauncherRuntimeState.Failed,
                    $"桌面启动器进程已退出，退出码：{ownedProcess.ExitCode}。",
                    LauncherBaseUri);
            }

            if (await IsLauncherHealthyAsync(cancellationToken))
            {
                return new LauncherStartResult(
                    LauncherRuntimeState.Ready,
                    "桌面启动器已就绪。",
                    LauncherBaseUri);
            }

            await Task.Delay(500, cancellationToken);
        }

        return new LauncherStartResult(
            LauncherRuntimeState.Failed,
            "127.0.0.1:8765 未返回桌面启动器状态，端口可能被其他程序占用或 launcher 启动失败。",
            LauncherBaseUri);
    }

    private async Task<bool> IsLauncherHealthyAsync(CancellationToken cancellationToken)
    {
        try
        {
            using HttpResponseMessage response = await httpClient.GetAsync(LauncherStatusUri, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            string content = await response.Content.ReadAsStringAsync(cancellationToken);
            return content.Contains("\"profile\"", StringComparison.OrdinalIgnoreCase)
                && content.Contains("\"components\"", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static string? ResolveLauncherPath()
    {
        string? explicitPath = Environment.GetEnvironmentVariable("WCH_LAUNCHER_EXE");
        if (File.Exists(explicitPath))
        {
            return explicitPath;
        }

        string baseDirectory = AppContext.BaseDirectory;
        string[] candidates =
        [
            Path.Combine(baseDirectory, "runtime", LauncherExecutableName),
            Path.Combine(baseDirectory, LauncherExecutableName),
            Path.GetFullPath(Path.Combine(baseDirectory, "..", "..", "..", "..", "..", "dist", "desktop-launcher", LauncherExecutableName)),
        ];

        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }
}
