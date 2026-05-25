# WeChat Claw Hub - 微信 AI 网关与多节点调度系统

> 将微信接入 AI 的完整解决方案：多用户并发接入、上下文隔离、Dify 知识库集成。

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://react.dev/)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D.svg)](https://redis.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## 项目简介

WeChat Claw Hub 是一个面向微信接入场景的**AI 网关系统**，旨在解决以下核心问题：

- **多用户并发接入**：多个微信用户/公众号同时连接到同一个 AI Agent
- **上下文隔离**：每个用户拥有独立的对话上下文和记忆
- **Dify 知识库集成**：统一调用 Dify API 进行知识库问答
- **AI 模型调度**：支持任意 OpenAI 兼容模型，参数可灵活调优

> **版本说明**：本开源版本包含**网关**和**网关+控制台**角色的完整配置能力。多节点分布式调度、工作节点、人工接管等高级功能需联系作者获取商业版本。

## 架构亮点

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  微信用户 A  │     │  微信用户 B  │     │  微信公众号  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  API Gateway │
                    │  (FastAPI)   │
                    └──────┬──────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
│   Dify API  │     │   Redis 7+  │     │ Agent Console│
│  知识库问答  │     │  会话/状态  │     │   (React)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

## 核心特性

### 微信接入

| 特性 | 说明 |
|------|------|
| 多通道支持 | 微信个人号（ilink）+ 微信公众号（官方 API） |
| 扫码接入 | 自动生成专属配对二维码，长轮询确认 |
| 消息收发 | 文本/媒体消息，自动 typing 提示 |
| 公众号能力 | stable access token、IP 白名单、客服消息 |

### AI 模型与知识库

| 特性 | 说明 |
|------|------|
| 多模型支持 | 任何 OpenAI 兼容接口（DashScope、Ollama、OpenAI 等） |
| Dify 集成 | 统一调用 Dify API 进行知识库问答 |
| 模型参数调优 | temperature、top_p、thinking、search 等 |
| 多模态 | 支持图片理解和多模态输入 |

### 实时通信与可视化

| 特性 | 说明 |
|------|------|
| WebSocket 推送 | 会话消息实时更新，毫秒级延迟 |
| 会话观察台 | 查看所有活跃会话、聊天时间线 |
| 配置管理 | 前端配置 Dify、模型、微信参数并即时生效 |
| 连通性检测 | 一键检测模型和网关的连通性 |

## 开源版本角色

当前开源版本支持以下两种角色配置：

| 角色 | 说明 | 适用场景 |
|------|------|------|
| **网关** | 配置微信接入、AI 模型、Dify 知识库 | 单机运行网关，处理所有微信消息 |
| **网关+控制台** | 同时配置网关并校验控制台连接 | 开发调试，前端通过控制台观察会话 |

> **提示**：工作节点（worker_node）和仅控制台（console_only）角色属于分布式多节点调度功能，需联系作者获取完整版本。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **网关后端** | Python 3.11 + FastAPI | 高性能异步 API 网关 |
| **状态存储** | Redis 7+ | 会话上下文、身份主档、transcript |
| **前端控制台** | React 18 + Vite | 实时监控、配置管理、会话观察 |
| **微信公众号** | 官方 API + AES 加密 | 稳定 access token、客服消息 |

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- Redis 7+

### 1. 启动网关

```bash
cd apps/gateway

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装依赖
pip install -e .

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的配置

# 启动网关服务
uvicorn app.main:app --reload --port 8300
```

### 2. 启动前端控制台

```bash
cd apps/agent-console

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5174`

### 3. 配置模型和知识库

网关支持两种 AI 集成方式：

#### 方式一：直接调用 OpenAI 兼容模型

```env
# DashScope（通义千问）
WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
WCH_BUILTIN_MODEL_API_KEY=your-api-key
WCH_BUILTIN_MODEL_NAME=qwen-plus

# 或者使用本地 Ollama
WCH_BUILTIN_MODEL_BASE_URL=http://localhost:11434/v1
WCH_BUILTIN_MODEL_API_KEY=ollama
WCH_BUILTIN_MODEL_NAME=qwen2.5:7b
```

#### 方式二：集成 Dify 知识库

```env
WCH_DIFY_BASE_URL=http://your-dify-server:3000/v1
WCH_DIFY_API_KEY=app-your-dify-api-key
```

配置后，网关会自动将用户消息转发到 Dify 进行知识库问答。

### 4. 接入微信

#### 个人号接入（ilink 平台）

```env
WCH_WECHAT_TOKEN=your-wechat-token
WCH_WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
```

在控制台「接入中心」生成专属二维码，扫码即可完成配对。

#### 公众号接入

