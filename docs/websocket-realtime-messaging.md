# WebSocket 实时消息推送

## 概述

本文档描述 wechat-claw-hub 的 WebSocket 实时消息推送功能，包括：

1. **会话消息流** - 在会话观察台实现消息的实时更新
2. **会话概览流** - 实时推送会话列表状态变更
3. **节点事件流** - 节点与网关之间的双向事件通信
4. **节点诊断流** - 节点诊断时间线的实时推送
5. **网关摘要流** - 网关摘要状态（system/wechat/nodes）的统一推送

这些功能统一采用 WebSocket 协议，替代传统的 HTTP 轮询方式，遵循"禁止新增轮询接口"的架构原则。

## 架构设计

### 核心组件

#### 1. 会话消息流

1. **SessionStreamBroker** (`apps/gateway/app/services/session_stream.py`)
   - 会话消息流的发布/订阅中心
   - 管理 WebSocket 连接的订阅关系
   - 负责向订阅者推送消息更新和会话概览

2. **会话消息 WebSocket 端点** (`apps/gateway/app/api/routes/sessions.py`)
   - 路径：`/api/sessions/{session_id}/ws`
   - 处理单个会话的消息流
   - 发送初始快照和增量更新

3. **会话概览 WebSocket 端点** (`apps/gateway/app/api/routes/sessions.py`)
   - 路径：`/api/sessions/overview/ws`
   - 推送所有会话的状态变更
   - 用于会话列表实时更新

#### 2. 节点事件流

1. **NodeStreamBroker** (`apps/gateway/app/services/node_stream.py`)
   - 节点事件流的管理中心
   - 维护节点 WebSocket 连接
   - 支持任务推送和事件接收

2. **节点事件 WebSocket 端点** (`apps/gateway/app/api/routes/nodes.py`)
   - 路径：`/api/nodes/{node_id}/ws`
   - 双向通信：任务分发 + 结果回传
   - 支持多种事件类型（ready、task_result、task_failure、heartbeat、diagnostics）

3. **节点 Worker** (`services/claw-node/claw_node/worker.py`)
   - 维护与网关的 WebSocket 连接
   - 发送事件到网关
   - 优雅降级到 HTTP（WebSocket 不可用时）

#### 3. 节点诊断流

1. **NodeDiagnosticsStreamBroker** (`apps/gateway/app/services/node_diagnostics_stream.py`)
   - 节点诊断流的发布/订阅中心
   - 管理按 `node_id` 维度的 WebSocket 订阅关系
   - 用于连接页的节点诊断实时更新

2. **节点诊断 WebSocket 端点** (`apps/gateway/app/api/routes/nodes.py`)
   - 路径：`/api/nodes/{node_id}/diagnostics/ws`
   - 连接建立时发送一次诊断快照
   - 后续在网关收到新的节点诊断事件时实时推送

#### 4. 网关摘要流

1. **GatewaySummaryStreamBroker** (`apps/gateway/app/services/gateway_summary_stream.py`)
   - 统一网关摘要流的发布/订阅中心
   - 管理所有摘要流订阅者

2. **GatewaySummaryService** (`apps/gateway/app/services/gateway_summary_service.py`)
   - 聚合 `system + wechat + nodes`
   - 对外输出统一的 `GatewaySummaryResponse`

3. **网关摘要 WebSocket 端点** (`apps/gateway/app/api/routes/system.py`)
   - 路径：`/api/system/summary/ws`
   - 用于 quick setup / connection / 顶部状态区统一读取运行摘要

#### 3. 前端 WebSocket 客户端

1. **会话消息客户端** (`apps/agent-console/src/App.tsx`)
   - 自动连接到会话 WebSocket
   - 处理快照和增量消息
   - 失败时自动降级到 HTTP 轮询

2. **会话概览客户端** (`apps/agent-console/src/App.tsx`)
   - 连接到概览 WebSocket
   - 实时更新会话列表
   - 替代原有的轮询机制

### 消息流向

#### 会话消息流

```
微信消息 → Gateway → SessionManager.append_message()
                          ↓
                    SessionStreamBroker.publish_messages()
                          ↓
                    WebSocket 订阅者 (前端)
```

#### 会话概览流

```
会话状态变更 → SessionManager
                    ↓
              SessionStreamBroker.publish_overview()
                    ↓
              WebSocket 订阅者 (前端会话列表)
```

#### 节点事件流

