# 需求文档

## 简介

本功能在现有快速配置（quick_setup）角色选择的基础上，为每种角色提供专属的管理工作区。用户完成角色配置后，系统将自动导航至与该角色职责最匹配的管理界面，而非统一跳转到通用的"接入中心"或"会话观察台"。

现有系统中已有三个工作区标签页：快速配置（quick_setup）、会话观察台（sessions）、接入中心（connection）。本功能在此基础上引入"角色工作区"概念——配置完成后，系统根据角色自动选中最合适的工作区，并在对应工作区内突出展示该角色最相关的状态和操作入口。

**关键设计原则：**
- 工作节点（worker_node）的配置向导在视觉和布局上与网关/控制台配置有明显区别，突出"我是一台等待被网关发现和配对的节点"的语义
- 节点配置时 token 字段为只读，始终保持为空，由网关配对后自动下发，用户无需也不应手动填写
- 模型配置对节点端为可选项，不填写时使用网关内置模型，降低节点配置门槛
- 节点配置向导需显著展示本机 IP 和端口，方便用户告知网关管理员
- 所有角色共用同一套前后端启动命令（`uv run python -m launcher.main`），角色差异体现在 UI 层而非部署层

## 词汇表

- **Console**：控制台前端应用（agent-console），即本文档所描述的 UI 系统
- **Gateway**：网关服务（apps/gateway），负责消息路由、节点调度、会话管理
- **Worker_Node**：工作节点，运行 AI 推理任务的计算单元，通过配对注册到 Gateway
- **SetupRole**：角色类型，取值为 `gateway_host`、`gateway_host_console`、`worker_node`、`console_only`
- **WorkspaceTab**：工作区标签页，当前取值为 `quick_setup`、`sessions`、`connection`
- **RoleWorkspace**：角色工作区，指配置完成后为特定角色定制展示内容的工作区视图
- **EffectiveRole**：有效角色，由当前选中角色或已完成角色推导得出的实际角色
- **SetupProfile**：配置档案，后端返回的包含已完成角色、推荐工作区等信息的响应对象
- **NodeInventory**：节点清单，已配对节点的注册和在线状态汇总

---

## 需求

### 需求 1：配置完成后自动导航至角色对应工作区

**用户故事：** 作为已完成角色配置的用户，我希望系统在配置成功后自动切换到与我角色最相关的工作区，这样我不需要手动寻找应该去哪里管理。

#### 验收标准

1. WHEN 角色为 `gateway_host` 的配置任务成功完成，THE Console SHALL 自动将活动工作区切换至 `connection`（接入中心）。
2. WHEN 角色为 `gateway_host_console` 的配置任务成功完成，THE Console SHALL 自动将活动工作区切换至 `connection`（接入中心）。
3. WHEN 角色为 `worker_node` 的配置任务成功完成，THE Console SHALL 自动将活动工作区切换至 `connection`（接入中心）并滚动定位至本机节点状态区域。
4. WHEN 角色为 `console_only` 的配置任务成功完成，THE Console SHALL 自动将活动工作区切换至 `sessions`（会话观察台）。
5. WHEN Console 初始化加载时 SetupProfile 的 `recommended_workspace` 为 `connection` 或 `sessions`，THE Console SHALL 将初始活动工作区设置为 `recommended_workspace` 指定的值。
6. IF 配置任务以失败状态结束，THEN THE Console SHALL 保持当前工作区不变，并在快速配置区域展示失败详情。

---

### 需求 2：网关主机角色的专属工作区视图（gateway_host / gateway_host_console）

**用户故事：** 作为网关主机角色的用户，我希望接入中心工作区能优先展示网关运行状态、节点接入情况和微信连接状态，这样我能一眼掌握整个系统的健康状况。

#### 验收标准

1. WHILE EffectiveRole 为 `gateway_host` 或 `gateway_host_console`，THE Console SHALL 在接入中心工作区顶部展示网关运行状态摘要，包含 Redis 连接状态、在线节点数量、分发模式开关状态。
2. WHILE EffectiveRole 为 `gateway_host` 或 `gateway_host_console`，THE Console SHALL 在接入中心工作区展示微信连接状态，包含当前连接状态（轮询中/已保存未连接/未连接）和接收/发送消息计数。
3. WHILE EffectiveRole 为 `gateway_host` 或 `gateway_host_console`，THE Console SHALL 在接入中心工作区展示 NodeInventory 中所有已配对节点的在线状态列表。
4. WHEN 用户在接入中心工作区点击某个节点卡片，THE Console SHALL 展开该节点的详细诊断信息，包含连接状态、最近心跳时间和最近错误。
5. WHERE EffectiveRole 为 `gateway_host_console`，THE Console SHALL 在接入中心工作区额外展示"前往会话观察台"的快捷入口。

