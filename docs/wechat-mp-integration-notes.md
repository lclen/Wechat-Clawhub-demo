# 微信公众号接入知识沉淀

更新时间：2026-04-22

本文记录 `wechat-claw-hub` 接入微信公众号开发者模式时确认过的关键知识点、当前仓库里的落点，以及后续继续扩展时不要遗忘的约束。

## 1. 为什么要单独做 `wechat_mp` 通道

当前仓库里原有的微信接入是基于现有 `wechat_bot` 适配层的轮询/连接模式，不是微信公众号官方开发者模式。

微信公众号官方开发者模式的接入形态完全不同：

- 微信服务器主动回调我们配置的 URL
- URL 需要先通过 `GET` 校验
- 后续消息通过 `POST` 推送，数据格式是 XML
- 安全模式下需要做 `msg_signature + AES` 验签解密

因此这里新增独立通道 `wechat_mp`，不要复用原有 `wechat` 通道的上游接入方式。

## 2. 公网要求

微信公众号开发者模式要求配置一个微信服务器可访问的回调地址。

结论：

- 不要求整套 claw 都部署在公网
- 但回调 URL 必须对微信服务器可达
- 实际上通常需要固定域名 + HTTPS + 反向代理/隧道
- `gateway` 本体可以继续放在当前内网或本机，通过公网入口转发进来

这也是为什么本次实现只把回调入口和发送接口接到 `gateway`，没有要求整套系统重构部署方式。

## 3. 微信官方接入规则

本次确认过的核心规则如下：

- `GET /callback`
  微信会带上 `signature / timestamp / nonce / echostr`
  我们需要完成验签，合法时原样返回 `echostr`

- `POST /callback`
  微信会推送 XML 消息体
  安全模式下会带 `encrypt_type=aes` 和 `msg_signature`
  消息体中的 `Encrypt` 需要用 `EncodingAESKey` 解密
  解密后还要校验 payload 里的 appid 与当前公众号配置一致

- 被动回复时限
  微信要求开发者在大约 5 秒内返回合法响应，否则会断开并重试

这直接决定了我们不能走“同步等 AI 生成完再把完整 XML 作为响应体返回”的设计。

## 4. 为什么本项目必须走异步回复

`wechat-claw-hub` 当前链路是：

- gateway 收消息
- session 建模
- inbound aggregation 聚合
- dispatch queue 分发到 node
- node 返回结果
- outgoing dispatcher 回发

这是一条天然异步链路。

如果硬做同步 XML 回复，会有这些问题：

- AI 推理和节点调度容易超过微信 5 秒限制
- 一旦超时，微信会重试，造成重复处理风险
- 同步接口会把原本的 session/dispatch 体系打断成“临时同步问答”

所以当前实现采用：

- 回调收到文本后，快速进入现有 `InboundMessageRequest`
- HTTP 立即返回 `success`
- 最终答案再通过公众号客服消息接口异步发给原用户

## 5. 当前仓库里的对接点

### 入站

复用现有：

- `apps/gateway/app/api/routes/messages.py`
- `apps/gateway/app/models/session.py`
- `apps/gateway/app/services/inbound_aggregation.py`
- `apps/gateway/app/services/session_manager.py`

其中会话键规则仍然是：

- `session_id = "{channel}:{user_id}"`

对于公众号场景：

- `channel = "wechat_mp"`
- `user_id = 用户 openid`

这保证了“同一个公众号下多个用户同时提问，但上下文隔离”。

### 出站

复用并扩展：

- `apps/gateway/app/services/outgoing_dispatcher.py`

现在它同时支持：

- `wechat`
- `wechat_mp`

公众号通道第一版只发送文本消息，因此会先把 markdown 风格回答转成纯文本，再分段发送。

## 6. 当前实现里已确认的能力边界

第一版已经按以下边界实现：

- 支持公众号 `GET / POST` 官方回调
- 支持安全模式消息解密
- 支持文本消息进入现有 AI 主链路
- 支持 `CLICK` 事件把 `EventKey` 作为文本进入链路
- 支持文本答案通过客服消息接口异步回发
- 支持按 `MsgId` 或事件特征做回调去重

第一版明确未做：

- 多公众号同时接入
- 图片/语音/视频问答
- 人工客服直接回公众号消息
- 被动 XML 完整答案同步直回

## 7. access_token 策略

本次实现使用的是稳定版 access token 接口，而不是旧版 token 接口。

原因：

- 官方已推荐稳定版接口
- 普通模式下不会频繁刷新 token
- 更适合在 gateway 中做缓存

