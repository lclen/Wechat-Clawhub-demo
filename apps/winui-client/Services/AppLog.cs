using System;
using System.IO;

namespace WechatClawHub.WinUI.Services;

internal static class AppLog
{
    private static readonly object Lock = new();
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "WechatClawHub",
        "winui-client.log");

    public static void Info(string message) => Write("INFO", message);

    public static void Error(string message, Exception? exception = null)
    {
        Write("ERROR", exception is null ? message : $"{message}{Environment.NewLine}{exception}");
    }

    private static void Write(string level, string message)
    {
        lock (Lock)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            File.AppendAllText(
                LogPath,
                $"{DateTimeOffset.Now:O} [{level}] {message}{Environment.NewLine}",
                System.Text.Encoding.UTF8);
        }
    }
}
