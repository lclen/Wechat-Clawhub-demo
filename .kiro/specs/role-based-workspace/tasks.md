# 实现计划：角色感知工作区（role-based-workspace）

## 概述

基于现有 `App.tsx` 单文件架构，分三个层面实现角色感知工作区：
1. 提取纯函数到 `roleWorkspace.ts`，支持属性测试
2. 样式层：新增角色徽标、节点配置向导绿色主题、console_only banner 等 CSS 类
3. 逻辑层：角色感知路由、标签页徽标、工作区内容分支

设计文档中所有属性测试均使用 fast-check，测试文件放在 `apps/agent-console/src/__tests__/`。

---

## Tasks

- [x] 1. 提取纯函数到 `roleWorkspace.ts`
  - 在 `apps/agent-console/src/` 新建 `roleWorkspace.ts`
  - 实现并导出以下纯函数（类型从 App.tsx 复制或 import）：
    - `resolveRoleWorkspace(role: SetupRole): WorkspaceTab`
    - `resolveRoleBadge(role: SetupRole | null): RoleBadge | null`
    - `resolveInitialWorkspace(profile): WorkspaceTab`
    - `resolveWorkspaceFromCompletedRoles(completedRoles: SetupRole[]): WorkspaceTab`
    - `resolveWorkspaceOnTaskComplete(status, role, currentWorkspace): WorkspaceTab`
    - `validateWorkerGatewayUrl(url: string): boolean`
    - `resolveTokenDisplayState(token: string): { status: "waiting" | "paired"; showToken: false }`
    - `requiresRoleSwitchConfirmation(completedRoles: SetupRole[], newRole: SetupRole): boolean`
    - `persistWorkspace(workspace: WorkspaceTab): void`
    - `loadPersistedWorkspace(): WorkspaceTab | null`
  - 导出 `WORKSPACE_STATE_KEY` 常量
  - _需求：1.1–1.6、5.1–5.3、7.1–7.5、8.8_

  - [ ]* 1.1 为 `resolveRoleWorkspace` 编写属性测试
    - **属性 1：角色到工作区的路由映射**
    - **验证：需求 1.1、1.2、1.3、1.4、8.9**

  - [ ]* 1.2 为 `resolveInitialWorkspace` 编写属性测试
    - **属性 2：SetupProfile 推荐工作区优先**
    - **验证：需求 1.5、7.1、7.4**

  - [ ]* 1.3 为 `resolveWorkspaceFromCompletedRoles` 编写属性测试
    - **属性 3：completed_roles 到工作区的推导**
    - **验证：需求 7.2、7.3**

  - [ ]* 1.4 为 `resolveWorkspaceOnTaskComplete` 编写属性测试
    - **属性 4：任务失败时工作区不变**
    - **验证：需求 1.6**

  - [ ]* 1.5 为 `resolveRoleBadge` 编写属性测试
    - **属性 5：角色徽标与主工作区对应**
    - **验证：需求 5.1、5.2、5.3**

  - [ ]* 1.6 为 `validateWorkerGatewayUrl` 编写属性测试
    - **属性 7：节点配置向导的网关地址验证**
    - **验证：需求 8.8**

  - [ ]* 1.7 为 `resolveTokenDisplayState` 编写属性测试
    - **属性 8：Token 状态展示逻辑**
    - **验证：需求 3.7、8.6**

  - [ ]* 1.8 为 `requiresRoleSwitchConfirmation` 编写属性测试
    - **属性 9：角色切换确认保护**
    - **验证：需求 6.3、6.4**

  - [ ]* 1.9 为 `persistWorkspace` / `loadPersistedWorkspace` 编写属性测试
    - **属性 10：localStorage 工作区持久化**
    - **验证：需求 7.5**

