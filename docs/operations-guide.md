# 运维操作手册

> **Status**: Active | **Last Updated**: 2026-04-07 | **Purpose**: 日常启动、排障、重置操作的快速参考

## Table of Contents

- [角色说明](#角色说明)
- [启动流程](#启动流程)
- [节点服务管理](#节点服务管理)
- [重新配置](#重新配置)
- [常见问题排查](#常见问题排查)
- [关键文件路径](#关键文件路径)

---

## 角色说明

| 角色 | 运行内容 | 不运行 |
|------|---------|--------|
| 网关主机 | launcher + Redis + gateway + 内置节点 | — |
| 工作节点 | launcher + 节点 Windows 服务 | gateway、Redis |
| 控制台 | launcher（连接远端网关） | gateway、Redis、节点 |

---

## 启动流程

### 网关端

```powershell
cd apps/desktop-launcher
uv run python -m launcher.main
```

打开 `http://localhost:8765`，选择"网关主机"角色，点击"一键启动"。

### 节点端

```powershell
cd apps/desktop-launcher
uv run python -m launcher.main
```

打开 `http://localhost:8765`，选择"工作节点"角色，填写目标网关地址后安装。

> [!IMPORTANT]
> 节点端启动 launcher 后，页面不会自动拉起 gateway。这是正确行为。

---

## 节点服务管理

节点安装后以 Windows 服务形式运行，服务名格式为 `wechat-claw-node-{node_id}`。

```powershell
# 查看状态
sc.exe query "wechat-claw-node-agent-1"

# 启动
sc.exe start "wechat-claw-node-agent-1"

# 停止
sc.exe stop "wechat-claw-node-agent-1"
```

### 节点配置文件

| 文件 | 用途 |
|------|------|
| `C:\wechat-claw-node\config\node.env` | 主配置文件（节点 ID、网关地址、token 等） |
| `C:\wechat-claw-node\bundle\claw-node\.env` | fallback，只含 `CLAW_ENV_FILE` 指向主配置 |
| `C:\wechat-claw-node\wechat-claw-node-{id}.xml` | WinSW 服务配置，含 `CLAW_ENV_FILE` 环境变量注入 |

### 验证节点 discovery 响应

```powershell
$udpClient = New-Object System.Net.Sockets.UdpClient
$udpClient.EnableBroadcast = $true
$bytes = [System.Text.Encoding]::UTF8.GetBytes('{"type":"discover","request_id":"test"}')
$udpClient.Send($bytes, $bytes.Length, "255.255.255.255", 9531) | Out-Null
$udpClient.Client.ReceiveTimeout = 2000
try {
    $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $r = $udpClient.Receive([ref]$ep)
    [System.Text.Encoding]::UTF8.GetString($r) | ConvertFrom-Json | Select-Object node_id, lan_ip, already_paired
} catch { "超时" } finally { $udpClient.Close() }
```

正常输出应包含正确的 `node_id` 和真实局域网 IP（如 `192.168.x.x`），不应是 `198.18.x.x`。

---

## 重新配置

在界面"快速配置 → 当前连接状态 → 重新配置"触发。

重新配置会执行：

1. 断开微信连接（仅网关角色）
2. 停止所有 launcher 组件
3. 清空节点 `.env` 中的 `CLAW_NODE_ID`、`CLAW_NODE_TOKEN`、`CLAW_GATEWAY_BASE_URL`、`CLAW_PAIRING_KEY`
4. 清空网关 `WCH_NODE_TOKENS` 和 Redis 节点注册表（仅网关角色）
5. 清理前端 localStorage 和表单状态

### 手动修复 launcher profile

如果 launcher 启动后仍然尝试拉起 gateway（节点端不应该），手动编辑：

```
%APPDATA%\wechat-claw-hub\launcher-state.json
```

将 `enable_gateway` 改为 `false`，重启 launcher。

---

## 常见问题排查

### 502 Bad Gateway

**原因**：前端请求了 `/api/*` 但本机 gateway 未运行。

**节点端**：正常现象，节点端不运行 gateway。检查 `launcher-state.json` 里 `enable_gateway` 是否为 `false`。

**网关端**：gateway 进程崩溃。查看 `logs/gateway.log`，点击界面"一键启动"重新拉起。

### 节点 discovery 响应 node_id 为空

**原因**：节点服务没有读到 `config/node.env`，用了默认空配置。

**修复**：
1. 确认 `bundle/claw-node/.env` 包含 `CLAW_ENV_FILE=C:\wechat-claw-node\config\node.env`
2. 确认 `wechat-claw-node-{id}.xml` 包含 `<env name="CLAW_ENV_FILE" ...>`
3. 重启服务

### 节点上报 IP 为 198.18.x.x

**原因**：节点代码版本过旧，未过滤 Windows 虚拟网卡地址。

**修复**：重新安装节点（界面"安装当前机器节点"），新版安装脚本会强制更新 Python 源文件。

### gateway 启动失败（端口冲突）

**原因**：上次 launcher 退出时遗留了 `run-gateway` 子进程。

**修复**：新版 launcher 会自动识别并杀掉遗留进程。如果仍然失败：

```powershell
$pids = netstat -ano | Select-String ":8300" | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -match '^\d+$' }
$pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
```

### 重新配置失败

**节点端**：`/api/setup/node/reset-credentials` 502。已修复，节点端使用 `/local/node/reset-credentials`。如果仍然失败，手动清空 `config/node.env` 中的相关字段。

### 微信图片消息显示“图片已过期”

**现象**：

- 网关侧日志显示 `getuploadurl`、CDN 上传、`sendmessage` 都成功
- 但微信客户端点击图片后仍提示“图片已过期”或无法预览

**当前已确认可用的协议约束**：

- `base_info.channel_version` 必须对齐 OpenClaw 兼容版本，当前固定为 `2.1.6`
- `iLink-App-ClientVersion` 必须基于同一个兼容版本编码
- 图片消息 `image_item` 需要携带顶层 `aeskey`
- `media.aes_key` 需要使用 `base64(hex-string)` 兼容编码
- 缩略图默认关闭，走 `no_need_thumb=true`

**排查顺序**：

1. 查看 `logs/gateway.log`，确认是否出现：
   - `wechat-bot: image_thumbnail disabled ... reason=official_no_need_thumb_mode`
   - `wechat-bot: getuploadurl success ...`
   - `wechat-bot: cdn_upload success ... has_download_param=true`
   - `wechat-bot: send_uploaded_media success ...`
2. 检查 `send_uploaded_media payload` 日志中的 `aes_key` 长度特征：
   - 当前兼容模式通常会显示更长的掩码，例如 `...(44)`
   - 如果回退成较短形态，通常说明 `aes_key` 又被改回了 raw-key base64
3. 检查 `apps/gateway/app/access/wechat_bot.py` 是否仍保留以下兼容逻辑：
   - `WECHAT_OPENCLAW_COMPAT_VERSION = "2.1.6"`
   - `_encode_wechat_media_aes_key()`
   - `image_item["aeskey"] = aeskey_hex`
4. 若日志显示 `cdn_upload success` 但缺少 `send_uploaded_media success`，优先检查 `sendmessage` 请求和返回体

**本次修复后的成功样例**：

- `2026-04-07 21:55:35` `getuploadurl success ... has_upload_full_url=true`
- `2026-04-07 21:55:36` `cdn_upload success ... has_download_param=true`
- `2026-04-07 21:55:37` `send_uploaded_media payload ... aes_key=...(44)`
- `2026-04-07 21:55:37` `send_uploaded_media success ... mime=image/jpeg`

---

## 关键文件路径

| 文件 | 说明 |
|------|------|
| `%APPDATA%\wechat-claw-hub\launcher-state.json` | launcher profile，含 `enable_gateway`、`enable_local_node` 等 |
| `apps/gateway/.env` | 网关配置，含 `WCH_NODE_TOKENS` |
| `C:\wechat-claw-node\config\node.env` | 节点主配置（默认安装路径） |
| `C:\wechat-claw-node\logs\` | 节点服务日志 |
| `D:\wechat-clawhub\logs\gateway.log` | gateway 进程日志 |
| `D:\wechat-clawhub\logs\host-redis.log` | Redis 日志 |
