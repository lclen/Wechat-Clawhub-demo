# 运维操作手册

> **Status**: Active | **Last Updated**: 2026-04-14 | **Purpose**: 日常启动、排障、重置操作的快速参考

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

### 节点与网关之间存在 10-30 秒额外延迟

**现象**：

- 节点侧日志显示 Dify 已在 5-30 秒内完成
- 但微信最终收到回复仍然比节点完成时间晚很多
- 网关 `task_result_received` 与节点 `task_result_submit_finished` 之间曾经出现 `15s` / `30s` 档位延迟

**已确认的历史根因**：

旧任务流把两件事混在同一条 WebSocket 上：

1. 节点先发 `ready`
2. 网关在同一连接里阻塞执行 `pull_for_node(wait_seconds=15)`
3. 节点完成后再复用这条连接回传 `task_result`

这会导致一个典型竞态：

- 网关还在长等待 `pull-task`
- 节点虽然已经把结果写到 socket
- 但网关要等本轮长等待返回后，才真正消费到 `task_result`

于是就会出现肉眼可见的 `15s` / `30s` 级额外耗时。

**当前修复后的正式模型**：

- 任务分配只走网关主动下发 `task_assigned`
- 节点不再依赖 `ready` 作为主协议
- 节点只单向上报：
  - `task_result`
  - `task_failure`
  - `channel_released`
  - `diagnostics`
- 节点握手协议固定为 `task-stream-v2`
- WebSocket 抖动时先重连，连续失败后才进入 `degraded_http_polling`
- fallback polling 使用短等待，不再复用 `wait_seconds=15` 的长轮询

**修复后的关键日志信号**：

1. 正常新协议接入时，应看到：
   - `ws_registered node=agent-1 protocol_version=task-stream-v2`
   - `task_pushed_immediate`
   - `task_assigned_received source=ws`
   - `task_result_received source=ws`
2. 如果仍有旧节点在跑旧协议，会看到：
   - `legacy_protocol_rejected`
   - `protocol_version=<missing>`
3. 如果链路进入降级模式，会看到：
   - 节点侧 `task_stream_fallback_to_http_polling`
   - 状态里的 `connection_mode=degraded_http_polling`

**排查顺序**：

1. 先对齐节点与网关时钟，不要把机器时间偏差误判成链路延迟。
2. 对比以下时间点：
   - 节点 `task_result_submit_finished`
   - 网关 `task_result_received`
   - 网关 `outgoing_reply_sent`
3. 判断慢点落在哪一段：
   - 如果节点完成到网关收包仍差 `15s` / `30s`，优先检查是否还有旧 `ready/pull-task` 主链路残留
   - 如果网关收包后才慢，继续看 `send_markdown` / `send_asset_url` / `send_uploaded_media`
4. 查看网关节点状态或接入中心：
   - `protocol_version`
   - `connection_mode`
   - `last_disconnect_code`
   - `fallback_poll_count`

**建议验收方式**：

1. 发送一条纯文本测试消息。
2. 确认网关日志中：
   - `task_pushed_immediate`
   - `task_result_received`
   - `task_result_dispatched`
   三者时间差不再出现固定 `15s/30s` 档位。
3. 如果节点发生 `1012` / `1001`，确认它会先重连，而不是立刻进入长轮询。

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

### 微信里只看到 Markdown 文件链接，文件没有渲染成可发送文件

**现象**：

- 微信客户端里看到原始 Markdown 或一大段文本链接
- 文件名存在，但没有作为微信文件消息出现
- 典型场景是 `* **[说明书.pdf](https://...)**` 这类回复

**本次已确认的根因模型**：

1. 旧版 gateway 只会把图片链接识别成媒体消息，普通文件链接会在摘要阶段被降级成纯文本。
2. 代码已升级但 gateway 进程未重启时，也会继续跑旧逻辑，表现仍然和未修复前一致。

**当前正确行为**：

- Markdown 文件链接会被识别成 `file` 片段
- 独立一行的远程文件 URL 也会被识别成文件消息
- gateway 会走统一的 `send_asset_url -> send_uploaded_media` 链路，把 PDF / 文档作为微信文件消息发送

**排查顺序**：

1. 先确认运行中的 gateway 是否已经加载新代码。
2. 查看 `logs/gateway.log`，发送文件类回复后应出现：
   - `wechat-bot: send_markdown ... file_count=...`
   - `wechat-bot: send_asset_url start ... asset_url=...`
   - `wechat-bot: send_uploaded_media success ... mime=application/pdf`
3. 如果日志里仍然只有旧格式：
   - `wechat-bot: send_markdown ... segment_count=1 image_count=0`
   - 且完全没有 `file_count` / `send_asset_url`
   说明当前 gateway 进程还在跑旧代码，需要重启 gateway。
4. 如果已经出现 `send_asset_url start`，但没有 `send_uploaded_media success`，再继续检查：
   - 远程文件 URL 是否可下载
   - `getuploadurl` 是否成功
   - 微信 `sendmessage` 返回体是否报错

**建议验收方式**：

1. 重启 gateway。
2. 重新发送一条只包含 PDF/说明书链接的测试问题。
3. 观察微信是否出现真正的文件消息，而不是长文本链接。
4. 同步查看 `logs/gateway.log`，确认已命中新日志关键字：
   - `file_count`
   - `send_asset_url`
   - `send_uploaded_media success`

**本次修复涉及代码**：

- `apps/gateway/app/access/wechat_bot.py`
- `apps/gateway/tests/test_wechat_bot.py`

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