- [x] 2. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 3. 新增 CSS 类到 `styles.css`
  - 在 `apps/agent-console/src/styles.css` 末尾追加以下样式块：
    - `.workspace-tab-badge`：标签页角色徽标容器（flex 行内布局）
    - `.role-badge`：角色徽标基础样式（小圆角标签，`font-size: 11px`，`padding: 3px 8px`）
    - `.role-badge-gateway`：蓝色系（`background: var(--blue-soft); color: var(--blue)`）
    - `.role-badge-worker`：绿色系（`background: var(--green-soft); color: var(--green)`）
    - `.role-badge-console`：琥珀色系（`background: var(--amber-soft); color: var(--amber)`）
    - `.worker-wizard`：节点配置向导外层容器，绿色渐变背景（`rgba(239,249,244,0.96)` → `rgba(250,255,252,0.92)`），`border-radius: 24px`，`padding: 20px`，`border: 1px solid rgba(31,138,100,0.18)`
    - `.worker-wizard-identity`：IP/端口身份展示区，突出背景（`rgba(31,138,100,0.06)`），`border-radius: 16px`，`padding: 16px`
    - `.worker-wizard-identity-ip`：IP 地址大字，`font-size: 22px`，`font-weight: 800`，`color: var(--green)`，`font-family: "IBM Plex Mono"`
    - `.worker-token-readonly`：只读 token 区域，`background: rgba(37,30,24,0.05)`，`border-radius: 12px`，`padding: 12px 14px`，`color: var(--muted)`
    - `.worker-model-collapse`：模型折叠区，`border: 1px solid var(--line)`，`border-radius: 16px`，`overflow: hidden`
    - `.worker-model-collapse-header`：折叠区标题行，`padding: 12px 14px`，`cursor: pointer`，`display: flex`，`justify-content: space-between`
    - `.worker-model-collapse-body`：折叠区内容，`padding: 14px`，`border-top: 1px solid var(--line)`
    - `.console-gateway-banner`：console_only sessions 顶部网关状态 banner，`padding: 12px 16px`，`border-radius: 16px`，`background: var(--green-soft)`，`color: var(--green)`，`display: flex`，`align-items: center`，`gap: 12px`
    - `.console-gateway-banner-error`：不可达变体，`background: rgba(183,106,26,0.1)`，`color: var(--amber)`
  - _需求：5.1–5.3、8.1、4.2、4.5_

- [x] 4. 在 `App.tsx` 中引入纯函数并实现角色感知路由
  - 在 `App.tsx` 顶部 import `roleWorkspace.ts` 中的所有导出
  - 新增 state：`workerModelExpanded: boolean`（默认 `false`）
  - 初始化时：在 `setupProfile` 加载完成的 useEffect 中，调用 `resolveInitialWorkspace(profile)` 设置 `workspace`，并调用 `persistWorkspace` 持久化
  - 任务完成时：在监听 `setupTask.status === "succeeded"` 的 useEffect 中，调用 `resolveWorkspaceOnTaskComplete("succeeded", effectiveRole, workspace)` 并 `setWorkspace`，同时 `persistWorkspace`
  - 角色切换保护：在 `setSetupRole` 调用前，调用 `requiresRoleSwitchConfirmation(completedRoles, newRole)`，若需要确认则先展示确认提示（复用现有 `reconfigureConfirmOpen` 状态）
  - 在"重新选择角色"按钮的 onClick 中，调用 `persistWorkspace("quick_setup")` 并清除 localStorage draft
  - _需求：1.1–1.6、6.1–6.5、7.1–7.5_

- [x] 5. 实现工作区标签页角色徽标
  - 在 `App.tsx` 渲染层，找到 `.workspace-tabs` 的 JSX
  - 调用 `resolveRoleBadge(effectiveRole)` 得到 `badge`
  - 对 `connection` 和 `sessions` 两个标签页按钮，若 `badge?.tab === tab`，则在按钮内容后追加：
    ```tsx
    <span className={`role-badge role-badge-${badge.variant}`}>{badge.label}</span>
    ```
  - 用 `.workspace-tab-badge` 包裹按钮文字和徽标（`display: inline-flex; align-items: center; gap: 6px`）
  - _需求：5.1、5.2、5.3、5.4_

