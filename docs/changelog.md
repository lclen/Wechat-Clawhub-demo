# Changelog

> **Status**: Active | **Last Updated**: 2026-04-08 | **Purpose**: 记录每次重要修复、功能变更和架构调整

---

## 2026-04-08 — Dify 会话 ID 持久化 + 节点侧空闲通道释放

### 背景

前一轮只完成了“Dify 上下文按微信用户隔离”，但还有两个直接影响后续调度闭环的问题没有收口：

1. `dify_conversation_id` 仍主要依赖节点内存和 recent messages 恢复，节点重启后不够稳。
2. 通道空闲释放还主要靠网关在刷新或新消息进入时顺手回收，不是真正的节点侧自治。

### 本次调整

- `services/claw-node/claw_node/local_cache.py`
  - 新增 `store_dify_conversation_id()` / `get_dify_conversation_id()`
  - 将 Dify 会话 ID 落到节点本地 Redis 缓存，键粒度仍按微信 `user_id`

- `services/claw-node/claw_node/dify_client.py`
  - 读取顺序改为：内存缓存 → 本地缓存 → recent messages 元数据
  - 每次 Dify 返回新的 `conversation_id` 后立即写回本地缓存
  - 结果 metadata 中显式附带 `dify_conversation_id`，确保一路透传到网关消息元数据

- `services/claw-node/claw_node/worker.py`
  - 新增节点侧 `ChannelLeaseState`
  - 节点接单时记录 `last_active_at`
  - 任务完成后更新 `last_active_at` 并清空 inflight 标记
  - 新增空闲巡检循环；默认 10 分钟无 inflight 即上报 `channel_released`

- `services/claw-node/claw_node/gateway_client.py`
  - 新增 `submit_channel_released()` HTTP 降级接口

- `apps/gateway/app/models/dispatch.py`
  - 新增 `ChannelReleasedRequest`

- `apps/gateway/app/api/routes/nodes.py`
  - 节点 WebSocket 事件流新增 `channel_released`
  - 新增 HTTP 降级接口 `POST /api/nodes/{node_id}/channel-released`

- `apps/gateway/app/dispatch/queue.py`
  - 新增 `release_channel_from_node()`
  - 只有在当前 session 仍绑定该 `node_id/slot_id` 且没有活跃任务时才真正释放
  - 节点侧空闲释放默认会清空 `assigned_node_id`，为后续“随机派发到任意空闲节点”铺路

### 测试覆盖

- `services/claw-node/tests/test_dify_client.py`
  - 新增本地缓存恢复 `conversation_id` 测试
  - 验证返回 metadata 中包含 `dify_conversation_id`

- `services/claw-node/tests/test_worker.py`
  - 验证任务结果 metadata 会透传 `dify_conversation_id`
  - 验证空闲超时后会发出 `channel_released`
  - 验证 inflight 状态下不会误释放

- `apps/gateway/tests/test_dispatch_queue.py`
  - 验证节点上报空闲释放后，网关会在空闲 session 上清理槽位并清空节点绑定
  - 验证 busy session 不会被误释放

### 收益

- Dify 上下文恢复不再只依赖进程内存，节点重启后的连续性更稳
- `dify_conversation_id` 现在会真正写进 bot message metadata，后续排障和回填更直接
- 通道空闲释放的责任开始下放到节点侧，网关只做最终裁决和状态收口
- 为下一步做“节点优先维护空闲通道池，网关随机派发到空闲节点”打好了真实链路基础

---

## 2026-04-07 — Dify 用户级上下文隔离

### 背景

后续计划将通道空闲判断逐步下放到节点侧。要做到“用户超过 10 分钟不说话，节点释放自身空闲通道”而又不丢上下文，前提是 Dify 对话上下文必须先稳定绑定到真实微信用户，而不是继续依赖更松散的会话键拼接。

### 本次调整

- `services/claw-node/claw_node/dify_client.py`
  - 将节点本地 `conversation_id` 缓存键从 `session_id:user_id` 收敛为直接使用 `user_id`
  - 保持请求体中 `user` 字段继续直接传递微信 `user_id`
  - 不改变现有 `conversation_id` 回填逻辑，仍支持从 recent messages 元数据中恢复

- `services/claw-node/tests/test_dify_client.py`
  - 新增测试验证 `conversation_key` 与微信 `user_id` 一致
  - 验证 `user` 字段保持为微信用户 ID
  - 验证 recent messages 中已有 `conversation_id` 时仍能连续复用

### 收益

