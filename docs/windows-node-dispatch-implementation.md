# Windows 子节点分发与部署实现文档

## 1. 文档目的

本文档用于细化 `wechat-claw-hub` 的下一阶段实现工作，覆盖以下两条主线：

- 主网关如何把用户消息分发给多个 `claw-node` 工作节点
- Windows 子节点如何通过脚本快速部署，并自动连回主网关接单

本文档是对 `docs/prd.md` 和 `docs/architecture-overview.md` 的进一步落实，目标是让后续实现不再需要额外做架构层决策。

## 2. 当前基线

截至当前版本，主网关已经具备以下基础能力：

- FastAPI 应用骨架
- Redis 存储抽象
- 节点注册与心跳基础接口
- 会话模型与最近消息窗口
- transcript JSONL 审计落盘
- 用户入站消息接口
- 会话查询接口

当前尚未完成的关键能力：

- 节点鉴权
- 调度队列
- 任务拉取协议
- 任务结果回传
- `claw-node` 工作节点服务
- Windows 一键部署脚本

## 3. 本阶段目标

本阶段实现完成后，应达到以下效果：

- 用户消息进入主网关后，可以生成待执行任务
- 主网关可以选择合适的节点并将任务挂到该节点队列
- Windows 子节点启动后，可以主动注册到主网关
- 子节点可以心跳、拉取任务、执行 Dify 调用并提交结果
- 主网关收到结果后，可以写回会话和 transcript
- 子节点可以通过 PowerShell 脚本在新机器上快速部署
- 子节点可注册为 Windows 服务并长期运行

## 4. 实现边界

### 本阶段要做

- 网关节点 token 鉴权
- 节点拉取式调度队列
- 节点结果回传接口
- 基础失败回写
- `claw-node` Python worker
- Windows 打包脚本
- Windows 安装脚本
- WinSW 服务模板

### 本阶段不做

- 主网关主动反向连接节点执行任务
- Linux 子节点支持
- Docker 部署
- 复杂重试编排
- 人工接管和节点分发的联合联动
- 微信出站真实发送链路

## 5. 固定技术决策

- 子节点首版仅支持 Windows
- 子节点首版使用脚本部署
- 子节点运行我们自己的 `claw-node`
- 主从鉴权使用预共享 `Node Token`
- 主服务器地址按局域网地址配置
- 节点首版使用主动注册 + 主动拉取任务模式
- 主机反连只做协议预留，不做执行
- 子节点常驻方式为 Windows 服务
- 工作节点执行 Dify 请求，主网关负责状态和任务

## 6. 代码结构规划

### 主网关

建议新增或扩展以下模块：

```text
apps/gateway/app/
  api/routes/
    nodes.py
    messages.py
  dispatch/
    queue.py
    scheduler.py
    result_handler.py
  models/
    dispatch.py
  services/
    node_auth.py
    session_manager.py
    node_registry.py
```

### 子节点

新增独立服务目录：

```text
services/claw-node/
  pyproject.toml
  claw_node/
    __init__.py
    main.py
    config.py
    gateway_client.py
    dify_client.py
    worker.py
```

### 部署脚本与资源

```text
scripts/
  build-claw-node-bundle.ps1
  install-claw-node.ps1

infra/windows/winsw/
  service.xml.template
```

## 7. 网关侧实现说明

### 7.1 节点鉴权

网关新增节点鉴权模块，规则固定如下：

- 所有节点接口必须带 `X-Node-Token`，或使用 `Authorization: Bearer <token>`
- 网关根据 `node_id` 查找对应 token
- token 校验失败返回 `401`
- 未注册节点在提交结果或心跳时返回 `404` 或 `401`

建议配置项：

- `WCH_NODE_TOKENS`
  - JSON 字符串
  - 例如：

```json
{
  "node-a": "token-a",
  "node-b": "token-b"
}
```

### 7.2 任务模型

新增 `DispatchTask`，字段固定如下：

- `task_id`
- `session_id`
- `node_id`
- `agent_id`
- `user_id`
- `context_summary`
- `recent_messages`
- `message`
- `created_at`
- `context_version`

`message` 字段保存本轮用户消息。  
`recent_messages` 保存最近消息窗口。  
`context_summary` 保存摘要上下文。
`context_version` 表示任务创建时会话上下文版本，用于检测过时任务结果。

### 7.2.1 上下文一致性硬约束

这一阶段必须显式保证：

- 同一个用户的长期上下文只保存在主网关的 Redis 和 transcript 中
- 节点每次处理任务时，都必须从任务载荷中获得该会话的最新上下文快照
- 节点本地内存、进程状态、临时缓存都不能视为用户长期记忆
- 即使用户连续两条消息被不同节点处理，也必须基于同一个 `session_id` 的上下文继续回答
- `assigned_node_id` 仅用于调度亲和和负载优化，不能决定记忆归属

这意味着首版设计中必须坚持：

- 网关负责汇总用户消息并更新会话状态
- 节点只消费任务，不拥有最终会话状态
- 节点返回结果后，由网关统一写回会话和 transcript

