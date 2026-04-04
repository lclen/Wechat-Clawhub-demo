# 需求文档

## 简介

本功能完善 **claw-node 工作节点** 与 **gateway 网关** 之间的连接与任务分发机制。
系统已具备基础的 heartbeat / pull-task / task-result 交互流程，以及 DispatchQueue + DispatchScheduler 的多节点负载均衡框架。
本次需求聚焦于以下几个方向：

1. **节点配对与注册**：节点通过局域网发现或手动配置完成与网关的配对，并在启动时自动注册。
2. **心跳与在线状态管理**：节点持续上报心跳，网关据此维护节点在线状态，并在节点失联时自动标记离线。
3. **任务拉取与执行**：节点以轮询方式从网关拉取任务，并发执行，完成后提交结果或失败报告。
4. **分发调度策略**：网关根据节点负载、通道占用、会话亲和性等因素选择最优节点，支持自动重试与节点切换。
5. **连接健壮性**：处理节点重启、网络中断、任务超时等异常场景，保证系统可恢复。

---

## 词汇表

- **Gateway**：中央网关服务，负责接收外部消息、管理会话、维护节点注册表、分发任务。
- **Node**（claw-node）：工作节点，运行在用户本地机器（Windows 服务），负责调用推理后端并返回结果。
- **Local_Node**：与 Gateway 同机部署的内置节点（node_id = `local-node`），在非 dispatch 模式下直接处理请求。
- **Node_Registry**：Gateway 内部维护的节点注册表，以 Redis 为存储后端。
- **Heartbeat**：节点定期向 Gateway 发送的存活信号，携带当前负载信息。
- **Slot**：Gateway 为每个会话在某节点上分配的逻辑通道占位，用于限制单节点并发会话数。
- **DispatchQueue**：Gateway 内的任务队列，负责将任务入队、分配给节点、处理结果与失败。
- **DispatchScheduler**：Gateway 内的调度器，根据节点状态和负载选择最优节点。
- **Discovery_Service**：节点端的局域网发现服务，通过 UDP 广播响应发现请求，并通过 HTTP 接受配对请求。
- **GatewayClient**：节点端封装的网关 HTTP 客户端，负责 register / heartbeat / pull-task / task-result 等调用。
- **Worker**：节点端的主控协程，协调心跳循环、任务拉取循环和任务执行。
- **Pairing**：将节点与网关绑定的一次性操作，完成后节点获得 node_token 和 gateway_base_url。
- **Node_Token**：节点向网关发起请求时使用的鉴权令牌（`X-Node-Token` 请求头）。
- **Inflight_Task**：已被节点拉取、正在执行中的任务，在 Redis 中有对应的 inflight 键。
- **Context_Version**：会话消息的版本号，用于防止乱序提交。
- **Load_Ratio**：节点当前负载与最大并发数之比（`current_load / max_concurrency`）。
- **Channel_Capacity**：节点支持的最大并发会话通道数（`CLAW_CHANNEL_CAPACITY`）。

---

## 需求

### 需求 1：节点局域网发现与配对

**用户故事：** 作为管理员，我希望通过局域网自动发现未配对的节点并完成配对，以便无需手动填写节点地址和令牌。

#### 验收标准