- Dify 上下文隔离粒度与真实微信用户一致
- 为后续“节点侧空闲通道自动释放”提供更稳定的上下文基础
- 节点在重新分配槽位时，不需要再把 Dify 会话绑定到旧的槽位或复合会话键

### 后续计划

1. 持久化最新 `dify_conversation_id`，避免节点重启后仅依赖内存缓存
2. 在节点侧引入每个槽位的 `last_active_at`，支持 10 分钟空闲释放
3. 在前端连接中心明确展示各个 claw 的空闲通道数

---

## 2026-04-05 — 节点事件流化 + 会话概览流 + WebSocket 实时消息推送

### 背景

本轮更新（commit 407dfe5）实现了节点事件流化和会话概览流，统一了节点到网关的通信机制，遵循"禁止新增轮询接口"的架构原则。同时完善了 WebSocket 实时消息推送功能，实现了全面的事件驱动架构。

---

### 核心功能

#### 1. 节点事件流（Node Event Stream）

**目标**：统一节点与网关之间的通信，将任务分发、结果回传、心跳保活等功能整合到单一 WebSocket 连接。

- **NodeStreamBroker**：新增节点事件流管理中心
  - 维护节点 WebSocket 连接映射
  - 支持任务推送和事件接收
  - 自动清理断开的连接

- **双向 WebSocket 协议**：`/api/nodes/{node_id}/ws`
  - **节点 → 网关事件**：
    - `ready`: 节点请求任务
    - `task_result`: 任务结果回传
    - `task_failure`: 任务失败报告
    - `heartbeat`: 心跳保活
    - `diagnostics`: 诊断信息上报
  - **网关 → 节点事件**：
    - `task_assigned`: 分配任务
    - `noop`: 无任务可分配
    - `pong`: 心跳响应
    - `ack`: 确认接收
    - `error`: 错误响应

- **节点 Worker 重构**
  - 新增 `_task_stream_loop()` 替代轮询循环
  - 使用 `_task_stream_send_lock` 保护 WebSocket 发送操作
  - 优雅降级：WebSocket 失败时自动降级到 HTTP
  - 任务结果优先通过 WebSocket 发送，失败时降级到 HTTP POST

#### 2. 会话概览流（Session Overview Stream）

**目标**：实时推送所有会话的状态变更，替代前端对会话列表的轮询。

- **SessionStreamBroker 扩展**
  - 新增 `_overview_connections` 管理概览订阅者
  - `subscribe_overview()` / `unsubscribe_overview()` 订阅管理
  - `publish_overview()` 推送会话列表更新
  - `publish_overview_snapshot()` 发送初始快照

- **WebSocket 端点**：`/api/sessions/overview/ws`
  - 连接建立后立即发送所有会话快照
  - 会话状态变更时实时推送更新
  - 支持自定义错误码：4500（服务器未就绪）、4503（Redis 不可用）

- **前端集成**
  - 自动连接到概览 WebSocket
  - 接收 `sessions_snapshot` 事件更新会话列表
  - 连接失败自动降级到 HTTP 轮询

#### 3. WebSocket 实时消息推送（已有功能完善）

- **SessionStreamBroker**：会话消息流的发布/订阅中心
  - 管理 WebSocket 连接的订阅关系
  - 支持快照消息和增量消息推送
  - 自动清理断开的连接

- **WebSocket 端点**：`/api/sessions/{session_id}/ws`
  - 连接建立后立即发送最近 50 条消息快照
  - 实时推送新增消息（`messages_appended` 事件）
  - 支持自定义错误码：4404（会话不存在）、4500（服务器未就绪）、4503（Redis 不可用）

- **前端 WebSocket 客户端**
  - 自动连接到会话 WebSocket
  - 2.5 秒超时机制，未收到快照自动降级到 HTTP 轮询
  - 连接失败自动降级，3 秒后重试
  - 支持快照和增量消息的差异化处理

---

### 后端（gateway）

#### NodeStreamBroker (`node_stream.py`)

```python
class NodeStreamBroker:
    async def register_connection(node_id, websocket)  # 注册节点连接
    async def unregister_connection(node_id)  # 注销节点连接
    async def receive_event(websocket)  # 接收节点事件
    def is_connected(node_id)  # 检查节点是否连接
```

#### 节点 WebSocket 端点 (`nodes.py`)

- 路径：`/api/nodes/{node_id}/ws?wait_seconds=15`
- 认证：`Authorization: Bearer <token>` 或 `X-Node-Token: <token>`
- 事件处理：
  - `ready` → 调用 `dispatch_queue.pull_for_node()` 分配任务
  - `task_result` → 转换为 `TaskResultRequest` 并调用 `dispatch_queue.submit_result()`
  - `task_failure` → 转换为 `TaskFailureRequest` 并调用 `dispatch_queue.submit_failure()`
  - `heartbeat` → 返回 `pong`
  - `diagnostics` → 返回 `ack`（未来将存储诊断信息）

