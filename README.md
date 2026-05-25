# WeChat Claw Hub - 微信 AI 网关与多节点调度系统

> 将微信接入 AI 的完整解决方案：多用户并发接入、上下文隔离、多节点负载均衡、人工接管。

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://react.dev/)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D.svg)](https://redis.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## 项目简介

WeChat Claw Hub 是一个面向微信接入场景的**分布式 AI 网关系统**，旨在解决以下核心问题：

- **多用户并发接入**：多个微信用户同时连接到同一个 AI Agent
- **上下文隔离**：每个用户拥有独立的对话上下文和记忆
- **多节点负载均衡**：消息智能分发到多个 Claw 节点处理
- **人工接管**：用户要求转人工时，网页坐席台可接管会话

## 架构亮点

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  微信用户 A  │     │  微信用户 B  │     │  微信用户 C  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  API Gateway │
                    │  (FastAPI)   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼──────┐ ┌──▼──────┐
       │  Claw Node 1│ │ Node 2  │ │ Node 3  │
       │  (Python)   │ │(Python) │ │(Python) │
       └─────────────┘ └─────────┘ └─────────┘
```

### 核心特性

| 特性 | 说明 |
|------|------|
| 多租户隔离 | 每个微信用户独立上下文，互不干扰 |
| 智能分发 | 基于节点负载和健康状态的负载均衡 |
| 实时通信 | WebSocket 推送消息，毫秒级延迟 |
| 上下文缓存 | Redis 持久化会话状态，支持快速恢复 |
| 人工接管 | 完整的 handoff 机制，坐席台无缝接管 |
| 节点发现 | UDP 广播自动发现局域网内可用节点 |
| 可视化控制台 | React 前端，实时监控会话和节点状态 |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **网关后端** | Python 3.11 + FastAPI | 高性能异步 API 网关 |
| **状态存储** | Redis 7+ | 会话上下文、节点状态、身份主档 |
| **前端控制台** | React 18 + Vite | 实时监控、配置管理、会话观察 |
| **工作节点** | Python 3.11 + FastAPI | 可水平扩展的 Claw 处理节点 |
| **桌面启动器** | Python + PyInstaller | Windows 一体化部署工具 |

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

### 3. 配置模型

网关支持任何 OpenAI 兼容的模型服务：

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

## 项目结构

```
wechat-claw-hub/
├── apps/
│   ├── gateway/              # FastAPI 网关服务
│   │   ├── app/
│   │   │   ├── main.py       # 入口和路由注册
│   │   │   ├── sessions.py   # 会话管理
│   │   │   ├── nodes.py      # 节点调度
│   │   │   └── wechat.py     # 微信接入处理
│   │   └── .env.example      # 环境变量模板
│   ├── agent-console/        # React 控制台前端
│   │   ├── src/
│   │   │   ├── App.tsx       # 主应用组件
│   │   │   ├── components/   # UI 组件
│   │   │   └── hooks/        # 自定义 Hooks
│   │   └── package.json
│   └── desktop-launcher/     # Windows 桌面启动器
├── services/
│   └── claw-node/            # 工作节点服务
├── docs/                     # 文档
├── scripts/                  # 构建和部署脚本
└── README.md
```

## 核心功能演示

### 微信扫码接入

1. 在控制台「接入中心」生成专属二维码
2. 微信扫码后自动完成配对
3. 消息实时同步到 AI Agent

### 会话观察台

- 查看所有活跃会话
- 实时聊天时间线（WebSocket 推送）
- 会话绑定节点和槽位信息
- 会话记忆抽屉（上下文快照）

### 节点管理

- 自动发现局域网内可用节点
- 实时监控节点健康状态和负载
- 手动触发节点切换
- 分发模式开关（主机处理 vs 仅分发）

## 部署架构

### 单机开发模式

```
本地机器
├── Redis (localhost:6379)
├── Gateway (localhost:8300)
├── Agent Console (localhost:5174)
└── Local Claw Node (可选)
```

### 多节点生产模式

```
服务器 A（主机）
├── Redis
├── Gateway
└── Agent Console

服务器 B（节点 1） ─┐
                    ├── 局域网 UDP 发现
服务器 C（节点 2） ─┘    + Pairing Key 配对
```

## 环境变量说明

完整配置项参考 `apps/gateway/.env.example`：

| 变量 | 说明 | 必填 |
|------|------|------|
| `WCH_REDIS_URL` | Redis 连接地址 | 是 |
| `WCH_DEFAULT_AGENT_ID` | 默认 Agent 标识 | 是 |
| `WCH_BUILTIN_MODEL_*` | AI 模型配置 | 推荐 |
| `WCH_WECHAT_*` | 微信接入配置 | 接入微信必填 |
| `WCH_DISPATCH_MODE_ENABLED` | 是否启用分发模式 | 否 |
| `WCH_NODE_TOKENS` | 节点 Token 配置 | 多节点必填 |

## 常见问题

### Q: 支持哪些 AI 模型？

任何 OpenAI 兼容的模型都可以使用，包括但不限于：
- 通义千问（DashScope）
- Ollama 本地模型
- OpenAI
- 其他兼容接口

### Q: 可以只接入微信，不调用 AI 吗？

可以。不配置模型时，网关只做消息转发，你可以自定义处理逻辑。

### Q: 如何在生产环境部署？

推荐使用 Docker 或 systemd 服务管理，详细部署文档见 `docs/` 目录。

### Q: 节点如何扩展？

在同一局域网内部署多个 `claw-node`，网关会通过 UDP 广播自动发现并纳管。

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
