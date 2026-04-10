# Frontend 统一方案

## 1. 结论

当前项目可以统一前端，而且推荐继续走“**一套前端，多角色分层显示**”路线，而不是拆成网关 / 控制台 / 节点三套独立页面。

原因：

- 目前真正的前端主实现已经集中在 [`apps/agent-console`](D:/wechat-claw-hub/apps/agent-console)。
- 桌面启动器只是把同一套前端构建产物挂出来，并代理 `/api/*` 与 `/local/*`。
- 角色推导、工作区拆分、基础 UI 原子组件都已经存在，只是尚未完全收口。

## 2. 当前状态

### 2.1 已统一的部分

- 单一前端入口：`agent-console`
- 单一工作区框架：`quick_setup / sessions / connection / conversation_test / logs`
- 已有角色推导：`gateway_host / gateway_host_console / worker_node / console_only`
- 已有共享组件雏形：
  - `ConnectionUi.tsx`
  - `Sessions/sessionUi.ts`
  - 顶层 selectors / hooks / workspace 容器

### 2.2 仍然分裂的部分

- 角色差异仍散落在 `App.tsx` 与各 workspace 里
- `/api/*` 与 `/local/*` 的取数语义仍是页面自行判断
- 共享视觉组件还主要按 workspace 组织，而不是按设计系统组织
- “可见性 / 只读 / 可执行操作”没有集中定义成角色策略表

## 3. 目标结构

建议把前端收敛成四层：

1. `Shell`
- 顶栏
- 标签页
- 全局 notice
- 通用布局

2. `Role Policy`
- 决定哪些 tab 可见
- 决定哪些卡片可见
- 决定哪些按钮可操作
- 决定哪些字段只读

3. `Feature Workspace`
- `QuickSetupWorkspace`
- `ConnectionWorkspace`
- `SessionsWorkspace`
- `ConversationTestWorkspace`
- `LogsWorkspace`

4. `Data Adapter / ViewModel`
- 把 `/api/*`、`/local/*`、launcher 状态、summary 状态统一映射到前端内部模型

## 4. 推荐统一原则

### 4.1 一个前端，不做三套页面

不要把网关 / 节点 / 控制台各自再拆成独立 React 应用。

应该保留：

- 一套顶层导航
- 一套组件系统
- 一套样式体系
- 一套状态与类型定义

角色差异通过策略控制，而不是通过复制页面解决。

### 4.2 角色控制优先于页面分叉

优先把这些差异抽到统一策略层：

- 哪些 workspace 可见
- 哪些 section 可见
- 哪些按钮禁用
- 哪些操作允许执行

而不是在 JSX 中继续增加：

- `currentRoleIsWorker ? ... : ...`
- `currentRoleIsConsole ? ... : ...`
- `launcherShouldRunGateway(...) ? ... : ...`

### 4.3 低层共享优先于高层共享

先统一这些：

- StatusChip / Badge / SectionHead / Metric / EmptyState / MetaPill
- 表单区块容器
- 运行态卡片
- 日志视图容器
- 通用消息时间线容器

再统一高层页面。

## 5. 第一阶段建议

### 5.1 新增角色能力矩阵

第一步先引入：

- [`roleCapabilities.ts`](D:/wechat-claw-hub/apps/agent-console/src/roleCapabilities.ts)

它应负责：

- 角色主工作区
- 可见 workspace
- 可见 section
- 可执行 action

这一层不立刻改 UI 行为也没关系，先成为唯一事实来源。

### 5.2 用能力矩阵接管顶层 tab

优先改：

- `App.tsx` 顶部 workspace tabs

目标：

- 控制台角色默认突出 `sessions`
- 节点角色默认突出 `connection`
- 不适合当前角色的 tab 可以隐藏或降级为只读入口

### 5.3 抽共享 section 组件

建议新增：

- `components/shared/SectionHeader.tsx`
- `components/shared/EmptyState.tsx`
- `components/shared/StatusBadge.tsx`
- `components/shared/MetricGrid.tsx`
- `components/shared/SurfaceCard.tsx`

这样可以把 `Connection / Sessions / Logs / ConversationTest` 的视觉骨架统一。

## 6. 第二阶段建议

### 6.1 统一数据适配层

新增目录建议：

- `src/view-models/`
- 或 `src/adapters/`

目标：

- 把网关 summary
- launcher runtime
- local node status
- session summary

都统一成前端内部 view model。

这样 workspace 组件只消费：

- `heroCards`
- `statusCards`
- `nodePanels`
- `sessionTimeline`

而不关心底层究竟来自 `/api/*` 还是 `/local/*`。

### 6.2 收口角色判断

最终希望：

- `App.tsx` 不再直接关心复杂角色分支
- workspace 内部也不再直接判断多组角色条件
- 统一改为消费 `capabilities`

## 7. 第三阶段建议

### 7.1 统一主题与视觉基线

当前虽然已经有单应用，但各工作区视觉语言仍略分散。

建议补一层：

- 页面密度规则
- 卡片标题层级
- 说明文案层级
- 操作按钮优先级
- 状态色系统

目标是让“网关 / 控制台 / 节点”只是内容不同，而不是看起来像不同产品。

### 7.2 统一角色化文案

例如：

- `gateway_host_console`：强调接入、纳管、运行态
- `worker_node`：强调本机节点、模型配置、回连状态
- `console_only`：强调会话观察、会话切换、排障信息

文案应由角色驱动，而不是在多个组件里散写。

## 8. 验收标准

- 仍然只保留一套前端应用
- 顶层 tab 和页面 section 的可见性可由统一角色策略控制
- 新增角色或改角色权限时，不需要同时修改多个 workspace
- `/api/*` 与 `/local/*` 的差异被适配层吸收，而不是泄漏到页面组件
- 共享组件数量上升，workspace 私有样式和重复结构下降

## 9. 当前最值得先做的事情

下一步最值得做的是：

- 用 `roleCapabilities.ts` 接管 `App.tsx` 的 workspace tab 可见性和默认工作区判断

原因：

- 这是统一前端的最小切口
- 风险低
- 收益直接
- 做完后，后续 section 级统一就有稳定基础
