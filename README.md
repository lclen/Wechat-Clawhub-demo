# wechat-claw-hub

`wechat-claw-hub` 是一个面向微信接入场景的独立网关服务，用于把多个微信用户统一接入同一个业务 agent，并将消息分发给多个 `Claw` 节点处理。项目首版重点解决四个问题：

- 多个用户同时接入同一个 agent
- 每个用户拥有独立上下文
- 多个 `Claw` 节点按负载进行分发
- 用户要求转人工时，网页坐席台可以接管会话并继续沟通

## 首版定位

首版目标是先打通闭环，而不是一次做成完整运营平台。第一阶段主要覆盖：

- 微信扫码接入
- 消息统一进入网关
- Redis 持久化上下文和会话状态
- 按用户维度隔离上下文
- 节点健康检查与负载均衡分发
- 统一调用 Dify API 进行知识库问答
- 人工独占接管与网页坐席台回复

## 推荐技术栈

- 后端：Python 3.11+ + FastAPI
- 状态与上下文：Redis + 持久化
- 人工坐席台：Web 前端，通过 HTTP + WebSocket 与网关通信
- 微信接入：参考 OpenAkita 的微信扫码 onboarding 和 `WeChatAdapter` 抽象
- 节点调度：网关统一维护多个 `Claw` 节点状态
- 知识库：统一调用 Dify API

## 目录结构

```text
wechat-claw-hub/
  README.md
  docs/
    prd.md
  apps/
    gateway/
    agent-console/
    desktop-launcher/
  services/
  infra/
  scripts/
```

## 当前阶段产物

当前仓库初始化阶段只要求先落文档，不实现业务代码：

- `README.md`
- `docs/prd.md`

当前已经具备的基础产物：

- `apps/gateway`：主网关 FastAPI 骨架、会话、节点、分发接口
- `apps/agent-console`：React 控制台，可检测模型连通性、生成微信二维码并做连接测试
- `apps/desktop-launcher`：Windows 一体化桌面启动器，可托管控制台、下载 Redis、选择单一工作目录并一键拉起核心组件
- `services/claw-node`：Windows 工作节点 Python 服务骨架
- `scripts/build-claw-node-bundle.ps1`：子节点打包脚本
- `scripts/install-claw-node.ps1`：Windows 子节点安装脚本
- `scripts/build-desktop-launcher.ps1`：桌面启动器 EXE 打包脚本
- `docs/windows-node-dispatch-implementation.md`：主从分发与部署实施说明

当前已打通的关键链路：

- 微信扫码接入、长轮询收消息
- 上下文 token 缓存与回传
- 微信端 typing 提示发送
- 多用户接入同一 agent 且按用户隔离上下文
- 网关向多个节点做任务分发
- 分发模式开关：主机可只负责接入与调度，不让本机 `local-node` 参与处理
- 会话级节点槽位分配：同一微信会话会绑定 `node_id + slot_id`
- 微信输入 `/switch` 或 `切换节点` 后，可在同一主会话内切换到新的处理节点/槽位
- 前端会话观察台查看 transcript、节点、会话记忆抽屉
- 接入中心查看已接入节点、节点 ID、上报地址、平台、版本、负载
- `claw-node` 自动探测并上报 hostname、局域网 IP、上报地址
- 网关主机通过 UDP 广播发现局域网节点，并使用独立 pairing key 完成纳管
- Windows 桌面启动器支持主机 Redis + Gateway + Console + 可选本机节点 + 可选节点缓存 Redis 的一键编排

当前已确认的微信接入边界：

- 当前稳定可获取的是 iLink 消息事件中的 `from_user_id`、`message_id`、`session_id`、`context_token` 和文本/媒体消息内容
- 当前未获取到微信号、昵称、备注名、头像等联系人资料
- 前端当前显示的用户标识，本质上是平台返回的 `from_user_id`，不是用户设置的微信号
- 若要展示真实昵称或微信号，需要额外接入联系人信息查询能力或消费新的资料字段

后续开发将继续围绕以下方向推进：

- 微信真实接入
- bot 结果回微信出站
- 人工接管完整闭环
- 坐席台 Web 界面

## 当前数据拓扑

当前桌面一体化方案固定采用：

