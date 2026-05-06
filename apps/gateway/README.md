# Gateway App

首版网关骨架基于 `FastAPI`，当前已包含：

- 应用入口 `app/main.py`
- 配置系统 `app/core/config.py`
- 生命周期初始化 `app/core/lifespan.py`
- Redis 存储抽象 `app/services/redis_store.py`
- 节点注册表 `app/services/node_registry.py`
- 节点鉴权 `app/services/node_auth.py`
- 会话管理 `app/services/session_manager.py`
- transcript 写入器 `app/services/transcript_writer.py`
- 分发调度
  - `app/dispatch/scheduler.py`
  - `app/dispatch/queue.py`
- 系统状态接口 `GET /api/system/status`
- 内置模型接口
  - `GET /api/models/builtin/status`
  - `POST /api/models/builtin/check`
- 微信 onboarding 接口
  - `POST /api/wechat/onboard/start`
  - `POST /api/wechat/onboard/poll`
 - 微信公众号官方回调接口
  - `GET /api/wechat/mp/callback`
  - `POST /api/wechat/mp/callback`
- 节点接口
  - `GET /api/nodes`
  - `POST /api/nodes/register`
  - `POST /api/nodes/{node_id}/heartbeat`
  - `PATCH /api/nodes/{node_id}`
  - `POST /api/nodes/{node_id}/pull-task`
  - `POST /api/nodes/{node_id}/task-result`
  - `POST /api/nodes/{node_id}/task-failure`
- 会话接口
  - `GET /api/sessions`
  - `GET /api/sessions/{session_id}`
  - `GET /api/sessions/{session_id}/messages`
- 入站消息接口
  - `POST /api/messages/inbound`

## 本地启动

```bash
cd apps/gateway
python -m venv .venv
.venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload --host 0.0.0.0 --port 8300
```

默认监听 `http://0.0.0.0:8300`。局域网部署时，控制台与节点默认优先使用主机的局域网地址，例如 `http://192.168.1.23:8300`。如果你同时运行 `apps/agent-console` 的 Vite 开发服务器，默认代理地址就是这个端口。

## 与前端联调

```bash
cd apps/agent-console
npm install
npm run dev
```

- 默认开发地址：`http://0.0.0.0:5174`
- Vite 已代理 `/api` 到 `http://localhost:8300`
- 网关也已开放默认 CORS 白名单：`http://127.0.0.1:5174`、`http://localhost:5174`

## 环境变量

所有环境变量使用 `WCH_` 前缀，例如：

- `WCH_REDIS_URL`
- `WCH_DIFY_BASE_URL`
- `WCH_DIFY_API_KEY`
- `WCH_WECHAT_TOKEN`
- `WCH_WECHAT_BASE_URL`
- `WCH_WECHAT_MP_APP_ID`
- `WCH_WECHAT_MP_APP_SECRET`
- `WCH_WECHAT_MP_TOKEN`
- `WCH_WECHAT_MP_ENCODING_AES_KEY`
- `WCH_WECHAT_MP_HTTP_PROXY`
- `WCH_BUILTIN_MODEL_BASE_URL`
- `WCH_BUILTIN_MODEL_API_KEY`
- `WCH_BUILTIN_MODEL_NAME`
- `WCH_CORS_ALLOW_ORIGINS`
- `WCH_NODE_TOKENS`

`WCH_NODE_TOKENS` 需要提供 JSON，例如：

```json
{"node-a":"token-a","node-b":"token-b"}
```

`WCH_CORS_ALLOW_ORIGINS` 同样支持 JSON 数组，例如：

```json
["http://127.0.0.1:5174","http://localhost:5174"]
```

`WCH_WECHAT_MP_HTTP_PROXY` 只作用于公众号官方接口出站请求，例如获取 stable access token 和发送客服消息。使用 frp 暴露回调地址时，如果本机出口 IP 不在公众号 IP 白名单中，可以把它设置为云服务器上的固定出口 HTTP 代理，例如：

```bash
WCH_WECHAT_MP_HTTP_PROXY=http://user:pass@121.41.47.90:3128
```
