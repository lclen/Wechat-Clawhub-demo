# 设计文档：角色感知工作区（role-based-workspace）

## 概述

本功能在现有 `App.tsx` 单文件架构基础上，为四种部署角色（`gateway_host`、`gateway_host_console`、`worker_node`、`console_only`）提供专属的工作区视图和配置向导体验。

核心变更分三个层面：

1. **路由层**：配置完成后根据角色自动导航，初始化时遵循 `SetupProfile.recommended_workspace`
2. **标签层**：工作区标签页附加角色徽标，直观反映当前角色的主工作区
3. **内容层**：`connection` 和 `sessions` 工作区根据 `effectiveRole` 渲染不同的视图；`worker_node` 配置向导在视觉和布局上与网关配置明显区分

现有系统已有大量实现：`effectiveRole` 推导逻辑、`connectionHeroCards` 的角色分支、`currentRoleIsWorker` 条件渲染等。本设计在此基础上补充缺失的部分，不重写已有逻辑。

---

## 架构

### 现有架构概述

`App.tsx` 是一个约 3100 行的单文件 React 组件，包含：

- **类型定义**（顶部约 80 行）：`SetupRole`、`WorkspaceTab`、`SetupMode` 等
- **状态层**：约 50 个 `useState` hooks，管理工作区、配置草稿、节点状态、会话等
- **副作用层**：约 15 个 `useEffect`，处理轮询、初始化、任务监听
- **业务函数层**：约 40 个 async/sync 函数，处理配置提交、节点操作等
- **派生状态层**：约 20 个 `useMemo`，计算 `effectiveRole`、`connectionHeroCards` 等
- **渲染层**：三个工作区的 JSX，通过 `workspace === "xxx"` 条件切换

### 角色路由逻辑（现有 + 新增）

```
SetupProfile.recommended_workspace
    ↓ 初始化时（已有：setWorkspace(profile.recommended_workspace)）
WorkspaceTab（新增：持久化到 localStorage）

setupTask.status === "succeeded"
    ↓ 任务完成时（新增：按角色自动导航）
WorkspaceTab
    gateway_host / gateway_host_console / worker_node → "connection"
    console_only → "sessions"
```

### 工作区内容分支（现有 + 新增）

```
workspace === "connection"
    effectiveRole
        gateway_host / gateway_host_console → 网关视图（现有大部分，新增角色徽标 + console_only 快捷入口）
        worker_node → 节点视图（现有大部分，新增 IP/端口展示 + token 状态 + 消息列表）
        console_only → 节点视图（现有，无需改动）

workspace === "sessions"
    effectiveRole
        console_only → 新增网关连接状态 banner + 不可达提示
        其他角色 → 现有实现不变

workspace === "quick_setup"
    setupRole === "worker_node" → 节点配置向导（现有表单 + 新增视觉区分 + token 只读区域 + 模型折叠区）
    其他角色 → 现有实现不变
```

---

## 组件与接口

### 新增/改动的 React 状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `workerModelExpanded` | `boolean` | 节点配置向导中模型配置折叠区的展开状态（新增） |
| `workerGatewayProbeResult` | `"reachable" \| "unreachable" \| null` | 节点向导内"检测连接"的即时结果（复用现有 `workerGatewayProbeTask`） |

> 注：大部分所需状态已存在（`effectiveRole`、`currentRoleIsWorker`、`localNodeStatus`、`nodeMessages` 等），无需新增。

### 新增 CSS 类

| 类名 | 用途 |
|------|------|
| `.workspace-tab-badge` | 标签页角色徽标容器 |
| `.role-badge` | 角色徽标样式（小圆角标签） |
| `.role-badge-gateway` | 网关角色徽标配色（蓝色系） |
| `.role-badge-worker` | 工作节点角色徽标配色（绿色系） |
| `.role-badge-console` | 控制台角色徽标配色（琥珀色系） |
| `.worker-wizard` | 节点配置向导外层容器（绿色主题背景） |
| `.worker-wizard-identity` | 节点身份展示区（IP + 端口突出显示） |
| `.worker-wizard-identity-ip` | IP 地址大字展示 |
| `.worker-token-readonly` | Token 只读状态区域 |
| `.worker-model-collapse` | 模型配置折叠区 |
| `.console-gateway-banner` | console_only 角色在 sessions 工作区顶部的网关状态 banner |
| `.console-gateway-banner-error` | 网关不可达时的 banner 变体 |