```
节点 → WebSocket → Gateway → DispatchQueue
  ↑                              ↓
  └──────── 任务分发 ←────────────┘

事件类型：
- ready: 节点请求任务
- task_result: 任务结果回传
- task_failure: 任务失败报告
- heartbeat: 心跳保活
- diagnostics: 诊断信息上报
```

#### 节点诊断流

```
NodeDiagnostics(record_event)
        ↓
Worker event hook
        ↓
/api/nodes/{node_id}/ws  diagnostics event
        ↓
SetupService.ingest_node_diagnostics_event()
        ↓
NodeDiagnosticsStreamBroker.publish()
        ↓
连接页 WebSocket 订阅者
```

#### 网关摘要流

```
GatewaySummaryService.build_summary()
        ↓
GatewaySummaryStreamBroker.publish()
        ↓
前端摘要订阅者（quick setup / connection / 顶部状态）
```

## 协议规范

### 连接建立

客户端连接到：
```
ws://<gateway-host>:<gateway-port>/api/sessions/<session_id>/ws
```

例如：
```
ws://192.168.0.17:8300/api/sessions/wechat%3Ao9cq801txMYfPe4My5Ks_wBfUBLo%40im.wechat/ws
```

### 消息格式

#### 1. 快照消息 (snapshot)

连接建立后，服务器立即发送最近 50 条消息的快照：

```json
{
  "type": "snapshot",
  "session": {
    "session_id": "wechat:user123@im.wechat",
    "message_count": 27,
    "assigned_node_id": "agent-1",
    ...
  },
  "messages": [
    {
      "message_id": "msg_001",
      "role": "user",
      "content": "你好",
      "timestamp": "2026-04-05T10:30:00Z"
    },
    ...
  ],
  "next_cursor": 27,
  "replace_messages": true
}
```

- `type`: 固定为 `"snapshot"`
- `replace_messages`: `true` 表示应该替换现有消息列表
- `next_cursor`: 当前会话的消息总数

#### 2. 增量消息 (messages_appended)

当会话有新消息时，服务器推送增量更新：

```json
{
  "type": "messages_appended",
  "session": {
    "session_id": "wechat:user123@im.wechat",
    "message_count": 28,
    ...
  },
  "messages": [
    {
      "message_id": "msg_028",
      "role": "assistant",
      "content": "你好！有什么可以帮助你的吗？",
      "timestamp": "2026-04-05T10:30:05Z"
    }
  ],
  "next_cursor": 28,
  "replace_messages": false
}
```

- `type`: 固定为 `"messages_appended"`
- `replace_messages`: `false` 表示应该追加到现有消息列表
- `messages`: 新增的消息数组

### 错误码

WebSocket 关闭时使用以下自定义错误码：

- `4404`: 会话不存在 (`session_not_found`)
- `4500`: 服务器未就绪 (`server_not_ready`)
- `4503`: Redis 不可用或会话管理器错误 (`redis_unavailable` / `session_unavailable`)

## 实现细节

### 后端实现

#### SessionStreamBroker

```python
class SessionStreamBroker:
    def __init__(self):
        self._subscribers: dict[str, set[WebSocket]] = {}
    
    async def subscribe(self, session_id: str, websocket: WebSocket):
        """订阅会话消息流"""
        
    async def unsubscribe(self, session_id: str, websocket: WebSocket):
        """取消订阅"""
        
    async def publish_messages(self, session_id: str, ...):
        """向订阅者推送新消息"""
        
    async def publish_snapshot(self, session_id: str, ...):
        """发送初始快照"""
```

#### WebSocket 端点

```python
@router.websocket("/{session_id}/ws")
async def stream_session_messages(websocket: WebSocket, session_id: str):
    # 1. 接受连接
    await websocket.accept()
    
    # 2. 检查 Redis 可用性
    if not await store.ping():
        await websocket.close(code=4503, reason="redis_unavailable")
        return
    
    # 3. 发送初始快照
    session = await manager.get_session(session_id)
    messages, next_cursor, _ = await manager.get_messages(session_id, limit=50)
    await stream.publish_snapshot(session_id, websocket, session, messages, ...)
    
    # 4. 订阅并保持连接
    await stream.subscribe(session_id, websocket)
    while True:
        await websocket.receive_text()  # 保持连接活跃
```

#### 消息推送触发点

在 `SessionManager.append_message()` 中：

```python
async def append_message(self, session_id: str, message: MessageRecord):
    # ... 保存消息到 Redis ...
    
    # 推送到 WebSocket 订阅者
    if self._session_stream:
        await self._session_stream.publish_messages(
            session_id,
            session=parsed,
            messages=[message],
            next_cursor=updated_message_count,
        )
```

