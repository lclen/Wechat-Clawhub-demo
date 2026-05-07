# openclaw-weixin 会话续登调研记录

更新时间：2026-05-06

## 结论摘要

- `@tencent-weixin/openclaw-weixin` 最新 npm 版本已确认是 `2.4.1`。
- 这个包支持“登录后本地持久化账号凭据，并在 gateway 启动后自动恢复监控”。
- 目前公开实现里没有发现“拿 refresh token 静默续期”的能力。
- 当上游返回 `errcode=-14`（`session timeout`）时，它的处理策略是“暂停该账号 1 小时，再阻止后续请求”，不是自动刷新成一份新的长期凭据。

## 本地状态目录

默认状态目录来自 `OPENCLAW_STATE_DIR` / `CLAWDBOT_STATE_DIR`，否则落到：

```text
~/.openclaw
```

微信插件把自己的数据放在：

```text
~/.openclaw/openclaw-weixin/
```

关键文件：

- `accounts.json`
  已登录账号 ID 索引
- `accounts/{accountId}.json`
  单账号凭据，包含 `token`、`baseUrl`、`savedAt`、可选 `userId`
- `accounts/{accountId}.sync.json`
  `get_updates_buf` 持久化游标，用于重启后续接长轮询进度
- `accounts/{accountId}.context-tokens.json`
  会话上下文 token

## 登录成功后保存了什么

扫码登录成功后，插件会把以下字段写入账号文件：

- `token`
- `baseUrl`
- `userId`
- `savedAt`

也会把账号 ID 追加到 `accounts.json`，用于后续枚举和自动恢复。

这说明它确实具备“后端重启/升级后尽量免重扫恢复”的基础。

## 启动后如何恢复

插件启动后，会从已注册账号列表中恢复账号，再用本地保存的 `token` 启动对应账号的 monitor。

同时，它会恢复：

- `get_updates_buf`
- context tokens

所以如果上游仍接受旧 token，它可以接着原来的轮询状态继续运行，而不是每次从空状态重新扫码。

## 会话过期时怎么处理

当 `getUpdates` 返回以下情况时，会被视为会话过期：

- `errcode == -14`
- `ret == -14`

之后的处理不是刷新 token，而是：

1. 调用 `pauseSession(accountId)`
2. 给该账号加一个 1 小时的 pause 窗口
3. monitor 记录日志并 sleep 到 pause 结束
4. 这段时间内入站/出站 API 调用会被 `assertSessionActive()` 拦住

也就是说，它做的是“过期保护和冷却”，不是“静默续签”。

## 对当前项目的启示

我们当前 `gateway` 的 Python 实现本质上和这个思路一致：

- 持久化 token
- 重启后恢复 polling
- 上游 `session timeout` 时标记失效并停止

差异主要在于：

- `openclaw-weixin` 会额外持久化 `get_updates_buf`
- 它有显式的 `session-guard` 冷却层
- 但两边都没有公开的“真正免扫码续期”机制

## 参考 D:\openakita 的实现结论

`D:\openakita\src\openakita\channels\adapters\wechat.py` 的连接稳定性主要来自以下几层：

- 启动时用保存的 `token` 创建适配器，并立即恢复 `get_updates_buf` 和 context tokens。
- 后台持续执行 `ilink/bot/getupdates` 长轮询，轮询超时不是异常，而是正常空响应。
- 每次服务端返回新的 `get_updates_buf` 后更新本地游标，停止时写回磁盘，重启后从该游标继续。
- 每次收到入站消息的 `context_token` 后，按 `user_id -> context_token` 写入本地 JSON；出站回复优先使用最新缓存 token，再退回消息 metadata 中的 token。
- `ret=-14` / `errcode=-14` 仍然被判定为上游 session 过期，处理方式是暂停该账号 1 小时，不是静默续期。

这说明 `openakita` 做到的是“后端重启/升级不主动丢连接状态”，不是“微信上游登录态永不过期”。

## 本仓库已完成的同步

截至 2026-05-06，本仓库的 Python gateway 已补齐以下对齐项：

- 默认 `channel_version` 从旧的 `2.1.6` 调整为 `2.4.1`
- `iLink-App-ClientVersion` 随兼容版本同步更新
- 每个请求的 `base_info` 增加 `bot_agent`，默认值为 `OpenClaw`
- `get_updates_buf` 已持久化到 Redis，用于重启后继续长轮询游标
- `context_tokens_json` 已持久化到 Redis，重启后可恢复每个用户最近一次可用的 `context_token`
- 收到入站消息、typing 操作或出站发送携带新的 `context_token` 时，会即时更新 Redis runtime state

仍未同步的点：

- npm 插件本身并未直接嵌入当前 Python gateway / node / agent-console
- `openclaw-weixin` 的 account-level session guard 是“过期冷却”语义；当前 gateway 现在也采用相近策略，`-14` 后会进入暂停窗口，之后自动重试，而不是立刻把账号标成永久失效

## 当前最稳妥的工程目标

短期最现实的目标不是“永不过期”，而是：

- 不因为我们自己的重启、升级、切主备导致用户掉线
- 上游 token 仍有效时尽量自动恢复
- 上游 token 真过期时，尽快发现、暂停并在必要时再引导最小成本重绑

## 本次实验目录

为避免污染现有前端依赖，本次 npm 实验目录为：

```text
tools/openclaw-weixin-lab/
```

这里安装的是：

```text
@tencent-weixin/openclaw-weixin@^2.4.1
```
