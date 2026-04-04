# 实现计划：node-dispatch

## 概述

系统已有完整的基础实现（心跳、拉取、调度、slot 机制等），本计划聚焦于三个尚未实现或需要改进的核心方向：

1. **节点 401 处理**：`Worker` 收到 401 后停止循环并标记 `auth_failed`，不再无限重试
2. **配对事务写入顺序**：网关先写 `.env`，节点侧失败时回滚，保证两端 token 一致
3. **前端配对弹窗**：实时展示配对进度、失败原因，支持重试

---

## Tasks

- [x] 1. 修复节点侧 401 处理逻辑
  - [x] 1.1 在 `Worker` 中添加 `_auth_failed` 标志，并在 `_heartbeat_loop` 和 `_poll_loop` 中检测 401 响应
    - 修改 `claw_node/worker.py`：`_heartbeat_loop` 捕获 `HTTPStatusError` 时，若 `status_code == 401`，设置 `self._auth_failed = True`，停止心跳循环（`return`），不再继续 `asyncio.sleep` 重试
    - 同样修改 `_poll_loop`：拉取任务收到 401 时，设置 `_auth_failed = True` 并退出循环
    - 在 `run()` 的 shutdown 日志中输出 `auth_failed` 状态，便于诊断
    - _需求：8.8_

  - [ ]* 1.2 为 401 停止行为编写属性测试
    - **属性 3：Token 验证一致性**
    - **验证：需求 8.2**

- [x] 2. 修复配对事务写入顺序与回滚机制
  - [x] 2.1 修改 `SetupService._pair_node()` 的写入顺序
    - 当前实现需确认：网关必须先将 token 写入 `WCH_NODE_TOKENS`（持久化到 `.env`），再向节点发送配对请求
    - 若节点返回 `pairing_status: auth_failed` 或 `register_failed`，网关调用 `remove_paired_node()` 回滚已写入的 token
    - 若节点 HTTP 请求超时或网络错误，同样触发回滚
    - 修改文件：`apps/gateway/app/services/setup_service.py`，在 `_pair_node()` 方法中实现上述逻辑
    - _需求：1.8, 8.7, 11.1_

  - [x] 2.2 在节点侧 `_handle_pair_request` 中处理 `.env` 写入失败
    - 修改 `claw_node/worker.py`：`_persist_runtime_pairing()` 若抛出异常，`_handle_pair_request` 应捕获并返回 `(500, {"pairing_status": "register_failed", "detail": str(exc)})`，而非让异常向上传播
    - _需求：1.8_

  - [ ]* 2.3 为配对 key 验证编写属性测试
    - **属性 9：配对 key 验证**
    - **验证：需求 1.3**

- [x] 3. 节点初始无 token 时的等待配对状态
  - [x] 3.1 确认并完善 `Worker._ensure_gateway_loops_started()` 的等待配对逻辑
    - 当前实现已有基础判断（token 为空时不启动循环），需确认启动日志输出"节点未配对，等待配对"（需求 11.2）
    - 确认 `DiscoveryService` 在无 token 时正常启动，且不发起任何需要鉴权的请求
    - 若 `CLAW_NODE_TOKEN` 为空字符串，`GatewayClient._ensure_client()` 应保持 `_client = None`（当前已实现，验证即可）
    - _需求：1.7, 10.4, 11.2_

  - [x] 3.2 确认配对成功后立即启动心跳和拉取循环
    - `_handle_pair_request` 成功写入 `.env` 后调用 `_ensure_gateway_loops_started()`（当前已实现）
    - 验证 `_ensure_gateway_loops_started()` 的幂等性：若循环已启动则不重复创建 task
    - _需求：1.5_

- [x] 4. 前端配对弹窗：实时状态与失败原因展示
  - [x] 4.1 在 `App.tsx` 中为配对操作添加进度弹窗组件
    - 触发：点击"配对"按钮后立即显示弹窗，进入 loading 状态（`running`）
    - 弹窗内部维护 `pairingModalTaskId` 状态，每 1500ms 轮询 `GET /api/setup/tasks/{task_id}`
    - 轮询超过 30 秒未完成 → 显示"配对超时，请检查节点是否在线"并停止轮询
    - _需求：1.9_

  - [x] 4.2 实现配对弹窗的状态文案映射
    - `running` → "正在连接节点..."
    - `succeeded` → "配对成功，节点已上线"，2 秒后自动关闭并刷新节点列表
    - `failed` + summary 含"密钥" → "配对失败：密钥错误，请检查配对密钥是否一致"
    - `failed` + summary 含"写入" → "配对失败：节点配置写入失败，请检查节点磁盘权限"
    - `failed` + 其他 → "配对失败：{task.summary}"
    - 失败时提供"重试"和"关闭"按钮
    - _需求：1.9_

- [x] 5. Checkpoint — 确认核心改动可运行
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 6. 节点诊断：`auth_failed` 状态在控制台的展示
  - [x] 6.1 在 `App.tsx` 节点清单中为 `connection_state == "auth_failed"` 的节点显示"鉴权失败"标记
    - 在节点列表行中，若 `inventory.connection_state === "auth_failed"`，显示红色"鉴权失败"徽标
    - 提示文案："节点 token 不匹配，请重新配对或重置凭据"
    - _需求：11.6_

  - [x] 6.2 在节点诊断面板中展示 token 掩码对比信息
    - 诊断面板已有 `expected_token_masked` / `provided_token_masked` 字段（来自 `NodeDiagnosticsRecord`）
    - 若两者均非空，在诊断详情中显示"期望 token：{expected_token_masked} / 实际提供：{provided_token_masked}"
    - _需求：8.4, 11.4_

- [ ] 7. 属性测试：覆盖调度器与注册表核心属性
  - [ ]* 7.1 为心跳超时离线判断编写属性测试
    - **属性 1：心跳超时导致节点离线**
    - **验证：需求 3.4**

  - [ ]* 7.2 为满载节点状态编写属性测试
    - **属性 2：满载节点状态为 busy**
    - **验证：需求 3.3**

  - [ ]* 7.3 为调度器满通道排除编写属性测试
    - **属性 4：调度器不选满通道节点**
    - **验证：需求 6.5**

  - [ ]* 7.4 为 dispatch 模式排除本机节点编写属性测试
    - **属性 5：调度器排除本机节点（dispatch 模式）**
    - **验证：需求 6.6**

  - [ ]* 7.5 为任务重试上限编写属性测试
    - **属性 8：任务重试上限**
    - **验证：需求 5.7**

- [x] 8. Final Checkpoint — 确保所有测试通过
  - 确保所有测试通过，如有疑问请向用户确认。

## Notes

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 进度
- 任务 1–3 为后端改动（Python），任务 4、6 为前端改动（TypeScript/React）
- 任务 2.1 是最关键的改动：配对写入顺序错误会导致两端 token 不一致，难以排查
- 属性测试使用 Hypothesis，每个属性最少运行 100 次