1. WHEN Gateway 发起 UDP 广播发现请求（`type: discover`），THE Discovery_Service SHALL 在同一局域网内响应，返回节点的 `node_id`、`hostname`、`lan_ip`、`platform`、`node_version`、`pairing_port` 及 `already_paired` 字段。
2. WHEN Gateway 向节点的 `pairing_port` 发送配对请求（POST `/pair`），THE Discovery_Service SHALL 验证 `pairing_key`，验证通过后将 `gateway_base_url`、`node_token`、`node_id` 持久化到节点的 `.env` 文件，并返回 `pairing_status: paired`。
3. IF 配对请求中的 `pairing_key` 与节点配置不匹配，THEN THE Discovery_Service SHALL 返回 HTTP 401 及 `pairing_status: auth_failed`。
4. IF 节点已完成配对（`node_token` 非空），THEN THE Discovery_Service SHALL 在发现响应中将 `already_paired` 设为 `true`，并在收到重复配对请求时返回 `pairing_status: already_paired`。
5. WHEN 配对成功完成，THE Worker SHALL 立即启动心跳循环和任务拉取循环，无需重启节点进程。
6. WHERE `CLAW_DISCOVERY_ENABLED` 为 `false`，THE Discovery_Service SHALL 不启动 UDP 监听和配对 HTTP 服务。
7. WHEN 节点启动时 `CLAW_NODE_TOKEN` 为空，THE Worker SHALL 仅启动 Discovery_Service，不发起任何需要鉴权的请求，等待网关下发 token。
8. IF 节点 `.env` 写入失败，THEN THE Discovery_Service SHALL 在配对响应中返回 `pairing_status: register_failed` 及具体错误信息，网关收到后回滚已写入的 token。
9. WHEN 管理员触发配对操作，THE 管理控制台 SHALL 显示配对进度弹窗，实时展示配对状态（连接中 / 成功 / 失败），失败时显示具体原因（密钥错误 / 节点写入失败 / 超时等）。

---

### 需求 2：节点注册

**用户故事：** 作为工作节点，我希望在启动时向网关注册自身信息，以便网关能够将任务分发给我。

#### 验收标准

1. WHEN Worker 启动且 `node_token`、`gateway_base_url`、`node_id` 均已配置，THE GatewayClient SHALL 向 Gateway 发送注册请求（POST `/api/nodes/register`），携带 `node_id`、`base_url`、`advertised_address`、`lan_ip`、`max_concurrency`、`channel_capacity`、`capabilities`、`platform`、`hostname`、`node_version`。
2. WHEN Gateway 收到注册请求，THE Node_Registry SHALL 在 Redis 中创建或更新节点元数据，并将节点加入活跃节点集合（`wch:nodes:active`）。
3. WHEN Gateway 收到注册请求，THE Gateway SHALL 验证请求头中的 `X-Node-Token`，IF 令牌无效，THEN THE Gateway SHALL 返回 HTTP 401。
4. IF 注册请求中的 `node_id` 已存在于 Node_Registry，THEN THE Node_Registry SHALL 覆盖更新该节点的元数据，而非拒绝请求。
5. WHEN 注册成功，THE Node_Registry SHALL 将节点元数据的 TTL 设置为 `node_heartbeat_ttl_seconds * 2` 秒。

---

### 需求 3：心跳与在线状态维护

**用户故事：** 作为工作节点，我希望定期向网关上报心跳，以便网关能够实时感知我的在线状态和当前负载。

#### 验收标准

1. WHILE Worker 运行且已完成配对，THE Worker SHALL 每隔 `heartbeat_interval_seconds` 秒向 Gateway 发送一次心跳请求（POST `/api/nodes/{node_id}/heartbeat`），携带 `current_load`、`status`、`last_error`。
2. WHEN Gateway 收到心跳请求，THE Node_Registry SHALL 更新节点的 `current_load`、`status`、`last_heartbeat_at`，并刷新 Redis TTL。
3. WHEN 节点的 `current_load` 大于等于 `max_concurrency`，THE Node_Registry SHALL 将节点状态设置为 `busy`，无论心跳请求中上报的状态为何值。
4. IF 节点的 `last_heartbeat_at` 距当前时间超过 `node_heartbeat_ttl_seconds * 2` 秒，THEN THE Node_Registry SHALL 在返回节点记录时将节点状态标记为 `offline`。
5. IF 心跳请求返回 HTTP 404，THEN THE Worker SHALL 自动重新执行注册流程，并在注册成功后继续心跳循环。
6. IF 心跳请求因网络错误失败，THEN THE Worker SHALL 记录错误到 `last_error`，并在下一个心跳周期重试，不中断任务拉取循环。

---

### 需求 4：任务拉取

**用户故事：** 作为工作节点，我希望主动从网关拉取待处理任务，以便在本地执行推理并返回结果。

#### 验收标准