### 前端实现

#### WebSocket 连接管理

```typescript
function buildSessionWebSocketUrl(sessionId: string, remoteGateway?: string | null) {
  const baseUrl = remoteGateway?.trim() || window.location.origin;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/sessions/${encodeURIComponent(sessionId)}/ws`;
  return url.toString();
}

const connectSessionSocket = () => {
  const wsUrl = buildSessionWebSocketUrl(sessionId, remoteGateway);
  socket = new WebSocket(wsUrl);
  
  // 2.5 秒超时，如果没收到快照则降级到 HTTP
  snapshotTimeout = window.setTimeout(() => {
    if (!receivedPayload) {
      socket?.close();
      scheduleHttpPolling(hasCache);
    }
  }, 2500);
  
  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    
    // 更新缓存
    const entry = syncSessionMessageCache(sessionId, {
      session: payload.session,
      messages: payload.messages,
      next_cursor: payload.next_cursor,
      replace_messages: payload.replace_messages,
    }, { 
      preserveExisting: payload.type === "messages_appended" 
    });
    
    // 应用到 UI
    applySessionMessageEntry(sessionId, entry);
  };
};
```

#### 降级策略

1. **WebSocket 优先**：首次尝试建立 WebSocket 连接
2. **超时降级**：2.5 秒内未收到快照消息，自动降级到 HTTP 轮询
3. **错误降级**：WebSocket 连接失败或异常关闭，立即降级到 HTTP 轮询
4. **自动重连**：WebSocket 断开后 3 秒自动尝试重连

## 性能优化

### 1. 消息缓存

前端维护会话消息缓存：

```typescript
const sessionMessageCacheRef = useRef<Map<string, SessionMessageCacheEntry>>(new Map());
```

- 切换会话时立即应用缓存，无需等待网络请求
- 后台异步加载增量更新
- 减少重复请求

### 2. 增量加载

HTTP 接口支持增量加载：

```
GET /api/sessions/{session_id}/messages?after_count=27
```

- `after_count`: 客户端已有的消息数量
- 服务器只返回新增的消息
- 减少数据传输量

### 3. 首屏限制

首次加载限制消息数量：

```
GET /api/sessions/{session_id}/messages?limit=50
```

- 只加载最近 50 条消息
- 加快首屏渲染速度
- 用户可以手动加载更多历史消息

## 网关地址配置

### 问题背景

在网关模式下，前端通过 launcher (8765 端口) 访问，但 WebSocket 需要连接到实际的网关 (8300 端口)。

### 解决方案

前端根据运行模式选择正确的网关地址：

```typescript
const localGatewayManaged = launcherAvailable
  ? launcherShouldRunGateway(launcherStatus)
  : null;
const sessionRemoteGatewayBaseUrl = localGatewayManaged === false
  ? workerSetup.gateway_base_url.trim()  // 远端网关模式：使用配置的远程网关
  : (systemStatus?.preferred_gateway_base_url || setupProfile?.preferred_gateway_base_url || "");  // 本机网关模式：使用系统推荐的网关地址
```

- **远端网关模式** (`localGatewayManaged === false`): 使用用户配置的远程网关地址
- **本机网关模式** (`localGatewayManaged !== false`): 使用 `systemStatus.preferred_gateway_base_url`（如 `http://192.168.0.17:8300`）

## 故障排查

### WebSocket 403 错误

**症状**：浏览器控制台显示 `WebSocket connection failed: Unexpected response code: 403`

**原因**：
1. 前端连接到错误的地址（如 launcher 的 8765 端口而不是网关的 8300 端口）
2. CORS 配置问题
3. 网关未正确启动

**解决方法**：
1. 检查 `systemStatus.preferred_gateway_base_url` 是否正确
2. 确认网关在正确的端口运行
3. 检查 CORS 配置是否包含前端域名

### 消息不实时更新

**症状**：WebSocket 连接成功，但新消息不推送

**原因**：
1. `SessionStreamBroker` 未正确初始化
2. `SessionManager` 未关联 `SessionStreamBroker`
3. 消息保存后未调用 `publish_messages`

**解决方法**：
1. 检查 `lifespan.py` 中是否正确初始化 `session_stream`
2. 确认 `SessionManager` 构造函数接收 `session_stream` 参数
3. 在 `append_message` 中添加日志确认推送逻辑执行