#### SessionStreamBroker 扩展 (`session_stream.py`)

```python
class SessionStreamBroker:
    # 原有方法
    async def subscribe(session_id, websocket)  # 订阅会话消息流
    async def unsubscribe(session_id, websocket)  # 取消订阅
    async def publish_messages(...)  # 推送增量消息
    async def publish_snapshot(...)  # 发送初始快照
    
    # 新增方法
    async def subscribe_overview(websocket)  # 订阅会话概览
    async def unsubscribe_overview(websocket)  # 取消订阅概览
    async def publish_overview(sessions)  # 推送会话列表更新
    async def publish_overview_snapshot(websocket, sessions)  # 发送概览快照
    def has_overview_subscribers()  # 检查是否有概览订阅者
```

#### SessionManager 集成

- 构造函数新增 `session_stream` 参数
- `append_message()` 保存消息后自动推送到订阅者
- `set_dispatch_state()` 更新分发状态后推送会话更新

#### 消息接口增强

- `GET /api/sessions/{session_id}/messages`
  - 新增 `after_count` 参数：增量加载
  - 新增 `limit` 参数：限制返回数量（1-200）
  - 返回 `next_cursor` 和 `replace_messages` 标志

#### 生命周期管理

- `lifespan.py` 初始化 `SessionStreamBroker` 和 `NodeStreamBroker`
- 注入到 `app.state.session_stream` 和 `app.state.node_stream`
- 传递给 `SessionManager` 构造函数

---

### 节点端（claw-node）

#### Worker 重构 (`worker.py`)

- **新增字段**：
  - `_task_stream_websocket`: 当前 WebSocket 连接
  - `_task_stream_send_lock`: 保护 WebSocket 发送操作的异步锁

- **新增方法**：
  - `_task_stream_loop()`: WebSocket 任务流循环
  - `_send_task_stream_event()`: 发送事件到网关（带锁保护）
  - `_try_send_task_stream_event()`: 尝试发送事件，失败时返回 False

- **重构方法**：
  - `_submit_task_result()`: 优先通过 WebSocket 发送，失败时降级到 HTTP
  - `_submit_task_failure()`: 同上
  - `_poll_once()`: 提取为独立方法，供降级时使用

- **降级机制**：
  - WebSocket 连接失败 → 调用 `_poll_once()` 进行 HTTP 轮询
  - 认证失败（4401）→ 停止循环，设置 `_auth_failed` 标志
  - 其他错误 → 重连延迟 `task_stream_reconnect_seconds`

#### 线程安全

```python
async def _send_task_stream_event(self, event: dict[str, Any]) -> None:
    websocket = self._task_stream_websocket
    if websocket is None:
        raise RuntimeError("Task stream websocket is not connected")
    async with self._task_stream_send_lock:
        await websocket.send(json.dumps(event))
```

避免多个 asyncio 任务同时写入 WebSocket 导致的数据混乱。

---

### 前端（agent-console）

#### 会话消息 WebSocket 连接管理

- `buildSessionWebSocketUrl()` 构建 WebSocket URL
  - 自动处理 http/https → ws/wss 协议转换
  - 支持 `remoteGateway` 参数（节点模式）

- 连接生命周期
  - 进入会话观察台自动连接
  - 切换会话时断开旧连接，建立新连接
  - 离开会话观察台自动断开

#### 会话概览 WebSocket 连接管理

- `buildSessionOverviewWebSocketUrl()` 构建概览 WebSocket URL
- 连接生命周期
  - 进入会话列表页面自动连接
  - 接收 `sessions_snapshot` 事件更新会话列表
  - 离开页面自动断开

#### 降级策略

1. **WebSocket 优先**：首次尝试 WebSocket
2. **超时降级**：2.5 秒未收到快照 → HTTP 轮询
3. **错误降级**：连接失败 → HTTP 轮询
4. **自动重连**：断开后 3 秒重试 WebSocket

#### 网关地址修复

- **问题**：网关模式下 WebSocket 连接到 launcher (8765) 而非网关 (8300)
- **原因**：`sessionRemoteGatewayBaseUrl` 在网关模式下为空，导致使用 `window.location.origin`
- **修复**：网关模式下使用 `systemStatus.preferred_gateway_base_url`