### 节点配置向导的视觉区分方案

工作节点配置向导（`setupRole === "worker_node"` 且 `setupMode === "config"`）采用与网关配置明显不同的视觉语言：

**网关配置**：白色/米色背景，蓝色强调色，表单字段密集排列，强调"写入配置、启动服务"

**节点配置向导**：
- 外层容器使用 `.worker-wizard`，背景为绿色渐变（`rgba(239, 249, 244, 0.96)` → `rgba(250, 255, 252, 0.92)`），与现有 `.node-role-surface` 一致
- 顶部身份区 `.worker-wizard-identity` 突出展示本机 IP 和发现端口，字号大于普通表单字段
- 步骤结构：① 身份确认（IP + 端口）→ ② 目标网关（含检测按钮）→ ③ 配对密钥 → ④ Token 状态（只读）→ ⑤ 模型配置（折叠，可选）
- Token 字段使用 `.worker-token-readonly`，背景为浅灰，明确标注"只读，等待网关下发"
- 模型配置区使用 `.worker-model-collapse`，默认折叠，展开时显示 OpenAI 兼容接口和 Dify 两个子区域

---

## 数据模型

### 角色到工作区的映射

```typescript
// 新增纯函数，替代分散的条件判断
function resolveRoleWorkspace(role: SetupRole): WorkspaceTab {
  if (role === "console_only") return "sessions";
  return "connection";
}
```

### localStorage 持久化键

```typescript
const WORKSPACE_STATE_KEY = "wechat-claw-hub.workspace";
// 值：WorkspaceTab 字符串
// 写入时机：SetupProfile 加载完成后，以及配置任务成功完成后
// 读取时机：App 初始化时（优先级低于 SetupProfile.recommended_workspace）
```

### 角色徽标映射

```typescript
function resolveRoleBadge(effectiveRole: SetupRole | null): {
  tab: WorkspaceTab;
  label: string;
  variant: "gateway" | "worker" | "console";
} | null {
  if (effectiveRole === "gateway_host" || effectiveRole === "gateway_host_console")
    return { tab: "connection", label: "主网关", variant: "gateway" };
  if (effectiveRole === "worker_node")
    return { tab: "connection", label: "工作节点", variant: "worker" };
  if (effectiveRole === "console_only")
    return { tab: "sessions", label: "控制台", variant: "console" };
  return null;
}
```

---

## 正确性属性

*属性（Property）是在系统所有合法执行路径上都应成立的特征或行为——本质上是对系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。*

### 属性 1：角色到工作区的路由映射

*对于任意* `SetupRole`，当该角色的配置任务成功完成时，`workspace` 状态应切换到 `resolveRoleWorkspace(role)` 返回的值：`console_only` → `sessions`，其余角色 → `connection`。

**验证：需求 1.1、1.2、1.3、1.4、8.9**

### 属性 2：SetupProfile 推荐工作区优先

*对于任意* `SetupProfile`，当 `setup_completed` 为 `true` 且 `recommended_workspace` 为 `connection` 或 `sessions` 时，初始化后的 `workspace` 状态应等于 `recommended_workspace`；当 `setup_completed` 为 `false` 时，初始工作区应为 `quick_setup`。

**验证：需求 1.5、7.1、7.4**

### 属性 3：completed_roles 到工作区的推导

*对于任意* `completed_roles` 数组，若包含 `gateway_host`、`gateway_host_console` 或 `worker_node` 中任意一个，则推导出的初始工作区应为 `connection`；若仅包含 `console_only`，则应为 `sessions`。

**验证：需求 7.2、7.3**

### 属性 4：任务失败时工作区不变

*对于任意* 当前工作区和任意角色，当 `setupTask.status` 变为 `failed` 时，`workspace` 状态应保持不变。

**验证：需求 1.6**

### 属性 5：角色徽标与主工作区对应

*对于任意* `effectiveRole`，`resolveRoleBadge` 返回的 `tab` 字段应与 `resolveRoleWorkspace` 返回的工作区一致（`console_only` → `sessions`，其余 → `connection`）。

**验证：需求 5.1、5.2、5.3**

### 属性 6：标签页切换不受角色限制

*对于任意* `effectiveRole` 和任意目标 `WorkspaceTab`，调用 `setWorkspace(tab)` 后 `workspace` 状态应等于 `tab`，不受当前角色约束。

**验证：需求 5.4**

### 属性 7：节点配置向导的网关地址验证

