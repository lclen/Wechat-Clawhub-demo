# wechat-claw-hub Architecture Overview

## 1. 设计目标

本文档用于把 `wechat-claw-hub` 的首版技术方案固定下来，直接作为下一阶段编码实现的输入。

首版必须满足以下设计目标：

- 多个微信用户可以同时接入同一个 agent
- 不同用户拥有独立上下文，不能串线
- 网关统一持有会话状态，`Claw` 节点不持有长期用户上下文
- 多个 `Claw` 节点可以根据并发上限和健康状态进行分发
- 所有节点统一调用 Dify API 回答问题
- 用户要求转人工后，进入人工独占接管模式
- 网页坐席台可以查看会话历史、认领会话、发送消息、释放会话

## 2. 总体架构

首版采用单网关、多个工作节点的结构。

```text
WeChat User
   |
   v
WeChat Access Layer
   |
   v
Gateway Service
   |-- Redis
   |-- Transcript Store
   |-- Session State Machine
   |-- Node Scheduler
   |-- Handoff Manager
   |
   +--> Claw Node A --> Dify API
   +--> Claw Node B --> Dify API
   +--> Claw Node C --> Dify API
   |
   +--> Agent Console (HTTP + WebSocket)
```

### 核心原则

- 网关是唯一的会话状态所有者
- 节点是可替换的执行单元
- Dify 是统一知识问答后端
- 人工坐席通过网关介入，不直接连接微信渠道

## 3. 模块边界

### 3.1 网关服务 `apps/gateway`

网关服务负责所有状态性和调度性逻辑。

内部拆分为以下模块：

- `access.wechat`
  - 接收微信消息
  - 发送微信消息
  - 完成扫码 onboarding
- `session.manager`
  - 创建和查询用户会话
  - 维护会话摘要、最近消息窗口、绑定节点、接管状态
- `context.store`
  - 统一读写 Redis 中的上下文和状态
- `scheduler`
  - 根据节点健康状态、并发上限、会话亲和性做分发
- `handoff.manager`
  - 管理转人工、认领、释放、人工回复
- `transcript.writer`
  - 记录消息、系统事件、节点切换、人工接管事件
- `api.http`
  - 提供管理接口和坐席台接口
- `api.ws`
  - 向网页坐席台推送会话变化、消息事件、节点状态变化

### 3.2 工作节点 `services/claw-node`

`Claw` 节点只负责执行当前轮处理，不保存长期会话状态。

节点职责：

- 接收网关分发的处理请求
- 获取本轮执行所需的上下文窗口
- 按统一配置调用 Dify API
- 将生成结果返回给网关
- 上报节点健康、当前并发、最近错误

节点不负责：

- 保存用户长期上下文
- 直接操作人工接管状态
- 直接向微信发消息

### 3.3 网页坐席台 `apps/agent-console`

网页坐席台是人工接管入口。

坐席台职责：

- 展示会话列表
- 展示会话详情与完整消息历史
- 展示接入中心中的模型、微信和节点接入状态
- 认领待接管会话
- 发送人工消息
- 释放已接管会话
- 实时接收系统状态与消息更新

当前前端工作区结构已经固定为：

- `接入中心`
  - 查看模型状态
  - 查看微信接入状态
  - 查看已接入节点、节点 ID、hostname、局域网 IP、上报地址、平台、版本、负载
- `会话观察台`
  - 左侧会话列表
  - 中间聊天时间线
  - 右侧会话记忆抽屉

### 3.4 基础设施 `infra`

首版基础设施包括：

- Redis
- 网关服务部署配置
- 节点服务部署配置
- 可选反向代理

## 4. 会话与上下文模型

### 4.1 会话隔离规则

首版会话以微信私聊用户 ID 作为主隔离键。

会话唯一键建议定义为：

```text
session_id = "wechat:{user_id}"
```

这意味着：

- 同一个微信用户只有一个主会话
- 多个用户访问同一个 agent 时，共享的是 agent 能力，不共享上下文
- 同一个用户的消息总是回到自己的上下文空间
- 即使后续某一轮消息被重新分发到不同节点，网关仍提供同一个会话上下文

### 4.2 上下文内容

每个会话至少维护以下内容：