1. WHILE Worker 运行且已完成配对，THE Worker SHALL 每隔 `pull_interval_ms` 毫秒向 Gateway 发送拉取请求（POST `/api/nodes/{node_id}/pull-task`）。
2. WHEN Gateway 收到拉取请求，THE DispatchQueue SHALL 从该节点的 Redis 队列（`wch:dispatch:node:{node_id}`）中取出一个任务，并将其标记为 inflight（设置 `wch:dispatch:inflight:{task_id}` 键，TTL 为 `dispatch_inflight_ttl_seconds`）。
3. IF 节点队列为空，THEN THE DispatchQueue SHALL 返回 `{"ok": true, "task": null}`，节点等待下一个轮询周期。
4. WHILE Worker 的并发信号量已满（`current_load >= max_concurrency`），THE Worker SHALL 跳过本次拉取，等待下一个轮询周期。
5. WHEN Worker 成功拉取到任务，THE Worker SHALL 使用 `asyncio.Semaphore` 控制并发，在信号量允许范围内启动异步任务执行协程。
6. THE Worker SHALL 支持同时执行最多 `max_concurrency` 个任务，超出部分在队列中等待。

---

### 需求 5：任务执行与结果提交

**用户故事：** 作为工作节点，我希望执行拉取到的推理任务并将结果提交给网关，以便网关将回复发送给用户。

#### 验收标准

1. WHEN Worker 执行任务，THE Worker SHALL 调用推理后端（DifyClient 或 OpenAICompatibleClient），传入 `session_id`、`user_id`、`agent_id`、`query`、`context_summary`、`recent_messages`。
2. WHEN 推理完成，THE GatewayClient SHALL 向 Gateway 提交结果（POST `/api/nodes/{node_id}/task-result`），携带 `task_id`、`session_id`、`node_id`、`context_version`、`content`、`metadata`。
3. WHEN Gateway 收到任务结果，THE DispatchQueue SHALL 验证 `context_version` 与任务记录一致，IF 不一致，THEN THE DispatchQueue SHALL 拒绝提交并返回错误。
4. WHEN Gateway 收到任务结果，THE DispatchQueue SHALL 将 bot 回复追加到会话消息记录，并通过 OutgoingDispatcher 将回复发送给用户。
5. IF 任务执行过程中发生异常，THEN THE GatewayClient SHALL 向 Gateway 提交失败报告（POST `/api/nodes/{node_id}/task-failure`），携带 `error_code`、`error_message`、`retryable`。
6. WHEN Gateway 收到失败报告且 `retry_count` 为 0，THE DispatchQueue SHALL 尝试将任务重新分配给另一个可用节点（排除当前失败节点）并重新入队。
7. IF 任务已重试过一次（`retry_count >= 1`），THEN THE DispatchQueue SHALL 放弃重试，释放 slot，不再重新入队。

---

### 需求 6：分发调度策略

**用户故事：** 作为系统，我希望将任务分发给最合适的节点，以便实现负载均衡并保证会话连续性。

#### 验收标准

1. WHEN DispatchQueue 为会话分配节点，THE DispatchScheduler SHALL 优先选择该会话上次使用的节点（会话亲和性），IF 该节点仍然可用且未满载。
2. WHEN DispatchScheduler 对候选节点排序，THE DispatchScheduler SHALL 按以下优先级排列：已亲和节点（可用时）> `healthy` 状态节点 > `degraded` 状态节点 > 其他非 `offline` 节点（队列等待）。
3. WHEN DispatchScheduler 在同状态节点中排序，THE DispatchScheduler SHALL 按 `channel_in_use / channel_capacity` 升序、`load_ratio` 升序、`node_id` 字典序排列。
4. WHEN DispatchQueue 为会话分配 slot，THE DispatchQueue SHALL 在目标节点的 `wch:node:{node_id}:slots` 哈希中占用一个编号为 `slot-{N:02d}` 的槽位，N 从 1 开始取最小可用值。
5. IF 节点的 `channel_in_use >= channel_capacity`，THEN THE DispatchScheduler SHALL 不将该节点列为可立即分配的候选节点。
6. WHERE `dispatch_mode_enabled` 为 `true`，THE DispatchScheduler SHALL 从候选节点列表中排除 `local_node_id` 对应的本机节点。
7. WHEN 会话的 slot 空闲超过 `session_slot_idle_timeout_seconds` 秒，THE DispatchQueue SHALL 自动释放该 slot，并在下次任务到来时重新分配。