```env
WCH_WECHAT_MP_APP_ID=wx75c8444580959962
WCH_WECHAT_MP_APP_SECRET=your-mp-app-secret
WCH_WECHAT_MP_TOKEN=your-mp-token
WCH_WECHAT_MP_ENCODING_AES_KEY=your-encoding-aes-key
```

网关已内置公众号回调接收和消息解密逻辑。

## 项目结构

```
wechat-claw-hub/
├── apps/
│   ├── gateway/              # FastAPI 网关服务
│   │   ├── app/
│   │   │   ├── main.py       # 入口和路由注册
│   │   │   ├── api/routes/   # API 路由
│   │   │   │   ├── sessions.py    # 会话接口
│   │   │   │   ├── wechat.py      # 微信接入接口
│   │   │   │   └── system.py      # 系统状态接口
│   │   │   ├── core/         # 核心配置和生命周期
│   │   │   ├── services/     # 业务服务
│   │   │   │   ├── session_manager.py    # 会话管理
│   │   │   │   ├── setup_service.py      # 配置服务
│   │   │   │   ├── outgoing_dispatcher.py # 消息分发
│   │   │   │   └── redis_store.py        # Redis 存储抽象
│   │   │   ├── models/       # 数据模型
│   │   │   └── access/       # 微信接入层
│   │   │       ├── wechat_bot.py         # 个人号接入
│   │   │       └── wechat_official_account.py # 公众号接入
│   │   └── .env.example      # 环境变量模板
│   └── agent-console/        # React 控制台前端
│       ├── src/
│       │   ├── App.tsx       # 主应用组件
│       │   ├── components/   # UI 组件
│       │   │   └── Workspaces/
│       │   │       ├── Connection/   # 接入中心工作区
│       │   │       └── Sessions/     # 会话观察台
│       │   └── hooks/        # 自定义 Hooks
│       └── package.json
├── scripts/                  # 构建和部署脚本
├── docs/                     # 文档
└── README.md
```

## API 接口

### 系统状态

- `GET /api/system/status` - 网关健康检查

### 模型

- `GET /api/models/builtin/status` - 模型状态
- `POST /api/models/builtin/check` - 模型连通性检测

### 微信接入

- `POST /api/wechat/onboard/start` - 启动扫码接入
- `POST /api/wechat/onboard/poll` - 轮询确认接入状态
- `GET /api/wechat/mp/callback` - 微信公众号回调验证
- `POST /api/wechat/mp/callback` - 微信公众号消息接收

### 会话管理

- `GET /api/sessions` - 会话列表
- `GET /api/sessions/{session_id}` - 会话详情
- `GET /api/sessions/{session_id}/messages` - 会话消息
- `POST /api/messages/inbound` - 接收入站消息

## 部署架构

### 单机开发模式

```
本地机器
├── Redis (localhost:6379)
├── Gateway (localhost:8300)
└── Agent Console (localhost:5174)
```

## 环境变量说明

完整配置项参考 `apps/gateway/.env.example`：

| 变量 | 说明 | 必填 |
|------|------|------|
| `WCH_REDIS_URL` | Redis 连接地址 | 是 |
| `WCH_DEFAULT_AGENT_ID` | 默认 Agent 标识 | 是 |
| `WCH_BUILTIN_MODEL_*` | AI 模型配置（OpenAI 兼容） | 推荐 |
| `WCH_DIFY_*` | Dify 知识库配置 | 可选 |
| `WCH_WECHAT_*` | 微信接入配置 | 接入微信必填 |
| `WCH_WECHAT_MP_*` | 微信公众号配置 | 公众号接入必填 |

## 常见问题

### Q: 支持哪些 AI 模型？

任何 OpenAI 兼容的模型都可以使用，包括但不限于：
- 通义千问（DashScope）
- Ollama 本地模型
- OpenAI API
- 其他兼容接口

### Q: Dify 如何使用？

配置 `WCH_DIFY_BASE_URL` 和 `WCH_DIFY_API_KEY` 后，网关会自动将用户消息转发到 Dify 进行知识库问答。可以与内置模型同时使用。

### Q: 可以只接入微信，不调用 AI 吗？

可以。不配置模型时，网关只做消息转发，你可以自定义处理逻辑。

### Q: 如何在生产环境部署？

推荐使用 Docker 或 systemd 服务管理，详细部署文档见 `docs/` 目录。

### Q: 如何扩展多节点分布式能力？

多节点负载均衡、工作节点自动发现、人工接管等高级功能属于商业版本范围。如需完整功能，请通过 Issue 或仓库联系方式联系作者。

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

## 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

## 交流与反馈

- 提交 [Issue](https://github.com/lclen/Wechat-Clawhub-demo/issues) 报告问题或建议
- 欢迎 Star 和 Fork

---

**WeChat Claw Hub** - 让微信接入 AI 变得简单可控。