### 7.3 Redis 结构

新增以下 Key：

- `wch:dispatch:pending`
  - 全局待处理任务集合或保留键
- `wch:dispatch:task:{task_id}`
  - 存放单任务详情
- `wch:dispatch:node:{node_id}`
  - 某节点待拉取任务列表
- `wch:dispatch:inflight:{task_id}`
  - 正在执行中的任务租约
- `wch:dispatch:session:{session_id}`
  - 当前会话活跃任务标记

说明：

- 首版核心消费队列是 `wch:dispatch:node:{node_id}`
- `wch:dispatch:session:{session_id}` 用于防止同一会话并发执行
- inflight key 用于避免节点拉到任务后丢失状态

### 7.4 入站消息处理升级

`POST /api/messages/inbound` 逻辑升级为：

1. 写入用户消息
2. 查询会话状态
3. 若状态为 `bot_active`，尝试调度节点
4. 若找到可用节点，则读取该会话最新的 `context_summary`、`recent_messages` 和 `version`
5. 创建带上下文快照的任务并挂入该节点队列
6. 记录该任务对应的 `context_version`
7. 更新会话：
   - `assigned_node_id`
   - `active_task_id`
   - `queue_status = pending`
   - `last_dispatch_at`
8. 若无可用节点，则记录 transcript 事件并返回受控状态

### 7.5 节点调度规则

沿用当前架构文档中已确认的规则：

1. 原绑定节点健康且未达到并发上限时优先继续分配
2. 否则从 `healthy` 节点中选择 `current_load / max_concurrency` 最低者
3. 若无 `healthy` 节点，则允许使用 `degraded` 节点
4. `busy` 和 `offline` 节点不接收新任务

### 7.6 节点拉取接口

新增接口：

- `POST /api/nodes/{node_id}/pull-task`

逻辑：

1. 校验 token
2. 从该节点队列拉取一条任务
3. 若没有任务，返回 `task = null`
4. 若有任务：
   - 创建 inflight 记录
   - 更新会话 `queue_status = inflight`
   - 返回完整任务内容

### 7.7 节点结果回传接口

新增接口：

- `POST /api/nodes/{node_id}/task-result`
- `POST /api/nodes/{node_id}/task-failure`

成功回传逻辑：

1. 校验 token
2. 校验任务处于 inflight
3. 校验 `context_version` 不早于会话当前允许接收的版本
4. 将 bot 回复写入会话消息
5. 写 transcript：
   - `dispatch_completed`
   - `bot_message`
6. 清理：
   - inflight task
   - `wch:dispatch:session:{session_id}`
7. 更新会话：
   - `active_task_id = null`
   - `queue_status = none`

说明：

- 首版同一会话任一时刻只允许一个 inflight task，因此正常情况下不会出现同会话并发结果竞争
- `context_version` 仍然保留，用于防御节点延迟回传、重复回传或未来扩展并发策略时的过期结果污染

失败回传逻辑：

1. 校验 token
2. 写 transcript：
   - `dispatch_failed`
3. 清理 inflight 和会话活跃任务标记
4. 会话状态恢复为无活跃任务
5. 首版不自动重试，只记录错误

## 8. 会话模型变更

会话模型新增两个字段：

- `active_task_id`
- `queue_status`
- `context_version`

`queue_status` 取值固定为：

- `none`
- `pending`
- `inflight`

首版只使用这三个值，不引入更复杂的任务状态机。

`context_version` 规则固定如下：

- 每次用户消息成功写入会话后，`context_version + 1`
- 创建 dispatch task 时，将当前 `context_version` 写入任务
- 节点回传结果时带回该版本号
- 网关只接受与该任务匹配的结果

## 9. 子节点 `claw-node` 实现说明

### 9.1 子节点配置

本地 `.env` 固定包含：

- `CLAW_NODE_ID`
- `CLAW_GATEWAY_BASE_URL`
- `CLAW_NODE_TOKEN`
- `CLAW_DIFY_BASE_URL`
- `CLAW_DIFY_API_KEY`
- `CLAW_MAX_CONCURRENCY`
- `CLAW_PULL_INTERVAL_MS`
- `CLAW_HEARTBEAT_INTERVAL_SECONDS`

### 9.2 子节点启动流程

固定流程如下：

1. 读取配置
2. 初始化日志
3. 向主网关注册节点
4. 启动心跳循环
5. 启动拉取任务循环
6. 收到任务后执行 Dify 调用
7. 将成功或失败结果提交回网关

子节点必须遵守的上下文规则：

- 任务是唯一输入来源
- 子节点不能依赖“上一次正好也是这个用户落到本机”的假设
- 子节点每次调用 Dify 时，都必须使用任务中携带的 `context_summary` 和 `recent_messages`
- 子节点完成后不能在本地保留可影响下次回答的用户长期记忆

### 9.3 子节点模块职责

#### `config.py`

- 读取 `.env`
- 校验关键配置