*对于任意* `workerSetup`，当 `gateway_base_url` 为空字符串或纯空白字符串时，提交节点配置应被阻止，`setupTask` 状态不应发生变化。

**验证：需求 8.8**

### 属性 8：Token 状态展示逻辑

*对于任意* `workerSetup`，当 `node_token` 为空时，token 状态区域应显示"等待网关下发"语义的文本；当 `node_token` 非空时，应显示"已配对"语义的文本，且不显示 token 明文。

**验证：需求 3.7、8.6**

### 属性 9：角色切换确认保护

*对于任意* 已完成角色集合 `completedRoles` 和新选角色 `newRole`，当 `newRole` 不在 `completedRoles` 中时，选择 `newRole` 应触发确认提示；若用户取消，`setupRole` 和 `setupMode` 应保持不变。

**验证：需求 6.3、6.4**

### 属性 10：localStorage 工作区持久化

*对于任意* 配置任务成功完成后的工作区状态，`localStorage.getItem(WORKSPACE_STATE_KEY)` 应返回与当前 `workspace` 状态一致的值。

**验证：需求 7.5**

---

## 错误处理

### 网关不可达（console_only 角色）

- `sessions` 工作区顶部展示 `.console-gateway-banner-error`，包含错误摘要和"前往快速配置"按钮
- 触发条件：轮询 `/api/system/status` 失败，或 `systemStatus` 为 `null` 且 `sessionsLoaded` 为 `true`
- 不阻断会话列表的展示（可能有缓存数据）

### 节点注册失败（worker_node 角色）

- `localNodeStatus.runtime_state === "register_failed"` 时，`connection` 工作区展示失败原因和"重置凭据"按钮
- "重置凭据"调用现有 `/api/setup/node/reset-credentials` 接口
- `runtime_state === "needs_repair"` 时，展示修复提示并提供"前往快速配置"跳转

### 节点配置向导的网关探测失败

- 探测结果直接复用 `workerGatewayProbeTask` 状态
- 失败时在"检测连接"按钮旁显示红色"✗ 无法连接"提示
- 不阻断表单提交（探测失败不等于配置无效）

---

## 测试策略

### 单元测试

针对以下纯函数编写示例测试：

- `resolveRoleWorkspace(role)` — 验证四种角色的映射结果
- `resolveRoleBadge(effectiveRole)` — 验证徽标 tab 与工作区一致性
- `resolveEffectiveRole(currentRole, completedRoles)` — 现有函数，验证推导优先级
- Token 状态展示逻辑（空 vs 非空）
- 节点配置向导的 `gateway_base_url` 空值验证

### 属性测试