- [x] 6. 实现节点配置向导的视觉区分（worker_node 配置表单）
  - 在 `App.tsx` 中找到 `setupRole === "worker_node"` 且 `setupMode === "config"` 的 JSX 分支
  - 将外层容器替换为 `.worker-wizard`
  - 在表单顶部插入 `.worker-wizard-identity` 区域：
    - 展示 `systemStatus?.preferred_lan_ip ?? "检测中…"` 和 `workerSetup.discovery_port`
    - IP 用 `.worker-wizard-identity-ip` 大字展示
    - 附带说明文案："这是本机节点的地址，网关管理员需要用这个地址来发现和配对你的节点"
  - 将 `node_token` 字段替换为 `.worker-token-readonly` 只读展示区：
    - 调用 `resolveTokenDisplayState(workerSetup.node_token)` 决定显示文案
    - `status === "waiting"` → 显示"空（等待网关配对后自动下发）"
    - `status === "paired"` → 显示"已配对"
    - 附带说明文案："Token 无需手动填写，完成配对后网关会自动将 Token 写入本机配置"
  - 将模型配置字段（`dify_base_url`、`dify_api_key` 等）包裹在 `.worker-model-collapse` 中：
    - 标题行 `.worker-model-collapse-header` 点击切换 `workerModelExpanded`
    - 折叠时显示说明文案："模型配置可选，不填写时使用网关内置模型（{`gatewaySetup.builtin_model_name || DEFAULT_BUILTIN_MODEL_LABEL`}）"
    - 展开时显示 `.worker-model-collapse-body` 内的模型配置字段
  - 在"目标网关地址"输入框旁保留"检测连接"按钮，复用现有 `probeWorkerGateway` 逻辑
  - 在提交前调用 `validateWorkerGatewayUrl(workerSetup.gateway_base_url)`，若返回 `false` 则阻止提交并高亮该字段
  - _需求：8.1–8.9_

- [x] 7. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 8. 实现 worker_node 工作区：IP/端口展示与 token 状态
  - 在 `App.tsx` 的 `workspace === "connection"` 且 `effectiveRole === "worker_node"` 分支
  - 在工作区顶部（现有节点状态卡片之前）插入一个 `.worker-wizard-identity` 区域：
    - 展示 `localNodeStatus` 中的 `lan_ip` 或 `systemStatus?.preferred_lan_ip`
    - 展示 `workerSetup.discovery_port`
    - 附带说明文案："本机节点地址，网关管理员可用此地址配对"
  - 在节点状态区域展示 token 状态：调用 `resolveTokenDisplayState(workerSetup.node_token)`
    - `status === "waiting"` → 显示"等待网关下发 token"（`.status-chip-warn`）
    - `status === "paired"` → 显示"已配对"（`.status-chip-good`）
  - _需求：3.6、3.7_

- [x] 9. 实现 console_only 角色在 sessions 工作区的网关状态 banner
  - 在 `App.tsx` 的 `workspace === "sessions"` 分支顶部，当 `effectiveRole === "console_only"` 时插入 banner：
    - 若 `systemStatus` 不为 null：渲染 `.console-gateway-banner`，展示网关地址（`resolvePreferredGatewayBaseUrl`）、Redis 状态（`systemStatus.redis_ok`）、在线节点数（`systemStatus.active_nodes`）
    - 若 `systemStatus` 为 null 且 `sessionsLoaded` 为 true：渲染 `.console-gateway-banner-error`，展示"目标网关不可达"提示，并提供"前往快速配置"按钮（`onClick: () => setWorkspace("quick_setup")`）
  - _需求：4.2、4.5_

- [x] 10. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

---

## 备注

- 标有 `*` 的子任务为可选项，可跳过以加快 MVP 交付
- 每个任务均引用了具体需求条款以保证可追溯性
- 属性测试文件位置：`apps/agent-console/src/__tests__/role-based-workspace.pbt.test.ts`
- 单元测试文件位置：`apps/agent-console/src/__tests__/role-based-workspace.unit.test.ts`
- 属性测试使用 fast-check，每个属性最少运行 100 次
- 实现时不重写现有逻辑，仅在现有分支基础上补充缺失部分