---

### 需求 7：任务超时与 Inflight 恢复

**用户故事：** 作为系统，我希望能够检测并恢复超时或丢失的 inflight 任务，以便避免会话永久卡死。

#### 验收标准

1. WHEN DispatchQueue 为会话入队新任务时，THE DispatchQueue SHALL 检查该会话是否存在 `active_task_id`，IF 存在且对应任务的 inflight 键已过期且任务年龄超过 `dispatch_task_timeout_seconds`，THEN THE DispatchQueue SHALL 清理该僵尸任务并释放 slot，再继续入队新任务。
2. WHEN DispatchQueue 检测到 `active_task_id` 对应的任务记录在 Redis 中不存在，THE DispatchQueue SHALL 清除会话的 dispatch 状态（`active_task_id`、`queue_status`），允许新任务入队。
3. THE DispatchQueue SHALL 在 Redis 中为每个 inflight 任务设置 TTL 为 `dispatch_inflight_ttl_seconds` 秒的过期键，以便在节点崩溃时自动清理 inflight 标记。
4. IF 会话存在未完成的 `active_task_id` 且任务仍在 inflight TTL 内，THEN THE DispatchQueue SHALL 拒绝为该会话入队新任务，并记录 `dispatch_skipped_active_task` 事件。

---

### 需求 8：节点鉴权

**用户故事：** 作为系统，我希望对节点的所有 API 请求进行鉴权，以便防止未授权节点访问网关，并在鉴权失败时提供足够的诊断信息快速定位问题。

#### 验收标准

1. THE Gateway SHALL 要求所有节点 API 请求（register、heartbeat、pull-task、task-result、task-failure）在请求头中携带 `X-Node-Token`（或 `Authorization: Bearer <token>`）。
2. WHEN Gateway 收到节点 API 请求，THE NodeAuthService SHALL 验证提供的 token 与 `node_tokens[node_id]` 完全一致（区分大小写，不做 trim），IF 不一致，THEN THE Gateway SHALL 返回 HTTP 401。
3. IF `node_id` 不在 `node_tokens` 配置中，THEN THE Gateway SHALL 返回 HTTP 401，错误详情区分"token 未配置"与"token 不匹配"两种情况，并分别记录到诊断事件。
4. WHEN 鉴权失败，THE Gateway SHALL 在诊断记录中同时保存：失败时间、客户端 IP、请求路径、期望 token 掩码（前 8 位 + 后 4 位）、实际提供 token 掩码，以便管理员判断是"token 为空"、"token 截断"还是"token 完全错误"。
5. WHEN Local_Node（`node_id == local_node_id`）从本机 IP 发起请求，THE NodeAuthService SHALL 跳过 token 验证（local direct auth bypass），无需在 `node_tokens` 中配置该节点的 token。
6. THE `_known_local_hosts()` 缓存 SHALL 在网关进程启动时计算一次，IF 需要在运行时刷新（如网络接口变化），THEN 管理员可通过重启网关进程触发重新计算；系统文档 SHALL 明确说明此限制。
7. WHEN 配对操作生成新 token，THE Gateway SHALL 原子性地将新 token 写入 `WCH_NODE_TOKENS`（持久化到 `.env`）并在同一响应中将 token 下发给节点，确保两端 token 始终一致。
8. IF 节点收到 HTTP 401 响应，THEN THE Worker SHALL 停止心跳和任务拉取循环，将节点状态标记为 `auth_failed`，并记录诊断日志，不自动重试（避免因 token 错误导致大量无效请求）。
9. WHEN 节点 token 被重置（通过管理接口或重新配对），THE Gateway SHALL 同时清除该节点在 Redis 中的活跃注册记录，强制节点重新注册以验证新 token。

---

### 需求 11：Token 生命周期管理

**用户故事：** 作为管理员，我希望能够清晰地管理节点 token 的生成、分发、重置和失效，以便在 token 不一致时能快速恢复连接。

