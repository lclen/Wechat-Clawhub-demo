# Summary 事件流优化 - 2026-04-06

## 背景

当前系统已实现 `summary/ws` WebSocket 推送，但存在以下问题：
1. sessions 工作区跳过了 summary 轮询，导致 WebSocket 失败时无降级方案
2. HTTP 轮询频率过高（3.2 秒），作为降级方案不够合理
3. 部分节点操作（删除、断开连接）未触发 summary 推送

## 优化目标

1. 统一所有工作区的 summary 数据获取策略
2. 优化 HTTP 轮询频率，作为合理的降级方案
3. 完善事件触发推送机制

## 实施内容

### 1. 修复 sessions 工作区的 summary 轮询逻辑

**位置**：`apps/agent-console/src/App.tsx:1199-1205`

**变更前**：
```typescript
const run = async () => {
  if (gatewaySummaryStreamActive) {
    return;
  }
  if (workspace === "sessions") {
    return;  // sessions 工作区跳过轮询
  }
  // ...
}
```

**变更后**：
```typescript
const run = async () => {
  // WebSocket 连接成功时跳过 HTTP 轮询
  if (gatewaySummaryStreamActive) {
    return;
  }
  // 所有工作区都需要 summary 数据（节点状态、微信状态、系统状态）
  // 移除 sessions 工作区的特殊处理，统一使用 WebSocket 优先 + HTTP 降级策略
  // ...
}
```

**原因**：
- sessions 工作区显示节点信息（`assigned_node_id`），需要节点状态数据
- 移除特殊处理，统一使用 WebSocket 优先 + HTTP 降级策略
- 确保所有工作区在 WebSocket 失败时都有数据源

### 2. 优化 summary HTTP 轮询频率

**位置**：`apps/agent-console/src/App.tsx:125-127`

**变更**：
```typescript
const IDLE_POLL_MS = 3200;
const SUMMARY_FALLBACK_POLL_MS = 10000; // summary WebSocket 降级时的 HTTP 轮询间隔（10 秒）
const RETRY_POLL_MS = 1000; // backend unreachable — retry quickly
```

**应用**：
- 节点角色 summary 轮询：3.2 秒 → 10 秒
- 控制台角色 summary 轮询：3.2 秒 → 10 秒
- 本地网关角色 summary 轮询：3.2 秒 → 10 秒

**原因**：
- WebSocket 推送频率为 2 秒，HTTP 轮询作为降级方案
- 10 秒间隔足够满足降级场景的实时性要求
- 减少约 70% 的 HTTP 请求（当 WebSocket 失败时）

### 3. 添加节点删除/断开连接的 summary 推送

**位置**：`apps/gateway/app/api/routes/nodes.py`

**节点删除**（Line 140-169）：
```python
@router.delete("/{node_id}", response_model=NodeDeleteResponse)
async def delete_node(
    node_id: str,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    setup_service: SetupService = Depends(get_setup_service),
    request: Request = None,  # 新增
) -> NodeDeleteResponse:
    # ... 删除逻辑 ...

    # 推送 summary 更新（节点列表变更）
    if request:
        await request.app.state.gateway_summary_service.publish_if_needed()

    return NodeDeleteResponse(...)
```

**节点断开连接**（Line 171-192）：
```python
@router.post("/{node_id}/disconnect", response_model=NodeDeleteResponse)
async def disconnect_node(
    node_id: str,
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    request: Request = None,  # 新增
) -> NodeDeleteResponse:
    # ... 断开连接逻辑 ...

    # 推送 summary 更新（节点列表变更）
    if request:
        await request.app.state.gateway_summary_service.publish_if_needed()

    return NodeDeleteResponse(...)
```

**原因**：
- 节点删除/断开连接会改变节点列表
- 立即推送 summary 更新，前端实时感知节点状态变化
- 避免等待后台定时推送（2 秒延迟）

## 优化效果

### 数据一致性

**优化前**：
- sessions 工作区：WebSocket 失败时无数据源
- 可能导致节点状态显示不正确

**优化后**：
- 所有工作区：WebSocket 优先 + HTTP 降级
- 确保数据始终可用

### 请求频率

**WebSocket 正常时**：
- 推送频率：2 秒（后台定时）
- HTTP 请求：0（完全依赖 WebSocket）