使用 [fast-check](https://github.com/dubzzz/fast-check) 对以下属性编写属性测试，每个属性最少运行 100 次：

**属性 1：角色到工作区的路由映射**
```typescript
// Feature: role-based-workspace, Property 1: role-to-workspace routing
fc.assert(fc.property(
  fc.constantFrom<SetupRole>("gateway_host", "gateway_host_console", "worker_node", "console_only"),
  (role) => {
    const expected = role === "console_only" ? "sessions" : "connection";
    return resolveRoleWorkspace(role) === expected;
  }
), { numRuns: 100 });
```

**属性 2：SetupProfile 推荐工作区优先**
```typescript
// Feature: role-based-workspace, Property 2: recommended_workspace priority
fc.assert(fc.property(
  fc.record({
    recommended_workspace: fc.constantFrom("quick_setup", "connection", "sessions"),
    setup_completed: fc.boolean(),
  }),
  (profile) => {
    const result = resolveInitialWorkspace(profile);
    if (!profile.setup_completed) return result === "quick_setup";
    return result === profile.recommended_workspace;
  }
), { numRuns: 100 });
```

**属性 3：completed_roles 到工作区的推导**
```typescript
// Feature: role-based-workspace, Property 3: completed_roles workspace derivation
fc.assert(fc.property(
  fc.array(fc.constantFrom<SetupRole>("gateway_host", "gateway_host_console", "worker_node", "console_only")),
  (completedRoles) => {
    const result = resolveWorkspaceFromCompletedRoles(completedRoles);
    const hasGatewayOrWorker = completedRoles.some(r => r !== "console_only");
    const hasConsoleOnly = completedRoles.includes("console_only") && !hasGatewayOrWorker;
    if (hasGatewayOrWorker) return result === "connection";
    if (hasConsoleOnly) return result === "sessions";
    return result === "quick_setup";
  }
), { numRuns: 100 });
```

**属性 4：任务失败时工作区不变**
```typescript
// Feature: role-based-workspace, Property 4: workspace unchanged on task failure
fc.assert(fc.property(
  fc.constantFrom<WorkspaceTab>("quick_setup", "sessions", "connection"),
  fc.constantFrom<SetupRole>("gateway_host", "gateway_host_console", "worker_node", "console_only"),
  (currentWorkspace, role) => {
    const result = resolveWorkspaceOnTaskComplete("failed", role, currentWorkspace);
    return result === currentWorkspace;
  }
), { numRuns: 100 });
```

**属性 5：角色徽标与主工作区对应**
```typescript
// Feature: role-based-workspace, Property 5: role badge tab matches workspace
fc.assert(fc.property(
  fc.constantFrom<SetupRole>("gateway_host", "gateway_host_console", "worker_node", "console_only"),
  (role) => {
    const badge = resolveRoleBadge(role);
    if (!badge) return true;
    return badge.tab === resolveRoleWorkspace(role);
  }
), { numRuns: 100 });
```

**属性 7：节点配置向导的网关地址验证**
```typescript
// Feature: role-based-workspace, Property 7: worker gateway URL validation
fc.assert(fc.property(
  fc.string().filter(s => s.trim() === ""),
  (emptyUrl) => {
    return validateWorkerGatewayUrl(emptyUrl) === false;
  }
), { numRuns: 100 });
```

**属性 8：Token 状态展示逻辑**
```typescript
// Feature: role-based-workspace, Property 8: token display logic
fc.assert(fc.property(
  fc.string(),
  (token) => {
    const display = resolveTokenDisplayState(token);
    if (!token.trim()) return display.status === "waiting" && !display.showToken;
    return display.status === "paired" && !display.showToken;
  }
), { numRuns: 100 });
```

**属性 9：角色切换确认保护**
```typescript
// Feature: role-based-workspace, Property 9: role switch confirmation guard
fc.assert(fc.property(
  fc.array(fc.constantFrom<SetupRole>("gateway_host", "gateway_host_console", "worker_node", "console_only")),
  fc.constantFrom<SetupRole>("gateway_host", "gateway_host_console", "worker_node", "console_only"),
  (completedRoles, newRole) => {
    const needsConfirm = requiresRoleSwitchConfirmation(completedRoles, newRole);
    const isNewRole = !completedRoles.includes(newRole);
    return needsConfirm === (completedRoles.length > 0 && isNewRole);
  }
), { numRuns: 100 });
```

**属性 10：localStorage 工作区持久化**
```typescript
// Feature: role-based-workspace, Property 10: workspace localStorage persistence
fc.assert(fc.property(
  fc.constantFrom<WorkspaceTab>("quick_setup", "sessions", "connection"),
  (workspace) => {
    persistWorkspace(workspace);
    return loadPersistedWorkspace() === workspace;
  }
), { numRuns: 100 });
```

### 测试文件位置

```
apps/agent-console/src/
  __tests__/
    role-based-workspace.unit.test.ts   # 单元测试（纯函数）
    role-based-workspace.pbt.test.ts    # 属性测试（fast-check）
```

### 可测试的纯函数提取

为支持上述测试，以下逻辑需从 `App.tsx` 提取为独立的纯函数（可放在同文件底部或单独的 `utils.ts`）：

```typescript
export function resolveRoleWorkspace(role: SetupRole): WorkspaceTab
export function resolveRoleBadge(role: SetupRole | null): RoleBadge | null
export function resolveInitialWorkspace(profile: Pick<SetupProfileResponse, "recommended_workspace" | "setup_completed">): WorkspaceTab
export function resolveWorkspaceFromCompletedRoles(completedRoles: SetupRole[]): WorkspaceTab
export function resolveWorkspaceOnTaskComplete(status: SetupTaskStatus, role: SetupRole, currentWorkspace: WorkspaceTab): WorkspaceTab
export function validateWorkerGatewayUrl(url: string): boolean
export function resolveTokenDisplayState(token: string): { status: "waiting" | "paired"; showToken: false }
export function requiresRoleSwitchConfirmation(completedRoles: SetupRole[], newRole: SetupRole): boolean
export function persistWorkspace(workspace: WorkspaceTab): void
export function loadPersistedWorkspace(): WorkspaceTab | null
```