---

### 需求 3：工作节点角色的专属工作区视图（worker_node）

**用户故事：** 作为工作节点角色的用户，我希望接入中心工作区能优先展示本机节点的注册状态和与目标网关的连接情况，这样我能快速判断节点是否正常工作。

#### 验收标准

1. WHILE EffectiveRole 为 `worker_node`，THE Console SHALL 在接入中心工作区顶部展示本机节点（local node）的运行状态，包含服务状态（running/stopped）、注册状态（connected/register_failed/waiting_pair）和最近注册时间。
2. WHILE EffectiveRole 为 `worker_node`，THE Console SHALL 在接入中心工作区展示目标网关的连接状态，包含网关地址和最近一次探测结果。
3. WHEN 本机节点的 `runtime_state` 为 `register_failed`，THE Console SHALL 在工作区内展示注册失败原因和"重置凭据"操作按钮。
4. WHEN 本机节点的 `runtime_state` 为 `needs_repair`，THE Console SHALL 在工作区内展示修复提示，引导用户前往快速配置补全模型配置。
5. THE Console SHALL 在工作节点工作区展示本机节点处理的最近消息列表（node messages），每条消息显示会话 ID、用户 ID、角色和内容摘要。
6. WHILE EffectiveRole 为 `worker_node`，THE Console SHALL 在工作区顶部显著展示本机的局域网 IP 地址和节点服务端口，方便用户告知网关管理员进行配对。
7. WHILE EffectiveRole 为 `worker_node`，THE Console SHALL 展示节点当前的 token 状态：若 `CLAW_NODE_TOKEN` 为空则显示"等待网关下发 token"，若非空则显示"已配对"（不显示 token 明文）。

---

### 需求 8：工作节点角色的配置向导

**用户故事：** 作为首次配置工作节点的用户，我希望有清晰的步骤引导，让我知道需要填写哪些信息、每一步的目的是什么，以及配置是否成功。

#### 验收标准

1. WHEN 用户选择 `worker_node` 角色进入配置步骤，THE Console SHALL 展示专属的节点配置向导，视觉风格和布局与网关/控制台配置表单有明显区别（如使用不同的配色主题或布局结构）。
2. THE 节点配置向导 SHALL 在表单顶部显示本机当前的局域网 IP 地址和发现响应端口（`discovery_port`），并附带说明文案："这是本机节点的地址，网关管理员需要用这个地址来发现和配对你的节点"。
3. THE 节点配置向导 SHALL 包含"目标网关地址"输入框，并在输入框下方提供"检测连接"按钮，点击后实时探测该网关是否可达。
4. WHEN 用户点击"检测连接"，THE Console SHALL 调用网关探测接口（`POST /api/setup/gateway/probe`），并在输入框旁显示探测结果：可达（绿色"✓ 网关可达"）或不可达（红色"✗ 无法连接，请检查地址和网络"）。
5. THE 节点配置向导 SHALL 包含"配对密钥"输入框（密码类型，可切换显示），并附带说明文案："配对密钥由你自己设定，网关管理员在配对时需要输入相同的密钥"。
6. THE 节点配置向导 SHALL 包含"节点 Token"状态展示区域（只读），初始显示"空（等待网关配对后自动下发）"，并附带说明文案："Token 无需手动填写，完成配对后网关会自动将 Token 写入本机配置"。
7. THE 节点配置向导 SHALL 包含可选的"模型配置"折叠区域，默认折叠，展开后允许配置 OpenAI 兼容接口或 Dify；折叠时显示说明文案："模型配置可选，不填写时使用网关内置模型（{builtin_model_name}）"。
8. WHEN 用户提交节点配置，THE Console SHALL 验证"目标网关地址"非空，IF 为空，THEN THE Console SHALL 阻止提交并高亮提示该字段必填。
9. WHEN 节点配置任务成功完成，THE Console SHALL 展示成功提示："节点已配置完成，等待网关管理员完成配对后即可开始处理任务"，并自动跳转至节点工作区视图。