当前实现策略：

- token 存 Redis
- 正常情况下优先读缓存
- 失效后再请求稳定版 token
- 如果发送客服消息遇到 `40001 invalid credential`，会触发一次强制刷新重试

## 8. 客服消息接口约束

公众号异步回复使用的是客服消息接口。

本次确认的关键限制：

- 需要用户与公众号发生过可触发客服窗口的交互
- 用户发送消息后，客服消息窗口有效期是 48 小时
- 第一版只使用文本客服消息能力

这意味着：

- “用户发问题 -> AI 回答”是可行的
- 如果后续要做纯主动触达，需要另找模板消息/订阅通知等能力，不属于本次范围

## 9. 转人工相关提醒

仓库本身已经有完整的 session 状态机：

- `bot_active`
- `handoff_pending`
- `human_active`
- `closing`

并且已有：

- claim
- release
- switch-node

因此“转人工控制面”是存在的。

但当前公众号第一版只打通 AI 自动回复，没有打通“人工客服在控制台输入消息后直接回到公众号用户”的链路。

后续如果继续做人工回复，需要重点补：

- 控制台/接口层的人工发送入口
- `human_active` 状态下的公众号出站发送
- 人工消息 transcript 记录

## 10. 本次新增代码落点

### 公众号官方适配器

- `apps/gateway/app/access/wechat_official_account.py`

负责：

- URL 验签
- AES 解密
- 回调解析
- 回调去重
- 稳定版 token 获取与缓存
- 客服消息文本发送

### 公众号回调路由

- `apps/gateway/app/api/routes/wechat_mp.py`

负责：

- `GET /api/wechat/mp/callback`
- `POST /api/wechat/mp/callback`

### 配置项

新增环境变量：

- `WCH_WECHAT_MP_APP_ID`
- `WCH_WECHAT_MP_APP_SECRET`
- `WCH_WECHAT_MP_TOKEN`
- `WCH_WECHAT_MP_ENCODING_AES_KEY`
- `WCH_WECHAT_MP_HTTP_PROXY`

## 11. frp 部署时的出口 IP 问题

使用 frp 时要区分两条链路：

- 入站链路：`微信服务器 -> 公网服务器/frps -> 本机 frpc -> gateway`
- 出站链路：`gateway -> api.weixin.qq.com`

frp 只解决入站回调可达，不会自动改变 gateway 调用微信官方 API 的出口 IP。因此 gateway 跑在本机时，获取 stable access token 和发送客服消息仍然会使用本机网络出口；如果这个出口 IP 变化，微信会返回类似：

```text
40164 invalid ip x.x.x.x, not in whitelist
```

当前推荐做法是在固定公网 IP 的云服务器上提供一个受认证保护的 HTTP 代理，然后在 gateway 本机 `.env` 中配置：

```bash
WCH_WECHAT_MP_HTTP_PROXY=http://user:pass@121.41.47.90:3128
```

同时在公众号后台的接口 IP 白名单中加入该云服务器公网 IP。这样 gateway 仍然可以留在本机运行，微信回调继续走 frp，而调用微信 API 的出站请求会通过固定 IP 发出。

## 12. 后续继续做时最容易忘的坑

- 微信回调 URL 不是内网地址就能用，必须公网可达
- frp 只保证回调入站，不保证调用微信 API 的出站 IP 固定
- 开启开发者模式后，公众号原自动回复/部分菜单行为会受影响
- 公众号回调不是 JSON，是 XML
- 安全模式不是只验签，还要 AES 解密并校验 appid
- 微信 5 秒限制决定了必须异步回 AI 最终答案
- 客服消息不是无限期可发，用户互动窗口有限制
- 当前第一版只有单公众号模型，如果后面接第二个公众号，要把 `appid/account` 纳入 session key 设计

## 13. 官方参考

本次主要对照以下官方文档：

- [消息与事件推送介绍](https://developers.weixin.qq.com/doc/service/guide/dev/push/)
- [消息加解密说明](https://developers.weixin.qq.com/doc/service/guide/dev/push/encryption.html)
- [被动回复用户消息](https://developers.weixin.qq.com/doc/service/guide/product/message/Passive_user_reply_message.html)
- [发送客服消息](https://developers.weixin.qq.com/doc/service/api/customer/message/api_sendcustommessage.html)
- [获取稳定版接口调用凭据](https://developers.weixin.qq.com/doc/service/api/base/api_getstableaccesstoken.html)
