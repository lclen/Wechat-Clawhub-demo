# 控制台摘要轮询优化 - 2026-04-06

## 背景

在 connection 和 quick_setup 工作区中，前端存在分散的网关探测逻辑：
1. 自动触发 `probeWorkerGateway`（调用 `/local/gateway/probe` 或 `/api/setup/gateway/probe`）
2. 轮询 `summary` 接口获取节点状态
3. 两套逻辑并存，数据来源不统一

## 优化目标

统一所有工作区的网关探测逻辑到 `summary` 数据源，移除分散的 `probe` 调用。

## 实施内容

### 1. 移除自动探测 useEffect

**位置**：`apps/agent-console/src/App.tsx:760-773`

**变更前**：
```typescript
useEffect(() => {
  if (!currentRoleIsWorker) return;
  if (!launcherShouldRunGateway(launcherStatus)) return;
  const gatewayBaseUrl = workerSetup.gateway_base_url.trim();
  const nodeId = workerSetup.node_id.trim();
  if (!gatewayBaseUrl || !nodeId || busy === "setup-gateway-probe") return;
  const probeKey = `${gatewayBaseUrl}::${nodeId}`;
  if (workerGatewayAutoProbeKeyRef.current === probeKey) return;
  const timer = window.setTimeout(() => {
    void probeWorkerGateway({ silent: true, reason: "auto" });
  }, 400);
  return () => window.clearTimeout(timer);
}, [busy, currentRoleIsWorker, launcherStatus, workerSetup.gateway_base_url, workerSetup.node_id]);
```

**变更后**：
```typescript
// 移除自动探测 useEffect，统一使用 summary 轮询获取节点状态
// 节点角色下的探测状态由 summary 轮询自动构造（见 Line 1218-1257）
```

**原因**：
- 节点角色的探测状态已在 `summary` 轮询中自动构造（Line 1218-1257）
- 避免重复调用 `probe` 接口和 `summary` 接口
- 减少不必要的网络请求

### 2. 明确 probeWorkerGateway 的用途

**位置**：`apps/agent-console/src/App.tsx:2056`

**变更**：添加注释说明此函数仅用于手动触发

```typescript
/**
 * 手动触发网关探测（仅用于 quick_setup 工作区的"检测连接"按钮）
 *
 * 注意：节点角色和控制台角色的自动探测已统一到 summary 轮询中，
 * 不再需要调用此函数进行自动探测。
 */
async function probeWorkerGateway(options?: { silent?: boolean; reason?: "manual" | "auto" | "post-install" }) {
  // ...
}
```

### 3. 保留的探测逻辑

**节点角色（worker）**：
- 位置：`apps/agent-console/src/App.tsx:1218-1245`
- 轮询 `${remoteGateway}/api/system/summary`
- 从 `summary.nodes.nodes` 中查找当前节点
- 自动构造 `workerGatewayProbeTask`

**控制台角色（console_only）**：
- 位置：`apps/agent-console/src/App.tsx:1251-1271`
- 轮询 `${remoteGateway}/api/system/summary`
- 不需要构造探测状态（控制台不显示节点探测信息）

**本地网关角色（gateway_host）**：
- 位置：`apps/agent-console/src/App.tsx:1273-1289`
- 轮询 `/api/system/summary`
- 不需要构造探测状态（自己就是网关）

**手动探测（quick_setup 工作区）**：
- 保留 `probeWorkerGateway` 函数
- 用于"检测连接"按钮的手动触发
- 调用 `/local/gateway/probe` 或 `/api/setup/gateway/probe`

## 优化效果

### 减少请求数量

**优化前**（节点角色）：
- 自动触发 `probe` 接口（每次配置变更）
- 轮询 `summary` 接口（3 秒间隔）
- 两套逻辑并存

**优化后**（节点角色）：
- 仅轮询 `summary` 接口（3 秒间隔）
- 从 `summary` 数据中构造探测状态
- 减少约 50% 的请求

### 数据一致性

- 所有角色统一使用 `summary` 作为数据源
- 避免 `probe` 和 `summary` 数据不一致
- 简化状态管理逻辑

### 代码可维护性

- 移除重复的探测逻辑
- 明确各函数的职责
- 减少代码复杂度

## 相关文件

- `apps/agent-console/src/App.tsx` - 前端主应用
- `apps/gateway/app/api/routes/system.py` - summary 接口
- `apps/gateway/app/services/gateway_summary_service.py` - summary 服务
- `apps/gateway/app/models/gateway_summary.py` - summary 数据模型

## 后续优化方向

1. **进一步减少轮询频率**
   - ✅ 摘要轮询已从通用 3 秒级轮询拆分出来，统一改为 10 秒
   - ⏳ 系统极轻量状态若继续保留独立轮询，可进一步拉长到 30 秒

2. **事件流化**
   - 节点状态变更推送（WebSocket）
   - 微信状态变更推送（WebSocket）
   - 完全替代轮询

3. **按工作区优化**
   - quick_setup：仅轮询 launcher 状态
   - connection：轮询 summary（节点、微信、系统）
   - sessions：仅 WebSocket 推送会话消息

## 测试验证

### 验证步骤

1. **节点角色自动探测**
   - 启动节点角色
   - 填写目标网关地址和节点 ID
   - 观察 connection 工作区的连接状态
   - 确认状态正确显示（网关可达、节点已连接等）

2. **手动探测**
   - 进入 quick_setup 工作区
   - 点击"检测连接"按钮
   - 确认探测结果正确显示

3. **网络请求监控**
   - 打开浏览器开发者工具
   - 观察网络请求
   - 确认不再有自动的 `probe` 请求
   - 仅有 `summary` 轮询请求

### 预期结果

- 节点角色的连接状态正确显示
- 手动探测功能正常工作
- 网络请求数量减少约 50%
- 无功能回归问题