- `session_id`
- `channel`
- `user_id`
- `agent_id`
- `status`
- `assigned_node_id`
- `context_summary`
- `recent_messages`
- `handoff_ticket_id`
- `claimed_by`
- `last_message_at`
- `last_dispatch_at`
- `version`
- `reply_context_token`

### 4.3 上下文窗口策略

首版使用“摘要 + 最近消息窗口”的方式：

- `context_summary` 保存压缩后的会话摘要
- `recent_messages` 保存最近若干轮消息
- 节点处理请求时，网关下发摘要和最近窗口

这条规则必须满足：

- 即使同一个用户的不同轮消息被分发到不同节点，节点拿到的仍然是同一个会话的最新上下文
- 节点不能把本地内存当作用户长期记忆来源
- 用户历史聊天与记忆的唯一事实来源始终是主网关持有的 Redis 状态和 transcript

默认建议：

- 最近窗口保留最近 `20` 条消息
- 超出窗口后由网关进行摘要更新

## 5. Redis Key 设计

Redis 采用明确的命名空间，避免后续混乱。

### 5.1 会话相关

- `wch:session:{session_id}:meta`
  - Hash
  - 保存会话主状态、绑定节点、时间戳、接管状态

- `wch:session:{session_id}:messages`
  - List
  - 保存最近消息窗口

- `wch:session:{session_id}:summary`
  - String
  - 保存压缩后的上下文摘要

- `wch:session:{session_id}:lock`
  - String
  - 用于并发处理同一会话的短期锁

### 5.2 节点相关

- `wch:node:{node_id}:meta`
  - Hash
  - 保存节点地址、并发上限、当前占用、状态、最近心跳

- `wch:nodes:active`
  - Set
  - 保存当前注册的活跃节点

- `wch:node:{node_id}:leases`
  - Set
  - 保存该节点正在处理的会话 ID

### 5.3 人工接管相关

- `wch:handoff:pending`
  - Sorted Set
  - 待接管会话队列

- `wch:handoff:{ticket_id}:meta`
  - Hash
  - 保存接管工单详情

- `wch:agent:{agent_user_id}:sessions`
  - Set
  - 保存某个坐席当前认领的会话

### 5.4 系统级配置

- `wch:config:dify`
  - Hash
  - 保存 Dify 统一配置

- `wch:config:wechat`
  - Hash
  - 保存微信接入配置

### 5.5 TTL 规则

首版默认：

- 会话锁 TTL：`30s`
- 节点心跳 TTL：`15s`
- 节点租约 TTL：由心跳续期
- 会话主数据不自动过期

## 6. transcript 与审计存储

首版保留 Redis 热数据，同时落 transcript 文件用于审计。

建议路径：

```text
data/transcripts/{session_id}.jsonl
```

每条记录包含：

- `event_id`
- `event_type`
- `session_id`
- `timestamp`
- `actor_type`
- `actor_id`
- `node_id`
- `payload`

事件类型至少包括：

- `user_message`
- `bot_message`
- `human_message`
- `dispatch_assigned`
- `dispatch_reassigned`
- `handoff_requested`
- `handoff_claimed`
- `handoff_released`
- `wechat_send_failed`
- `dify_request_failed`

## 7. 节点调度设计

### 7.1 节点状态

节点状态固定为：

- `healthy`
- `degraded`
- `busy`
- `offline`

### 7.2 调度输入

调度时必须读取以下信息：

- 节点健康状态
- 节点并发上限
- 节点当前占用数
- 节点最近错误率
- 当前会话是否已有绑定节点

### 7.3 调度规则

首版调度规则固定如下：

1. 如果会话已有绑定节点，且该节点状态为 `healthy` 或 `degraded`，并且未达到并发上限，优先继续使用原节点。
2. 如果原节点不可用，则在所有 `healthy` 节点中选择 `current_load / max_concurrency` 最低的节点。
3. 如果没有 `healthy` 节点，则允许从 `degraded` 节点中继续选择最空闲节点。
4. `busy` 和 `offline` 节点不接收新请求。
5. 当节点连续失败超过阈值时，状态降为 `degraded` 或 `offline`。

补充约束：

- `assigned_node_id` 只是调度亲和信息，不是上下文归属信息
- 节点切换不会导致会话上下文切换
- 任意节点只要拿到同一 `session_id` 的上下文快照，都必须能继续该用户的历史对话

### 7.4 并发约束

