# 双机源码验证清单

本文档用于把 `wechat-claw-hub` 当前版本按 **主机 A + 节点 B** 的方式做源码启动验证。  
本轮目标是尽快确认：主机链路、节点接入、局域网发现与配对、会话调度与日志采集都能顺畅完成。

## 1. 机器分工

- **电脑 A（主机）**
  - 启动 Redis
  - 启动 `apps/gateway`
  - 启动 `apps/agent-console`
  - 必要时可启动 `apps/desktop-launcher` 做对照，但不作为本轮主路径
- **电脑 B（节点）**
  - 从源码启动 `services/claw-node`
  - 连接电脑 A 的网关
  - 参与局域网 discovery / pairing

## 2. 上传 GitHub 前检查

1. 确认当前分支工作区干净，没有临时数据需要保留。
2. 确认仓库未包含以下内容：
   - `data/`
   - `dist/`
   - `logs/`
   - `runtime/`
   - `config/`
   - `build/`
   - `.venv/`
3. 确认源码内不包含真实 token、Dify key、微信 token、Redis 密码。
4. 确认 Git 远端为 `https://github.com/lclen/wechat-clawhub.git`。

## 3. 电脑 A：主机启动步骤

### 3.1 准备 Redis

- 若本机已有 Redis，可直接使用并确认监听 `127.0.0.1:6379`
- 若本机没有 Redis，可先使用桌面启动器自动下载并启动 Redis，仅作对照

### 3.2 启动网关

```powershell
cd apps/gateway
python -m venv .venv
.venv\Scripts\activate
pip install -e .
$env:WCH_REDIS_URL="redis://127.0.0.1:6379/0"
$env:WCH_NODE_TOKENS='{"node-b":"replace-node-token"}'
$env:WCH_TRANSCRIPT_DIR="D:\wechat-claw-hub-host\data\transcripts"
$env:WCH_IDENTITY_DIR="D:\wechat-claw-hub-host\data\identity"
$env:WCH_MEMORY_DIR="D:\wechat-claw-hub-host\data\memory"
$env:WCH_RUNTIME_ROOT="D:\wechat-claw-hub-host\runtime"
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

建议主机工作目录固定单独使用，例如：`D:\wechat-claw-hub-host\`

### 3.3 启动控制台

```powershell
cd apps/agent-console
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

打开：

- `http://127.0.0.1:5174`
- 或局域网访问 `http://<电脑A局域网IP>:5174`

### 3.4 主机烟雾检查

运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-check-host.ps1 `
  -GatewayBaseUrl http://127.0.0.1:8000 `
  -ExpectedNodeId node-b
```

预期：

- `/api/system/status` 返回 `redis_ok=true`
- `/api/setup/profile` 返回成功
- `/api/nodes`、`/api/sessions` 返回成功
- 若节点未启动，`ExpectedNodeId` 检查会失败，这是正常的前置提醒

## 4. 电脑 B：节点启动步骤

### 4.1 节点环境示例

在 `services/claw-node/.env` 中准备：

```env
CLAW_NODE_ID=node-b
CLAW_GATEWAY_BASE_URL=http://<电脑A局域网IP>:8000
CLAW_NODE_TOKEN=replace-node-token
CLAW_PAIRING_KEY=replace-pairing-key
CLAW_DISCOVERY_ENABLED=true
CLAW_DISCOVERY_PORT=9531
CLAW_PAIRING_LABEL=电脑B工作节点
CLAW_LOCAL_CACHE_ENABLED=false
CLAW_LOCAL_CACHE_REDIS_URL=
CLAW_LOCAL_CACHE_TTL_SECONDS=900
CLAW_DIFY_BASE_URL=<按需填写>
CLAW_DIFY_API_KEY=<按需填写>
CLAW_MAX_CONCURRENCY=1
CLAW_PULL_INTERVAL_MS=1500
CLAW_HEARTBEAT_INTERVAL_SECONDS=5
```

### 4.2 启动节点

```powershell
cd services/claw-node
python -m venv .venv
.venv\Scripts\activate
pip install -e .
python -m claw_node.main
```

### 4.3 节点烟雾检查

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-check-node.ps1 `
  -NodeEnvPath services/claw-node/.env `
  -RequirePairingKey
```

预期：

- 能读取 `.env`
- 主机 `/api/system/status` 正常
- 在 `/api/nodes` 中能找到 `node-b`
- 节点状态不是 `offline`
- 最近心跳时间是新鲜的

## 5. 局域网发现与配对验证

在电脑 A 的控制台快速配置页中：

1. 进入 `网关主机` 流程
2. 点击“搜索局域网节点”
3. 看到电脑 B 节点出现在发现列表
4. 输入 `CLAW_PAIRING_KEY`
5. 确认返回 `paired`

也可用主机烟雾脚本做 discovery 检查：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-check-host.ps1 `
  -GatewayBaseUrl http://127.0.0.1:8000 `
  -ExpectedNodeId node-b `
  -RunDiscoveryScan
```

预期：

- 扫描返回发现项
- 正确密钥时配对成功
- 错误密钥时提示 `auth_failed`
- 失败不会污染正式节点注册信息

## 6. 会话链路验证

1. 用微信或测试入站消息打入主机
2. 主机创建 dispatch task
3. 节点拉取任务
4. 节点提交 `task-result` 或 `task-failure`
5. 主机写入 transcript
6. 控制台看到：
   - 会话列表刷新
   - 聊天时间线刷新
   - 节点信息可见
   - 会话记忆侧栏可打开

## 7. 失败时先看哪里

### 主机侧

- 控制台页面提示与网络请求
- `GET /api/system/status`
- `GET /api/setup/profile`
- `GET /api/nodes`
- `GET /api/sessions`
- transcript 目录内容
- 网关终端输出

### 节点侧

- `python -m claw_node.main` 终端输出
- `.env` 是否填写正确
- 能否访问主机 `http://<电脑A局域网IP>:8000`
- 主机的 `/api/nodes` 是否能看到当前节点

### 如果同时跑了桌面启动器

- `GET /local/bootstrap/status`
- `GET /local/bootstrap/logs/gateway`
- `GET /local/bootstrap/logs/local-node`
- `GET /local/bootstrap/logs/host-redis`

## 8. 建议固定采集的信息

每次出问题都至少保留：

- 当前提交哈希
- 机器角色（A 主机 / B 节点）
- 启动命令
- `.env` 中非敏感配置摘要
- 失败时刻的接口响应
- 相关日志路径
- 一段 transcript 片段或任务 ID / session ID