### 连接频繁断开

**症状**：WebSocket 连接建立后很快断开

**原因**：
1. Redis 连接不稳定
2. 网络问题
3. 服务器资源不足

**解决方法**：
1. 检查 Redis 连接状态
2. 增加心跳检测
3. 监控服务器资源使用情况

## 未来优化方向

1. **心跳机制**：使用 WebSocket ping/pong 帧代替应用层心跳
2. **断线重连**：更智能的重连策略，指数退避
3. **消息确认**：客户端确认收到消息，服务器可以清理缓冲区
4. **压缩传输**：对大量消息使用压缩算法
5. **多路复用**：一个 WebSocket 连接订阅多个会话
6. **批量事件处理**：节点事件流支持批量发送以提高吞吐量

---

## 节点事件流协议

### 概述

节点事件流实现了节点与网关之间的双向 WebSocket 通信，统一了任务分发、结果回传、心跳保活等功能，遵循"禁止新增轮询接口"的架构原则。

### 连接建立

节点连接到：
```
ws://<gateway-host>:<gateway-port>/api/nodes/<node_id>/ws?wait_seconds=15
```

**认证**：
- 使用 `Authorization: Bearer <node_token>` 头部认证
- 或使用 `X-Node-Token: <node_token>` 头部认证

**错误码**：
- `4401`: 认证失败 (`unauthorized`)
- `4500`: 服务器未就绪 (`server_not_ready`)
- `4503`: Redis 不可用或调度队列错误 (`redis_unavailable` / `dispatch_unavailable`)

### 事件类型

#### 1. ready 事件（节点 → 网关）

节点请求任务：

```json
{
  "type": "ready"
}
```

**网关响应**：

有任务时：
```json
{
  "type": "task_assigned",
  "task": {
    "task_id": "task_123",
    "session_id": "wechat:user@im.wechat",
    "message": {...},
    "recent_messages": [...],
    "context_version": 5
  }
}
```

无任务时：
```json
{
  "type": "noop"
}
```

#### 2. task_result 事件（节点 → 网关）

任务结果回传：

```json
{
  "type": "task_result",
  "task_id": "task_123",
  "session_id": "wechat:user@im.wechat",
  "context_version": 5,
  "content": "这是 AI 的回复内容",
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 80,
    "total_tokens": 230
  },
  "metadata": {
    "model": "claude-3-5-sonnet-20241022",
    "reasoning_tokens": "0"
  }
}
```

**网关响应**：
- 成功：无响应（静默接受）
- 任务不存在：`{"type": "error", "task_id": "task_123", "reason": "task_not_found"}`
- 调度错误：`{"type": "error", "task_id": "task_123", "reason": "dispatch_error"}`

#### 3. task_failure 事件（节点 → 网关）

任务失败报告：

```json
{
  "type": "task_failure",
  "task_id": "task_123",
  "session_id": "wechat:user@im.wechat",
  "context_version": 5,
  "error_code": "InferenceError",
  "error_message": "推理后端连接超时",
  "retryable": true,
  "metadata": {
    "attempt": "1"
  }
}
```

**网关响应**：同 task_result

#### 4. heartbeat 事件（节点 → 网关）

心跳保活：

```json
{
  "type": "heartbeat"
}
```

**网关响应**：
```json
{
  "type": "pong"
}
```

#### 5. diagnostics 事件（节点 → 网关）

诊断信息上报：

```json
{
  "type": "diagnostics",
  "diagnostics": {
    "state": "connected",
    "message": "节点运行正常",
    "level": "info",
    "timestamp": "2026-04-05T10:30:00Z"
  }
}
```

**网关响应**：
```json
{
  "type": "ack"
}
```

**注意**：当前版本诊断事件被接收但未存储，标记为未来增强功能。
**更新**：当前版本已经会把节点运行态诊断并入网关诊断时间线，并实时推送给连接页。

---

## 节点诊断流协议

### 连接建立

前端连接到：
```
ws://<gateway-host>:<gateway-port>/api/nodes/<node_id>/diagnostics/ws
```

### 消息格式

#### 诊断快照（diagnostics_snapshot）

```json
{
  "type": "diagnostics_snapshot",
  "node_id": "node-1",
  "diagnostics": {
    "node_id": "node-1",
    "connection_state": "connected",
    "last_register_result": "succeeded",
    "timeline": [
      {
        "timestamp": "2026-04-05T10:30:00Z",
        "level": "info",
        "category": "register",
        "result": "succeeded",
        "message": "register succeeded",
        "trace_id": "trace-123",
        "metadata": {
          "source": "node-runtime"
        }
      }
    ]
  }
}
```