```typescript
const sessionRemoteGatewayBaseUrl = gatewayEnabled === false
  ? workerSetup.gateway_base_url.trim()  // 节点模式
  : (systemStatus?.preferred_gateway_base_url || setupProfile?.preferred_gateway_base_url || "");  // 网关模式
```

---

### launcher（desktop-launcher）

#### 开发调试支持

- `run-gateway` 命令新增 `--reload` 参数
- 支持代码修改后自动重载
- 方便开发调试

```bash
uv run python -m launcher.main run-gateway --reload
```

---

### 文档

#### 新增文档

- `docs/websocket-realtime-messaging.md`
  - 会话消息流协议规范
  - 节点事件流协议规范
  - 会话概览流协议规范
  - 架构设计说明
  - 实现细节
  - 故障排查指南
  - 性能优化建议

- `docs/code-review-407dfe5.md`
  - 代码审查报告（commit 407dfe5）
  - 潜在问题识别
  - 改进建议
  - 测试建议

#### 更新文档

- `docs/changelog.md` - 记录节点事件流化和会话概览流功能
- `docs/gateway-node-console-implementation-roadmap.md` - 更新实施进度

---

### 性能提升

| 场景 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 切换会话 | 1-2 秒（HTTP 请求） | 瞬间（缓存） | ~90% |
| 新消息到达 | 3 秒轮询延迟 | 实时推送 | 实时 |
| 首屏加载 | 加载全部消息 | 限制 50 条 | ~70% |
| 增量更新 | 重新加载全部 | 只加载新增 | ~80% |
| 节点任务分发 | HTTP 轮询（15 秒） | WebSocket 实时 | 实时 |
| 任务结果回传 | HTTP POST | WebSocket 优先 | 减少延迟 |
| 会话列表更新 | HTTP 轮询（3 秒） | WebSocket 实时 | 实时 |

---

### 架构改进

#### 事件驱动架构

- **统一通信模式**：所有实时通信统一使用 WebSocket
- **减少轮询**：遵循"禁止新增轮询接口"原则
- **降级保障**：WebSocket 失败时自动降级到 HTTP，确保系统可用性

#### 线程安全

- 节点 Worker 使用 `_task_stream_send_lock` 保护 WebSocket 发送
- SessionStreamBroker 使用 `_lock` 保护订阅者集合
- 避免并发写入导致的数据混乱

#### 资源管理

- WebSocket 连接自动清理（`finally` 块）
- 断开连接时自动注销订阅
- 避免资源泄漏

---

### 已知问题与注意事项

> [!IMPORTANT]
> WebSocket 连接需要正确的网关地址。在网关模式下，前端会自动使用 `systemStatus.preferred_gateway_base_url`。如果该值不正确，WebSocket 会连接失败并降级到 HTTP 轮询。

> [!TIP]
> 如果 WebSocket 频繁断开，检查：
> 1. Redis 连接是否稳定
> 2. 网关服务器资源是否充足
> 3. 网络连接是否稳定

> [!WARNING]
> 节点 Worker 中存在潜在的竞态条件（详见 `docs/code-review-407dfe5.md`），建议在 `_try_send_task_stream_event()` 中将 WebSocket 检查和发送操作都放在锁内执行。

---

### 相关 Commit

- `407dfe5` - feat: streamline runtime and event streams
- `cddc714` - feat: add WebSocket real-time message streaming and optimize session loading
- `6589af1` - Fix session message regression after stream changes

---

## 2026-04-04 — 角色感知 UI 分离 + 节点端独立运行

### 背景

本轮修复解决了节点端（worker_node 角色）与网关端（gateway_host 角色）在同一套前端界面下混用的问题，以及节点 Windows 服务配置读取失败、虚拟网卡 IP 误报等问题。

---

### 前端（agent-console）

#### 角色感知 UI 分离

- **快速配置页**：launcher 面板只在选择角色后才显示，不同角色显示不同安装项
- **接入中心**：网关角色与节点角色完全分离
  - 节点角色隐藏：主网关状态、微信接入、节点纳管、分发模式、扫码接入、手动 Token、本机诊断（内置节点）
  - 节点角色显示：节点说明、连接状态、调试日志
- **launcher 组件列表**：节点角色下过滤掉 `host-redis` 和 `gateway` 组件
- **启动按钮**：节点角色下显示"启动节点服务"，不显示"一键启动"

#### 懒启动架构

- launcher 启动时不再自动拉起任何服务（`auto_restore` 已禁用）
- 前端读取 `launcherStatus.profile.enable_gateway` 决定是否走网关分支
- 节点角色下跳过所有 `/api/*` 轮询，消除 502 日志
- 节点角色下使用 `/local/*` 接口替代 gateway 接口：