- 同一会话在任一时刻只能有一个活跃处理任务
- 同一节点可以并行处理多个不同用户的会话
- 网关必须在分发前获取会话锁，防止同一用户消息并发串线

## 8. 会话状态机

### 8.1 会话主状态

首版状态机固定如下：

- `bot_active`
- `handoff_pending`
- `human_active`
- `closing`

### 8.2 状态流转

```text
bot_active -> handoff_pending -> human_active -> bot_active
bot_active -> closing
human_active -> closing
```

### 8.3 状态说明

- `bot_active`
  - AI 正常接待
  - 用户消息进入调度链路

- `handoff_pending`
  - 已发起转人工
  - AI 不再继续自动回复新消息
  - 坐席台等待人工认领

- `human_active`
  - 某位人工已认领会话
  - 所有对用户的回复只能由人工发起
  - AI 只允许做内部建议，不允许直接外发

- `closing`
  - 会话准备归档或暂时冻结

### 8.4 关键规则

- 用户触发转人工后，当前会话立即从 `bot_active` 切为 `handoff_pending`
- `handoff_pending` 和 `human_active` 状态下，网关禁止自动下发 AI 回复
- 人工释放后回到 `bot_active`
- 若人工长时间未认领，系统可继续保留待接管状态，不自动恢复 AI

## 9. 人工接管生命周期

### 9.1 发起

触发方式：

- 用户明确提出转人工
- 业务规则判断需要人工介入
- 未来可扩展为人工主动拉起

系统动作：

- 创建 `handoff_ticket`
- 更新会话状态
- 记录 transcript 事件
- 向坐席台广播待接管消息

### 9.2 认领

认领时需要做乐观锁或原子校验，确保一个工单只能被一个坐席成功认领。

认领成功后：

- 记录 `claimed_by`
- 更新会话状态为 `human_active`
- 写入 transcript
- 推送给所有坐席台刷新会话状态

### 9.3 人工回复

人工发送消息时：

- 请求进入网关
- 网关校验当前会话处于 `human_active`
- 校验发送者就是当前认领坐席
- 消息写入 transcript
- 消息经微信适配器发送给用户

### 9.4 释放

释放会话时：

- 清理 `claimed_by`
- 清理挂接的 `handoff_ticket` 活跃状态
- 会话状态恢复为 `bot_active`
- 写入 transcript
- 通知坐席台和监控端

## 10. HTTP API 设计

以下接口为首版建议最小集合。

### 10.1 微信接入

- `POST /api/wechat/onboard/start`
  - 返回二维码或二维码 URL

- `POST /api/wechat/onboard/poll`
  - 轮询扫码状态

- `POST /api/wechat/onboard/connect`
  - 使用 token 建立微信连接

- `POST /api/wechat/onboard/disconnect`
  - 断开微信连接

### 10.2 节点管理

- `GET /api/nodes`
  - 返回节点列表和状态

- `POST /api/nodes/register`
  - 节点注册

- `POST /api/nodes/heartbeat`
  - 节点心跳

- `PATCH /api/nodes/{node_id}`
  - 更新节点并发上限或状态

### 10.3 会话与消息

- `GET /api/sessions`
  - 返回会话列表，支持按状态筛选

- `GET /api/sessions/{session_id}`
  - 返回会话详情

- `GET /api/sessions/{session_id}/messages`
  - 返回消息历史

- `POST /api/internal/dispatch`
  - 网关内部调用，向节点发起处理请求

### 10.4 人工接管

- `POST /api/handoff/request`
  - 发起人工接管

- `POST /api/handoff/{ticket_id}/claim`
  - 人工认领

- `POST /api/handoff/{ticket_id}/reply`
  - 人工发送消息

- `POST /api/handoff/{ticket_id}/release`
  - 人工释放会话

### 10.5 系统状态

- `GET /api/system/status`
  - 返回网关、Redis、Dify、微信连接状态

## 11. WebSocket 事件设计

网页坐席台使用 WebSocket 获取实时事件。

建议入口：

```text
GET /ws/console
```

事件类型固定如下：

- `session_created`
- `session_updated`
- `session_status_changed`
- `message_created`
- `handoff_pending`
- `handoff_claimed`
- `handoff_released`
- `node_status_changed`
- `system_alert`

### 11.1 事件基础结构