### 行为说明

- 连接建立后立即下发当前节点诊断快照
- 后续节点经 task stream 上报新的 `diagnostics` 事件时，网关会把它并入现有诊断记录
- 连接页优先使用这条 WebSocket；失败时才回退到单次 HTTP 读取

---

## 网关摘要流协议

### 连接建立

前端连接到：
```
ws://<gateway-host>:<gateway-port>/api/system/summary/ws
```

### 消息格式

#### 统一摘要（gateway_summary）

```json
{
  "type": "gateway_summary",
  "summary": {
    "system": {
      "redis_ok": true,
      "active_nodes": 2
    },
    "wechat": {
      "configured": true,
      "running": true,
      "received_messages": 12,
      "sent_messages": 9
    },
    "nodes": {
      "nodes": [...],
      "inventory": [...],
      "summary": {
        "paired_total": 2,
        "online_total": 2,
        "offline_total": 0
      }
    }
  }
}
```

### 行为说明

- 建立连接时立即发送一次摘要快照
- 网关后台会按固定节拍重算并推送摘要，用于替代前端反复请求 `/api/wechat/onboard/status` 和 `/api/nodes`
- 微信 connect/disconnect、节点 register/heartbeat 等关键事件会额外触发一次即时 publish
- 前端优先使用这条流；只有在流不可用时才回退到 HTTP 轮询

### 降级机制

节点 Worker 实现了优雅的降级策略：

1. **WebSocket 优先**：默认使用 WebSocket 连接（`task_stream_enabled=true`）
2. **自动降级**：WebSocket 连接失败时自动降级到 HTTP 轮询
3. **事件发送降级**：
   - 尝试通过 WebSocket 发送事件
   - 失败时自动降级到 HTTP POST 接口
   - 确保任务结果不丢失

```python
async def _submit_task_result(self, ...):
    event = {"type": "task_result", ...}
    if await self._try_send_task_stream_event(event):
        return  # WebSocket 发送成功
    # 降级到 HTTP
    await self._gateway.submit_result(...)
```

### 线程安全

节点 Worker 使用 `_task_stream_send_lock` 保护 WebSocket 发送操作：

```python
async def _send_task_stream_event(self, event: dict[str, Any]) -> None:
    websocket = self._task_stream_websocket
    if websocket is None:
        raise RuntimeError("Task stream websocket is not connected")
    async with self._task_stream_send_lock:
        await websocket.send(json.dumps(event))
```

这避免了多个 asyncio 任务同时写入 WebSocket 导致的数据混乱。

### 实现细节

#### 网关端（NodeStreamBroker）

```python
class NodeStreamBroker:
    def __init__(self):
        self._connections: dict[str, WebSocket] = {}
    
    async def register_connection(self, node_id: str, websocket: WebSocket):
        """注册节点连接"""
        self._connections[node_id] = websocket
    
    async def unregister_connection(self, node_id: str):
        """注销节点连接"""
        self._connections.pop(node_id, None)
    
    async def receive_event(self, websocket: WebSocket) -> dict | None:
        """接收节点事件"""
        try:
            message = await websocket.receive_text()
            return json.loads(message)
        except Exception:
            return None
```

#### 节点端（Worker）

```python
async def _task_stream_loop(self):
    while not self._shutdown.is_set():
        try:
            async with self._gateway.task_stream_connection() as websocket:
                self._task_stream_websocket = websocket
                while not self._shutdown.is_set():
                    # 发送 ready 事件请求任务
                    await self._send_task_stream_event({"type": "ready"})
                    
                    # 接收任务或 noop
                    raw_payload = await websocket.recv()
                    payload = json.loads(raw_payload)
                    
                    if payload.get("type") == "task_assigned":
                        task = payload["task"]
                        # 处理任务...
        except websockets.exceptions.ConnectionClosedError as exc:
            if exc.code == 4401:
                # 认证失败，停止循环
                return
            # 其他错误，降级到 HTTP 轮询
            if not await self._poll_once():
                return
        finally:
            self._task_stream_websocket = None
```

---

## 会话概览流协议

### 概述

会话概览流用于实时推送所有会话的状态变更，替代前端对会话列表的轮询。

### 连接建立

前端连接到：
```
ws://<gateway-host>:<gateway-port>/api/sessions/overview/ws
```

