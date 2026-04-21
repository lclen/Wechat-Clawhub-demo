# 入站文本聚合与微信接收态说明

> **Status**: Active | **Last Updated**: 2026-04-21 | **Purpose**: 固定“分段文本防抖聚合 + 真正思考中接收态 + 补发中断重开”的当前实现边界

## 1. 目标

本方案用于解决两个长期影响微信体验的问题：

- 用户把一句话拆成两到三段连续发送时，系统不应把它们误判成多轮独立提问
- 消息刚入站时不应立刻显示“正在思考”，而应在网关真正把任务派给节点或 Dify 后，再给用户一个明确的处理进度提示

当前实现固定采用：

- 文本入站统一聚合
- 静默窗口默认 `3s`
- 原始用户分段保留在会话记录中
- 模型只接收一次“合并后的本轮问题”
- 图片 / 文件 / 语音不参与本轮文本聚合

## 2. 适用入口

本轮聚合逻辑覆盖所有文本入站入口：

- 微信轮询入站
- `POST /api/messages/inbound`

它们都会先进入 `InboundAggregationService`，而不再直接：

- `ingest_inbound_message -> enqueue_for_inbound`

## 3. 核心行为

## 3.1 首条文本先进入静默窗口

当某个 session 收到首条文本时：

1. 原始文本先正常写入 `SessionManager`
2. 聚合层创建一份待发送批次
3. 批次进入 `collecting`
4. 启动默认 `3s` 的静默窗口

这意味着：

- 会话观察台仍能看到真实用户分段
- 但任务不会立刻派发

## 3.2 窗口内补发文本会并入同一轮

如果在 `3s` 内继续收到同一 session 的文本：

- 新文本仍然先落库
- 批次会把新文本并入 `merged_query`
- 静默计时会重置

当前拼接规则固定为：

- 按段换行

例如用户依次发送：

```text
你好
帮我看看这个型号
顺便给我接线图
```

最终发给模型的 `query_text` 为：

```text
你好
帮我看看这个型号
顺便给我接线图
```

## 3.3 真正派发后才发“真正思考中....”

当前把微信接收态拆成两段：

- `collecting`
- `dispatch accepted`

只有当静默窗口到期且网关已经成功 `enqueue_for_inbound()` 后，才会：

- 给微信发送 `真正思考中....`
- 启动 typing loop

因此：

- collecting 阶段不会过早显示“正在思考”
- 用户看到的进度提示更接近真实处理起点

## 3.4 已派发后补发文本会中断并重开

如果某个 session 当前批次已经处于：

- `dispatching`
- `inflight`

这时又收到新的文本分段，当前策略为：

1. 新文本先照常落库
2. 旧批次立即标记为 superseded
3. 微信收到提示：`已收到补充，正在按最新内容重新思考…`
4. 旧批次已有分段与新分段一起重建为新批次
5. 新批次重新进入 `3s` 静默窗口

注意：

- 不会丢失旧批次里已经收集到的前半句文本
- 新批次会继承旧批次的 `source_message_ids` 和 `segments`

## 4. Prompt 侧收口

## 4.1 会话界面保留原始分段

当前不会把用户分段消息合成一条新的用户消息写回 transcript。

也就是说：

- UI 里仍能看到“真实发了几段”
- 审计仍能追到每一段原始消息

## 4.2 模型只看到一次当前轮问题

当前 `DispatchTask` 新增以下字段：

- `query_text`
- `source_message_ids`
- `aggregation_batch_id`
- `supersedes_task_id`

在真正组装 prompt 时，聚合层会把本轮原始用户分段折叠成一个逻辑 user turn，只保留一次合并后的问题，避免出现：

- 原始碎片消息重复出现
- 合并 query 与最后一条原始消息重复出现

## 5. 取消与过期结果处理

## 5.1 task-stream-v2 在线节点

如果节点走 `task-stream-v2`，网关会发送内部控制事件：

- `cancel_task`

worker 收到后会：

- 取消本地正在执行的协程
- 若当前 provider 是 Dify 且已拿到上游 `task_id`，best-effort 调用 `POST /chat-messages/{task_id}/stop`

## 5.2 degraded HTTP polling 节点

如果节点当前处于 HTTP polling 降级模式，本轮只保证：

- 旧批次结果不会继续发给用户
- 新批次会按最新聚合结果重开

当前不为 HTTP polling 额外新增反向取消协议。

## 5.3 旧结果不会再下发给微信

网关在 `submit_result` / `submit_failure` 时会检查：

- cancel tombstone
- `context_version`
- `aggregation_batch_id`
- 当前 session 的 `active_task_id`

如果判定为旧结果，会：

- 记录 `stale_result_dropped` 或 `stale_failure_dropped`
- 不追加 bot message
- 不向微信继续发送

## 6. 微信提示与审计事件

当前以下提示属于微信进度提示，不会写成普通 bot message，也不会进入 prompt：

- `真正思考中....`
- `已收到补充，正在按最新内容重新思考…`

审计层会记录这些事件：

- `inbound_batch_collecting`
- `inbound_batch_dispatched`
- `inbound_batch_superseded`
- `wechat_progress_notice_sent`
- `wechat_restart_notice_sent`
- `stale_result_dropped`
- `stale_failure_dropped`

## 7. 当前边界

当前只对纯文本做聚合，以下内容不参与本轮防抖：

- 图片
- 文件
- 语音文件

它们会作为文本批次边界保留现有链路。

本轮也没有顺带改造：

- Dify 文件上传
- Dify remote URL 多模态透传

## 8. 配置项

当前新增配置：

- `Settings.inbound_text_quiet_window_seconds`

默认值：

```text
3.0
```

## 9. 运行态排查信号

如果链路正常，应能在 transcript / 日志中看到：

- `inbound_batch_collecting`
- `inbound_batch_dispatched`
- `wechat_progress_notice_sent`

如果用户处理中补发文本，应继续看到：

- `inbound_batch_superseded`
- `wechat_restart_notice_sent`

如果旧任务晚到，不应再出现新的 bot message，而应看到：

- `stale_result_dropped`
- `stale_failure_dropped`

## 10. 验收建议

建议至少做三组手工验证：

1. 单条文本
   - `3s` 后派发
   - 先收到 `真正思考中....`
   - 再收到最终回复
2. `3s` 内连续两到三条文本
   - 会话页保留原始分段
   - 模型只派发一次
   - `query_text` 为按段换行后的合并结果
3. 已经开始处理后再补发文本
   - 旧任务被 supersede
   - 微信收到“已收到补充，正在按最新内容重新思考…”
   - 旧结果晚到也不会继续发给用户