```json
{
  "type": "message_created",
  "timestamp": "2026-04-01T19:41:49+08:00",
  "session_id": "wechat:wxid_xxx",
  "payload": {}
}
```

### 11.2 消息事件结构

```json
{
  "type": "message_created",
  "timestamp": "2026-04-01T19:41:49+08:00",
  "session_id": "wechat:wxid_xxx",
  "payload": {
    "message_id": "msg_001",
    "role": "user",
    "content": "请帮我查一下退款规则",
    "sender_id": "wxid_xxx",
    "node_id": "claw-node-a"
  }
}
```

## 12. Dify 集成设计

首版通过统一的 Dify API 配置访问知识库。

### 12.1 Dify 适配层

网关内部定义 `KnowledgeProvider` 接口，首版只实现 `DifyProvider`。

职责：

- 屏蔽 Dify API 细节
- 统一超时、重试、错误分类
- 为后续替换知识库后端预留扩展点

### 12.2 Dify 请求输入

每次请求至少包含：

- `session_id`
- `agent_id`
- `user_id`
- `query`
- `context_summary`
- `recent_messages`

### 12.3 错误处理

首版统一处理以下错误：

- 网络超时
- 限流
- 认证失败
- 后端 5xx

处理规则：

- 节点上报失败给网关
- 网关记录日志和 transcript 事件
- 用户收到友好错误提示
- 连续失败时节点可降级处理

## 13. 安全与权限

首版不做复杂多租户权限，但必须具备最小安全约束。

- 人工坐席必须登录后才能访问坐席台
- 人工只能操作自己认领的会话
- 内部节点接口必须使用服务间密钥
- Dify 和微信凭据不得写入 transcript
- 所有人工操作必须记录审计日志

## 14. 失败场景与恢复策略

### 14.1 节点失联

- 网关检测心跳超时
- 将节点标记为 `offline`
- 不再给该节点分发新请求
- 用户后续消息切换到其他健康节点

### 14.2 Redis 短暂不可用

- 网关拒绝继续处理新消息
- 返回系统忙提示
- 保证不在无状态下继续处理，以免造成上下文丢失

### 14.3 Dify 持续失败

- 返回用户友好错误
- 记录告警
- 不自动切换为人工，除非业务规则显式要求

### 14.4 微信发送失败

- 重试有限次数
- 仍失败则记录 `wechat_send_failed`
- 在坐席台和系统状态页展示告警

## 14.5 微信字段能力边界

当前微信接入基于 iLink 消息事件，网关已确认稳定可获取：

- `from_user_id`
- `message_id`
- `session_id`
- `context_token`
- `item_list` 中的文本或媒体内容

当前未确认或未接入：

- 微信号
- 微信昵称
- 备注名
- 头像
- 联系人资料查询

因此系统当前显示的用户标识应视为“平台用户唯一 ID”，而不是微信号。

## 14.6 已落地的微信运行能力

当前网关实现已具备：

- 长轮询获取微信入站消息
- `context_token` 缓存与回复时回传
- 微信端 typing 提示发送与清除

这些能力已经进入实际运行链路，但 typing 的最终展示效果仍取决于 iLink 返回的 `typing_ticket` 与 token 有效性。

## 15. 首版目录建议

```text
wechat-claw-hub/
  apps/
    gateway/
      app/
        api/
        access/
        scheduler/
        sessions/
        handoff/
        storage/
        integrations/
        audit/
    agent-console/
  docs/
    prd.md
    architecture-overview.md
  infra/
  scripts/
  services/
    claw-node/
```

## 16. 实现顺序建议

推荐按以下顺序推进：

1. 节点注册信息增强
2. 节点真实局域网地址上报
3. 联系人资料能力调研与用户显示名缓存
4. 人工接管状态机与坐席闭环
5. WebSocket 实时推送替换部分轮询
6. transcript 与节点日志增强
7. 微信媒体消息与失败重试完善

## 17. 首版验收检查清单

- 同一个 agent 下至少两个用户并发对话时上下文完全隔离
- 任一会话同时最多一个活跃处理任务
- 至少两个节点参与调度时可以按并发分配请求
- 人工认领后 AI 不再自动外发消息
- 人工释放后 AI 自动恢复接待
- transcript 能完整回放用户、AI、人工、系统事件
- 服务重启后 Redis 中的会话状态和接管状态可恢复
