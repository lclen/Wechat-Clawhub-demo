# WebSocket 实时消息推送

## 概述

本文档描述 wechat-claw-hub 的 WebSocket 实时消息推送功能，用于在会话观察台实现消息的实时更新，替代传统的 HTTP 轮询方式。

## 架构设计

### 核心组件

1. **SessionStreamBroker** (`apps/gateway/app/services/session_stream.py`)
   - 会话消息流的发布/订阅中心
   - 管理 WebSocket 连接的订阅关系
   - 负责向订阅者推送消息更新

2. **WebSocket 端点** (`apps/gateway/app/api/routes/sessions.py`)
   - 路径：`/api/sessions/{session_id}/ws`
   - 处理 WebSocket 连接的建立、维护和关闭
   - 发送初始快照和增量更新

3. **前端 WebSocket 客户端** (`apps/agent-console/src/App.tsx`)
   - 自动连接到会话 WebSocket
   - 处理快照和增量消息
   - 失败时自动降级到 HTTP 轮询

### 消息流向

```
微信消息 → Gateway → SessionManager.append_message()
                          ↓
                    SessionStreamBroker.publish_messages()
                          ↓
                    WebSocket 订阅者 (前端)
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
const sessionRemoteGatewayBaseUrl = gatewayEnabled === false
  ? workerSetup.gateway_base_url.trim()  // 节点模式：使用配置的远程网关
  : (systemStatus?.preferred_gateway_base_url || setupProfile?.preferred_gateway_base_url || "");  // 网关模式：使用系统推荐的网关地址
```

- **节点模式** (`gatewayEnabled === false`): 使用用户配置的远程网关地址
- **网关模式** (`gatewayEnabled !== false`): 使用 `systemStatus.preferred_gateway_base_url`（如 `http://192.168.0.17:8300`）

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

1. **心跳机制**：定期发送 ping/pong 保持连接活跃
2. **断线重连**：更智能的重连策略，指数退避
3. **消息确认**：客户端确认收到消息，服务器可以清理缓冲区
4. **压缩传输**：对大量消息使用压缩算法
5. **多路复用**：一个 WebSocket 连接订阅多个会话
6. **服务端推送**：支持更多类型的实时事件（节点状态变化、系统通知等）

## 相关文件

- `apps/gateway/app/services/session_stream.py` - 消息流 broker
- `apps/gateway/app/api/routes/sessions.py` - WebSocket 端点
- `apps/gateway/app/services/session_manager.py` - 会话管理器
- `apps/gateway/app/core/lifespan.py` - 服务生命周期
- `apps/agent-console/src/App.tsx` - 前端 WebSocket 客户端
- `apps/gateway/app/models/session.py` - 会话数据模型