#### `gateway_client.py`

- 请求网关注册
- 发送心跳
- 拉取任务
- 提交结果
- 提交失败

#### `dify_client.py`

- 统一封装 Dify 请求
- 处理超时与异常

#### `worker.py`

- 维护心跳循环
- 维护拉取循环
- 管理本地并发数
- 调度单任务执行

#### `main.py`

- 组装配置和运行 worker

### 9.4 子节点并发模型

首版允许节点同时处理多个会话任务，但并发数由 `CLAW_MAX_CONCURRENCY` 控制。

建议实现：

- 使用 `asyncio.Semaphore`
- 当前活跃任务数用于心跳上报
- 拉取循环只在有剩余并发时拉任务

## 10. Dify 调用约定

子节点请求 Dify 时至少传递：

- 当前用户问题
- `session_id`
- `user_id`
- `agent_id`
- `context_summary`
- `recent_messages`

首版默认走统一 Dify Chat API 适配，返回：

- 纯文本回答
- 可选 usage 信息

若 Dify 调用失败：

- 将错误分类为：
  - 认证失败
  - 限流
  - 超时
  - 5xx
- 回传给主网关作为 `task-failure`

## 11. Windows 脚本实现说明

### 11.1 主端打包脚本 `build-claw-node-bundle.ps1`

职责：

- 收集 `services/claw-node` 源码
- 收集 `pyproject.toml`
- 收集 WinSW 模板
- 生成默认 `.env.example`
- 输出 zip bundle

输出建议：

```text
dist/claw-node-bundle/
dist/claw-node-bundle.zip
```

### 11.2 子端安装脚本 `install-claw-node.ps1`

固定参数：

- `-NodeId`
- `-GatewayBaseUrl`
- `-NodeToken`
- `-DifyBaseUrl`
- `-DifyApiKey`
- `-MaxConcurrency`
- `-InstallDir`

建议允许增加一个可选参数：

- `-BundlePath`

固定动作：

1. 检查 Python 3.11+
2. 解压 bundle 到安装目录
3. 创建 `.venv`
4. 安装依赖
5. 写入 `.env`
6. 生成 WinSW XML
7. 下载或复制 WinSW 可执行文件
8. 注册 Windows 服务
9. 启动服务
10. 输出服务名和日志目录

### 11.3 Windows 服务

服务方案固定使用 `WinSW`。

服务名格式：

```text
wechat-claw-node-{node_id}
```

日志目录固定为：

```text
logs/
```

服务启动命令固定为：

```text
python -m claw_node.main
```

## 12. transcript 与审计规则

新增以下事件类型：

- `dispatch_enqueued`
- `dispatch_pulled`
- `dispatch_completed`
- `dispatch_failed`

必须保证：

- 不写入 node token
- 不写入 Dify API key
- 用户消息、bot 回复、节点分发和失败事件都可回放

## 13. 错误处理规则

### 网关侧

- 节点鉴权失败：`401`
- 节点未注册：`404`
- Redis 不可用：`503`
- 无可用节点：
  - 当前阶段允许返回成功但不创建任务
  - 同时写 transcript 系统事件

### 子节点侧

- 配置缺失：启动失败并退出
- 网关连接失败：持续重试
- Dify 调用失败：回传失败结果，不崩溃主进程
- 单任务异常：仅影响该任务，不终止整个 worker

## 14. 测试与验收

### 网关侧

- 节点 token 鉴权成功
- 节点 token 鉴权失败
- `bot_active` 会话成功创建任务
- `handoff_pending` / `human_active` 会话不创建任务
- 同一会话不能同时存在两个活跃任务
- 节点拉取任务后会话状态变为 `inflight`
- 节点提交结果后会话恢复 `queue_status = none`

### 子节点侧

- 可成功注册节点
- 可持续发送心跳
- 可拉取任务并提交结果
- 可在 Dify 异常时提交失败结果

### Windows 脚本

- 能生成 `.env`
- 能创建 `.venv`
- 能安装依赖
- 能注册服务
- 服务重启后自动继续运行

### 端到端

- 用户发消息后生成任务
- 子节点拉到任务并处理
- 主网关写入 bot 消息
- transcript 可看到完整链路

## 15. 实现顺序建议

建议按以下顺序开发：

1. 网关补节点鉴权
2. 网关补任务模型和 Redis 队列
3. 网关补拉取任务和结果回传接口
4. 升级 `messages/inbound` 以创建 dispatch task
5. 升级 `sessions` 返回任务状态字段
6. 编写 `claw-node` 服务
7. 编写 `build-claw-node-bundle.ps1`
8. 编写 `install-claw-node.ps1`
9. 完成本地联调

## 16. 当前实现限制

- 首版不支持 Linux
- 首版不支持 Docker
- 首版不支持主网关反向连接子节点
- 首版不支持复杂重试与死信队列
- 首版不接真实微信出站

这些限制不影响“子节点快速部署并连回主网关接受分发”的首个可用版本。
