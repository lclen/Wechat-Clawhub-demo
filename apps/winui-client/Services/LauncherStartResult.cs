using System;

namespace WechatClawHub.WinUI.Services;

public sealed record LauncherStartResult(LauncherRuntimeState State, string Detail, Uri BaseUri);
