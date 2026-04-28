# WinUI Client

`apps/winui-client` 是 Windows 桌面客户端壳，使用 WinUI 3 + WebView2 承载现有 `agent-console`。

## 运行模型

- 客户端启动后先检查 `http://127.0.0.1:8765/local/bootstrap/status`。
- 如果已有健康 launcher，客户端复用它，不接管退出生命周期。
- 如果没有健康 launcher，客户端启动内置 `runtime/wechat-claw-hub-launcher.exe --host 127.0.0.1 --port 8765`。
- WebView2 加载 `http://127.0.0.1:8765/`，所有业务 UI 仍由 React 控制台提供。
- 客户端关闭时，只停止由本客户端启动的 launcher，并调用 `/local/bootstrap/stop` 收口子进程。

## 构建

从仓库根目录运行：

```powershell
.\scripts\build-winui-client.ps1
```

默认会执行自包含发布，输出包内携带 .NET Desktop Runtime，目标电脑不需要单独安装 .NET。
如需生成更小的依赖型包，可以显式传入：

```powershell
.\scripts\build-winui-client.ps1 -SelfContained $false
```

构建顺序：

1. `apps/agent-console` 执行 `npm run build`。
2. `apps/desktop-launcher` 通过 PyInstaller 生成 `dist/desktop-launcher/wechat-claw-hub-launcher.exe`。
3. `apps/winui-client` 发布到 `dist/winui-client`。

## 开发调试

如果不先运行完整构建，可以设置 `WCH_LAUNCHER_EXE` 指向已有 launcher：

```powershell
$env:WCH_LAUNCHER_EXE="D:\wechat-claw-hub\dist\desktop-launcher\wechat-claw-hub-launcher.exe"
dotnet run --project .\apps\winui-client\WechatClawHub.WinUI.csproj -c Debug -r win-x64
```