**WebSocket 失败时**：
- 优化前：3.2 秒轮询
- 优化后：10 秒轮询
- 减少约 70% 的请求

### 实时性

**节点状态变更**：
- 优化前：最多 2 秒延迟（后台定时推送）
- 优化后：立即推送（事件触发）
- 包括：注册、心跳、删除、断开连接

**微信状态变更**：
- 已有事件触发推送（wechat.py:63, 77）
- 立即推送，无延迟

## 当前 summary 推送触发点

### 事件触发（立即推送）

1. **节点注册**：`POST /api/nodes/{node_id}/register` → `publish_if_needed()`
2. **节点心跳**：`POST /api/nodes/{node_id}/heartbeat` → `publish_if_needed()`
3. **节点删除**：`DELETE /api/nodes/{node_id}` → `publish_if_needed()` ✨ 新增
4. **节点断开**：`POST /api/nodes/{node_id}/disconnect` → `publish_if_needed()` ✨ 新增
5. **微信状态变更**：`POST /api/wechat/onboard/start` → `publish_if_needed()`
6. **微信状态变更**：`POST /api/wechat/onboard/stop` → `publish_if_needed()`

### 定时推送（兜底）

- **后台循环**：每 2 秒推送一次（如果有订阅者）
- 位置：`apps/gateway/app/core/lifespan.py:95-101`

## 架构优势

### WebSocket 优先

- 实时性：2 秒推送 + 事件触发
- 低延迟：毫秒级推送
- 低开销：单一连接，多路复用

### HTTP 降级

- 可靠性：WebSocket 失败时自动降级
- 合理频率：10 秒间隔，避免过度轮询
- 兜底保障：确保数据始终可用

### 事件驱动

- 关键操作立即推送
- 减少等待时间
- 提升用户体验

## 测试验证

### 验证步骤

1. **WebSocket 正常场景**
   - 启动网关和节点
   - 观察浏览器开发者工具 WebSocket 连接
   - 确认 summary 数据通过 WebSocket 推送
   - 确认无 HTTP 轮询请求

2. **WebSocket 降级场景**
   - 关闭网关 WebSocket 端点（模拟故障）
   - 观察前端自动降级到 HTTP 轮询
   - 确认轮询间隔为 10 秒
   - 确认数据仍然正常显示

3. **sessions 工作区**
   - 切换到 sessions 工作区
   - 观察节点状态显示（`assigned_node_id`）
   - 确认数据正确显示
   - 确认 WebSocket 失败时有降级方案

4. **节点删除/断开连接**
   - 删除或断开一个节点
   - 观察前端节点列表立即更新
   - 确认无需等待 2 秒定时推送

### 预期结果

- 所有工作区都能正常获取 summary 数据
- WebSocket 正常时无 HTTP 轮询
- WebSocket 失败时自动降级到 10 秒轮询
- 节点删除/断开连接立即推送更新
- 无功能回归问题

## 相关文件

### 前端
- `apps/agent-console/src/App.tsx` - summary WebSocket 连接和 HTTP 降级

### 后端
- `apps/gateway/app/api/routes/system.py` - summary 接口和 WebSocket 端点
- `apps/gateway/app/api/routes/nodes.py` - 节点操作和推送触发
- `apps/gateway/app/api/routes/wechat.py` - 微信操作和推送触发
- `apps/gateway/app/services/gateway_summary_service.py` - summary 服务
- `apps/gateway/app/services/gateway_summary_stream.py` - summary 推送 broker
- `apps/gateway/app/core/lifespan.py` - 后台定时推送

## 后续优化方向

1. **完全替代轮询**
   - 当 WebSocket 稳定后，考虑移除 HTTP 轮询
   - 仅保留初始化时的一次 HTTP 请求

2. **按需订阅**
   - 根据工作区订阅不同的数据
   - quick_setup：仅订阅 launcher 状态
   - connection：订阅 summary（节点、微信、系统）
   - sessions：订阅会话消息

3. **推送优化**
   - 增量推送：仅推送变更的部分
   - 批量推送：合并短时间内的多次变更
   - 智能推送：根据订阅者需求推送

4. **监控指标**
   - WebSocket 连接成功率
   - 推送延迟统计
   - HTTP 降级频率
   - 数据一致性检查