- **主机中心化存储**：主机 Redis + 主机工作目录是会话主状态、身份主档、长期记忆与节点纳管状态的唯一事实来源
- **节点本地 Redis 可选缓存**：节点若启用本地 Redis，只缓存短期上下文快照或热点结果，不保存正式会话主状态、handoff 状态、身份主档或长期记忆
- **控制台全量视图**：控制台查看所有会话时只依赖主机 Redis 和 transcript，不依赖节点缓存 Redis

桌面启动器选择的“存储库目录”会作为单一工作目录根路径，并创建：

- `data/redis/`
- `data/transcripts/`
- `data/identity/`
- `data/memory/`
- `data/node-cache/<node-id>/redis/`
- `logs/`
- `runtime/`
- `config/`

## 当前可用的本地联调入口

```bash
# 1. 启动网关
cd apps/gateway
python -m venv .venv
.venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload

# 2. 启动前端控制台
cd apps/agent-console
npm install
npm run dev
```

- 网关默认绑定：`http://0.0.0.0:8300`（推荐在同网段使用 `http://<主机局域网IP>:8300` 访问）
- 控制台默认开发地址：`http://0.0.0.0:5174`
- 控制台目前支持：
  - 模型检测、微信二维码生成、扫码轮询、手动 token 连接、断开连接
  - 接入中心查看节点列表、节点状态、上报地址
  - 会话观察台查看会话列表、聊天时间线、会话记忆抽屉
  - 展示当前会话绑定的节点、槽位、路由模式和通道释放状态
  - 手动触发“切换节点”
  - “当前会话”区域右侧打开会话记忆侧边抽屉
  - 快速配置：角色选择（含“网关主机+控制台”组合角色）、远端节点安装、局域网发现与 pairing key 配对、分发模式切换；远端工作节点安装阶段只准备环境，不生成 token，token 会在网关配对成功时自动下发；若当前机器本身就是网关，推荐由桌面启动器直接托管本机 `local-node`

## 当前调度与模型说明

- 网关当前支持两种处理形态：
  - **主机可处理**：本机 `local-node` 也参与接单；推荐由桌面启动器直接托管，不再额外安装独立 Windows 节点服务
  - **主机只分发**：网关仅负责微信接入、会话状态、节点调度与消息出站
- 节点调度基于：
  - 节点健康状态
  - `channel_capacity / channel_in_use`
  - 当前会话亲和的 `assigned_node_id + assigned_slot_id`
- `/switch` 当前已实现为“释放当前槽位并切到新的可用节点/槽位”；现阶段更偏向**受控重分配**，不保证严格随机
- “接入中心 -> 检测模型”当前检测的是**网关内置模型配置**，不是节点模型配置
- 因此可能出现：
  - 节点能正常回复微信消息
  - 但如果网关未配置 `WCH_BUILTIN_MODEL_API_KEY`，模型检测仍会失败

## Windows 一体化 EXE

当前仓库已经提供 Windows 桌面启动器工程与打包脚本，首版面向单机一体化场景：

- 自动下载主机 Redis（支持 GitHub 与国内镜像源）
- 选择单一“存储库目录”作为工作目录
- 一键启动 `主机 Redis + Gateway + Console`
- 可选启动 `Local Claw Node`
  - 该本机节点由启动器统一托管 `node_id / token`
  - 启动时会优先停用冲突的本机 `wechat-claw-node-*` Windows 服务，避免与网关托管节点抢占同一身份
- 可选下载并启动 `节点缓存 Redis`

开发运行：

```bash
cd apps/desktop-launcher
python -m venv .venv
.venv\Scripts\activate
pip install -e .[build]
python -m launcher.main
```

打包 EXE：

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-desktop-launcher.ps1
```

## 双机验证参考

若要按“电脑 A 主机 + 电脑 B 节点”的方式做源码联调，请优先参考：

- `docs/dual-machine-validation-checklist.md`
- `docs/bug-report-template.md`
- `scripts/smoke-check-host.ps1`
- `scripts/smoke-check-node.ps1`

## 当前建议配置

- 网关开发端口：`8300`
- 前端开发端口：`5174`
- 内置模型：DashScope OpenAI Compatible
  - Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - Model: `qwen3.5-plus`

## 已知限制

- 当前节点列表里是否显示真实局域网 IP，取决于节点注册时是否上报真实 `base_url` 或 `hostname`
- 当前示例节点上报的仍可能是类似 `worker://node-local-1` 的逻辑地址，而不是 `192.168.x.x`
- 人工接管闭环、联系人资料获取、坐席权限体系仍未完成
