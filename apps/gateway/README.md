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
uvicorn app.main:app --reload
```

默认监听 `http://127.0.0.1:8000`。如果你同时运行 `apps/agent-console` 的 Vite 开发服务器，默认代理地址就是这个端口。

## 与前端联调

```bash
cd apps/agent-console
npm install
npm run dev
```

- 默认开发地址：`http://127.0.0.1:5174`
- Vite 已代理 `/api` 到 `http://127.0.0.1:8000`
- 网关也已开放默认 CORS 白名单：`http://127.0.0.1:5174`、`http://localhost:5174`

## 环境变量

所有环境变量使用 `WCH_` 前缀，例如：

- `WCH_REDIS_URL`
- `WCH_DIFY_BASE_URL`
- `WCH_DIFY_API_KEY`
- `WCH_WECHAT_TOKEN`
- `WCH_WECHAT_BASE_URL`
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