### 消息格式

#### 快照消息（sessions_snapshot）

连接建立后，服务器立即发送所有会话的快照：

```json
{
  "type": "sessions_snapshot",
  "sessions": [
    {
      "session_id": "wechat:user1@im.wechat",
      "message_count": 27,
      "assigned_node_id": "agent-1",
      "last_message_at": "2026-04-05T10:30:00Z",
      ...
    },
    {
      "session_id": "wechat:user2@im.wechat",
      "message_count": 15,
      "assigned_node_id": "agent-2",
      ...
    }
  ]
}
```

#### 增量更新（sessions_snapshot）

当任何会话状态变更时，服务器推送完整的会话列表：

```json
{
  "type": "sessions_snapshot",
  "sessions": [...]
}
```

**注意**：当前实现推送完整列表，未来可优化为增量更新。

### 实现细节

#### SessionStreamBroker 扩展

```python
class SessionStreamBroker:
    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = {}
        self._overview_connections: set[WebSocket] = set()  # 概览订阅者
    
    async def subscribe_overview(self, websocket: WebSocket):
        """订阅会话概览"""
        async with self._lock:
            self._overview_connections.add(websocket)
    
    async def unsubscribe_overview(self, websocket: WebSocket):
        """取消订阅会话概览"""
        async with self._lock:
            self._overview_connections.discard(websocket)
    
    async def publish_overview(self, sessions: list[SessionRecord]):
        """推送会话概览更新"""
        payload = {
            "type": "sessions_snapshot",
            "sessions": [s.model_dump(mode="json") for s in sessions],
        }
        async with self._lock:
            subscribers = list(self._overview_connections)
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
            except Exception:
                await self.unsubscribe_overview(websocket)
```

#### WebSocket 端点

```python
@router.websocket("/overview/ws")
async def stream_session_overview(websocket: WebSocket):
    await websocket.accept()
    
    # 检查依赖
    store = websocket.app.state.redis_store
    manager = websocket.app.state.session_manager
    stream = websocket.app.state.session_stream
    
    # 检查 Redis
    if not await store.ping():
        await websocket.close(code=4503, reason="redis_unavailable")
        return
    
    try:
        # 发送初始快照
        sessions = await manager.list_sessions()
        await stream.publish_overview_snapshot(websocket=websocket, sessions=sessions)
        
        # 订阅并保持连接
        await stream.subscribe_overview(websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await stream.unsubscribe_overview(websocket)
```

#### 前端实现

```typescript
function buildSessionOverviewWebSocketUrl(remoteGateway?: string | null) {
  const baseUrl = remoteGateway?.trim() || window.location.origin;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/sessions/overview/ws";
  return url.toString();
}

const connectOverviewSocket = () => {
  const wsUrl = buildSessionOverviewWebSocketUrl(remoteGateway);
  overviewSocket = new WebSocket(wsUrl);
  
  overviewSocket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "sessions_snapshot") {
      setSessions(payload.sessions);
    }
  };
  
  overviewSocket.onerror = () => {
    // 降级到 HTTP 轮询
    scheduleSessionListPolling();
  };
};
```

---

## 相关文件

### 会话消息流
- `apps/gateway/app/services/session_stream.py` - 消息流 broker
- `apps/gateway/app/api/routes/sessions.py` - WebSocket 端点
- `apps/gateway/app/services/session_manager.py` - 会话管理器
- `apps/gateway/app/core/lifespan.py` - 服务生命周期
- `apps/agent-console/src/App.tsx` - 前端 WebSocket 客户端

### 节点事件流
- `apps/gateway/app/services/node_stream.py` - 节点事件流 broker
- `apps/gateway/app/api/routes/nodes.py` - 节点 WebSocket 端点
- `services/claw-node/claw_node/worker.py` - 节点 Worker 实现
- `services/claw-node/claw_node/gateway_client.py` - 网关客户端
- `apps/gateway/app/services/node_diagnostics_stream.py` - 节点诊断流 broker
- `apps/gateway/app/services/gateway_summary_stream.py` - 网关摘要流 broker
- `apps/gateway/app/services/gateway_summary_service.py` - 网关摘要聚合服务
- `services/claw-node/claw_node/diagnostics.py` - 节点本地诊断与事件源

### 文档
- `docs/changelog.md` - 变更日志
- `docs/gateway-node-console-implementation-roadmap.md` - 实施路线图
- `apps/gateway/app/models/session.py` - 会话数据模型