| 操作 | 网关角色 | 节点角色 |
|------|---------|---------|
| 节点安装 | `POST /api/setup/node/install` | `POST /local/node/install` |
| 网关探测 | `POST /api/setup/gateway/probe` | `POST /local/gateway/probe` |
| 重置凭据 | `POST /api/setup/node/reset-credentials` | `POST /local/node/reset-credentials` |
| Setup profile | `GET /api/setup/profile` | `GET /local/setup/profile` |
| 重新配置 reset | `POST /api/setup/reset` | 跳过（gateway 不在本机） |

#### 重新配置流程修复

- 停掉所有 launcher 组件（不只是 local-node）
- 清空节点 `.env` 里的 `CLAW_NODE_ID`、`CLAW_GATEWAY_BASE_URL`、`CLAW_PAIRING_KEY`、`CLAW_PAIRING_TRACE_ID`（之前只清 token）
- 重置前端所有表单状态和 localStorage
- 节点角色下跳过微信断开和 gateway reset

---

### 后端（gateway）

#### 全量重置接口

- 新增 `POST /api/setup/reset`，调用 `full_reset()`
- `full_reset()` 清理：内存状态、所有 `node_tokens`、Redis 节点注册表
- 每次 reset 强制写入空的 `WCH_NODE_TOKENS` 到 `.env`，防止重启后残留

#### `reset_worker_node_credentials` 扩展

- 之前只清 `CLAW_NODE_TOKEN`
- 现在同时清：`CLAW_NODE_ID`、`CLAW_GATEWAY_BASE_URL`、`CLAW_PAIRING_KEY`、`CLAW_PAIRING_TRACE_ID`

---

### launcher（desktop-launcher）

#### 新增本地接口

| 接口 | 用途 |
|------|------|
| `GET /local/setup/profile` | 返回基于 launcher profile 的简化 setup profile，供节点角色初始化 |
| `POST /local/gateway/probe` | 直接用 httpx 探测目标网关，不依赖本机 gateway |
| `POST /local/node/install` | 直接调用 `install-claw-node.ps1`，不依赖本机 gateway |
| `POST /local/node/reset-credentials` | 直接清空本地节点 `.env` 配置 |

#### `LauncherProfile` 新增字段

- `enable_gateway: bool = True`：控制是否启动 gateway
- `start_stack` 保存此字段到 profile，`auto_restore` 读取此字段决定是否拉起 gateway

#### 进程管理修复

- `_detect_external_port_conflict`：识别并自动杀掉 launcher 重启后遗留的 `run-gateway` 子进程
- `statuses()`：`enable_gateway=false` 时跳过 gateway 状态检测，显示 `stopped` 而非 `failed`
- `ensureLauncherRuntimeForQuickSetup`：节点角色直接 return，不触发任何 `bootstrap/start`

---

### 节点服务（claw-node）

#### 虚拟网卡 IP 过滤

- `node_identity.py` 新增 `_BENCHMARK_NETWORK = 198.18.0.0/15`
- `is_usable_ipv4()` 过滤此网段，防止 Windows 虚拟网卡（如 Meta、Hyper-V）地址被上报为局域网 IP

---

### 安装脚本（install-claw-node.ps1）

#### 强制更新 Python 源文件

- 即使 bundle hash 未变（`ReuseBundle=true`），也强制从 repo 源码覆盖 `bundle/claw-node/claw_node/*.py`
- 确保代码修复（如 IP 过滤）在重装时立即生效，不依赖重新打包 bundle

#### bundle `.env` fallback

- 安装完成后在 `bundle/claw-node/.env` 写入 `CLAW_ENV_FILE=<config/node.env 路径>`
- 防止 WinSW XML `<env>` 标签失效时节点进程读不到配置

---

### 已知问题与注意事项

> [!IMPORTANT]
> 节点 Windows 服务的 `CLAW_ENV_FILE` 通过 WinSW XML 的 `<env>` 标签注入。如果手动修改了 XML 导致此标签丢失，节点会以空配置启动。此时需要重新安装节点或手动在 `bundle/claw-node/.env` 写入 `CLAW_ENV_FILE=<路径>`。

> [!IMPORTANT]
> 节点角色下 `enable_gateway` 必须为 `false`（存储在 `%APPDATA%\wechat-claw-hub\launcher-state.json`）。如果此值被意外改为 `true`，launcher 会尝试启动 gateway，导致 502。可手动编辑该文件修复。