#### 验收标准

1. WHEN 配对成功，THE Gateway SHALL 生成格式为 `node-{uuid4().hex}` 的 token，同时写入网关 `WCH_NODE_TOKENS` 和配对响应体，节点端在收到响应后立即写入 `CLAW_NODE_TOKEN`，两端写入必须在同一配对事务内完成。
2. WHEN 节点端 `CLAW_NODE_TOKEN` 为空字符串或缺失，THE Worker SHALL 在启动日志中明确输出"节点未配对，等待配对"，不发起任何需要鉴权的请求。
3. WHEN 管理员触发"重置节点凭据"操作，THE Gateway SHALL 从 `WCH_NODE_TOKENS` 中删除该节点的 token，并清除 Redis 中该节点的注册记录；节点端在下次心跳收到 401 后进入 `auth_failed` 状态，等待重新配对。
4. THE Gateway SHALL 提供诊断接口（GET `/api/nodes/{node_id}/diagnostics`），在响应中包含 `expected_token_masked`（网关侧期望 token 的掩码）和 `provided_token_masked`（节点最近一次请求提供的 token 掩码），供管理员对比排查不一致问题。
5. IF 节点重装（重新运行安装脚本），THE 安装脚本 SHALL 生成新的 `CLAW_PAIRING_KEY` 并清空 `CLAW_NODE_TOKEN`，强制重新配对，避免使用已失效的旧 token。
6. WHEN 节点处于 `auth_failed` 状态，THE 管理控制台 SHALL 在节点清单中显示"鉴权失败"标记，并提示管理员执行重新配对或重置凭据操作。

---

### 需求 9：节点诊断与可观测性

**用户故事：** 作为管理员，我希望能够查看每个节点的连接状态和历史事件，以便快速定位连接或分发问题。

#### 验收标准

1. THE Gateway SHALL 为每个节点维护诊断记录（`NodeDiagnosticsRecord`），包含最近一次配对、注册、心跳、鉴权失败的时间、结果和元数据。
2. WHEN 管理员请求节点诊断（GET `/api/nodes/{node_id}/diagnostics`），THE Gateway SHALL 返回该节点的完整诊断记录，包含时间线事件列表（`timeline`）。
3. THE Gateway SHALL 在节点列表响应（GET `/api/nodes`）中为每个节点返回 `connection_state`，取值为 `connected`、`pairing_pending`、`register_failed`、`auth_failed`、`paired_offline`、`online_unpaired` 之一。
4. WHEN DispatchQueue 处理任务的关键生命周期节点（入队、拉取、完成、失败、超时、slot 分配/释放），THE DispatchQueue SHALL 通过 TranscriptWriter 记录对应事件到会话 transcript。
5. WHEN Worker 拉取到任务，THE Worker SHALL 在日志中记录 `task_id`、`session_id`、`context_version`、`user_id` 及消息内容预览（最多 80 字符）。

---

### 需求 10：节点端配置持久化

**用户故事：** 作为工作节点，我希望配对信息在节点重启后仍然有效，以便无需每次重启都重新配对。

#### 验收标准

1. WHEN 配对成功，THE Worker SHALL 将 `CLAW_NODE_ID`、`CLAW_GATEWAY_BASE_URL`、`CLAW_NODE_TOKEN`、`CLAW_PAIRING_KEY`、`CLAW_DISCOVERY_ENABLED`、`CLAW_DISCOVERY_PORT`、`CLAW_PAIRING_LABEL` 写入节点工作目录下的 `.env` 文件。
2. WHEN Worker 写入 `.env` 文件，THE Worker SHALL 保留文件中已有的非配对相关配置行，仅更新或追加上述配对相关键值。
3. WHEN Worker 重启，THE Worker SHALL 从 `.env` 文件读取配对信息，IF `node_token`、`gateway_base_url`、`node_id` 均非空，THEN THE Worker SHALL 自动启动心跳循环和任务拉取循环，无需重新配对。
4. IF `.env` 文件中的 `node_token` 为空或缺失，THEN THE Worker SHALL 进入等待配对状态，仅启动 Discovery_Service，不发起注册或心跳请求。