---

### 需求 4：仅控制台角色的专属工作区视图（console_only）

**用户故事：** 作为仅控制台角色的用户，我希望会话观察台工作区能作为主要工作界面，并在顶部展示目标网关的连接健康状态，这样我能专注于监控和干预会话。

#### 验收标准

1. WHILE EffectiveRole 为 `console_only`，THE Console SHALL 将 `sessions`（会话观察台）设为默认激活工作区。
2. WHILE EffectiveRole 为 `console_only`，THE Console SHALL 在会话观察台顶部展示目标网关的连接状态，包含网关地址、Redis 状态和在线节点数。
3. WHILE EffectiveRole 为 `console_only`，THE Console SHALL 在会话观察台展示会话列表，支持按状态筛选（全部/处理中/人工中/最近活跃）。
4. WHEN 用户在会话列表中选中某个会话，THE Console SHALL 在右侧展示该会话的完整消息记录和当前状态。
5. IF 目标网关不可达，THEN THE Console SHALL 在会话观察台顶部展示连接失败提示，并提供"前往快速配置"的跳转入口。

---

### 需求 5：工作区标签页的角色感知显示

**用户故事：** 作为已配置角色的用户，我希望顶部标签页能反映我的角色，让我清楚知道哪个工作区是我的主要工作区。

#### 验收标准

1. WHILE EffectiveRole 为 `gateway_host` 或 `gateway_host_console`，THE Console SHALL 在 `connection` 标签页旁显示角色标识（如"主网关"角色徽标）。
2. WHILE EffectiveRole 为 `worker_node`，THE Console SHALL 在 `connection` 标签页旁显示角色标识（如"工作节点"角色徽标）。
3. WHILE EffectiveRole 为 `console_only`，THE Console SHALL 在 `sessions` 标签页旁显示角色标识（如"控制台"角色徽标）。
4. THE Console SHALL 始终允许用户手动点击任意工作区标签页进行切换，角色感知显示不限制用户的导航自由。

---

### 需求 6：角色切换与重新配置

**用户故事：** 作为需要变更角色的用户，我希望能从任意工作区回到角色选择界面重新配置，这样我可以在不同角色之间切换而不需要重启应用。

#### 验收标准

1. THE Console SHALL 在快速配置工作区提供"重新选择角色"入口，允许用户返回角色选择步骤。
2. WHEN 用户确认重新选择角色，THE Console SHALL 清除当前角色的本地草稿（localStorage），并将 SetupMode 重置为 `role` 选择步骤。
3. WHEN 用户在角色选择界面选择与当前已完成角色不同的新角色，THE Console SHALL 展示角色切换确认提示，说明切换后当前配置将被覆盖。
4. IF 用户取消角色切换确认，THEN THE Console SHALL 保持当前角色和配置不变。
5. WHEN 新角色配置完成后，THE Console SHALL 按需求 1 的规则自动导航至新角色对应的工作区。

---

### 需求 7：SetupProfile 推荐工作区与角色工作区的协调

**用户故事：** 作为系统，我需要确保后端返回的推荐工作区与前端角色工作区逻辑保持一致，避免用户看到矛盾的导航提示。

#### 验收标准

1. THE Console SHALL 在初始化时优先使用 SetupProfile 的 `recommended_workspace` 字段决定初始工作区，而非硬编码默认值。
2. WHEN SetupProfile 的 `completed_roles` 包含 `console_only` 且不包含任何网关或工作节点角色，THE Console SHALL 将初始工作区设为 `sessions`。
3. WHEN SetupProfile 的 `completed_roles` 包含 `gateway_host`、`gateway_host_console` 或 `worker_node` 中的任意一个，THE Console SHALL 将初始工作区设为 `connection`。
4. WHEN SetupProfile 的 `setup_completed` 为 `false`，THE Console SHALL 将初始工作区设为 `quick_setup`，并展示首次配置引导提示。
5. THE Console SHALL 在 SetupProfile 加载完成后，将 `recommended_workspace` 的决策结果持久化到 localStorage，以便在页面刷新后保持工作区状态。
