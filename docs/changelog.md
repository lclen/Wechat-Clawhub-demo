# Changelog

> **Status**: Active | **Last Updated**: 2026-04-04 | **Purpose**: 记录每次重要修复、功能变更和架构调整

---

## 2026-04-04 — 角色感知 UI 分离 + 节点端独立运行

### 背景

本轮修复解决了节点端（worker_node 角色）与网关端（gateway_host 角色）在同一套前端界面下混用的问题，以及节点 Windows 服务配置读取失败、虚拟网卡 IP 误报等问题。

---

### 前端（agent-console）

#### 角色感知 UI 分离

- **快速配置页**：launcher 面板只在选择角色后才显示，不同角色显示不同安装项
- **接入中心**：网关角色与节点角色完全分离
  - 节点角色隐藏：主网关状态、微信接入、节点纳管、分发模式、扫码接入、手动 Token、本机诊断（内置节点）
  - 节点角色显示：节点说明、连接状态、调试日志
- **launcher 组件列表**：节点角色下过滤掉 `host-redis` 和 `gateway` 组件
- **启动按钮**：节点角色下显示"启动节点服务"，不显示"一键启动"

#### 懒启动架构

- launcher 启动时不再自动拉起任何服务（`auto_restore` 已禁用）
- 前端读取 `launcherStatus.profile.enable_gateway` 决定是否走网关分支
- 节点角色下跳过所有 `/api/*` 轮询，消除 502 日志
- 节点角色下使用 `/local/*` 接口替代 gateway 接口：

| 操作 | 网关角色 | 节点角色 |
|------|---------|---------|
| 节点安装 | `POST /api/setup/node/install` | `POST /local/node/install` |
| 网关探测 | `POST /api/setup/gateway/probe` | `POST /local/gateway/probe` |
| 重置凭据 | `POST /api/setup/node/reset-credentials` | `POST /local/node/reset-credentials` |
| Setup profile | `GET /api/setup/profile` | `GET /local/setup/profile` |
| 重新配置 reset | `POST /api/setup/reset` | 跳过（gateway 不在本机） |

#### 重新配置流程修复

- 停掉所有 launcher 组件（不只是 local-node）
- 清空节点 `.env` 里的 `CLAW_NODE_ID`、`CLAW_GATEWAY_BASE_URL`、`CLAW_PAIRING_KEY`、`CLAW_PAIRING_TRACE_ID`（之前只清 token）
- 重置前端所有表单状态和 localStorage
- 节点角色下跳过微信断开和 gateway reset

---

### 后端（gateway）

#### 全量重置接口

- 新增 `POST /api/setup/reset`，调用 `full_reset()`
- `full_reset()` 清理：内存状态、所有 `node_tokens`、Redis 节点注册表
- 每次 reset 强制写入空的 `WCH_NODE_TOKENS` 到 `.env`，防止重启后残留

#### `reset_worker_node_credentials` 扩展

- 之前只清 `CLAW_NODE_TOKEN`
- 现在同时清：`CLAW_NODE_ID`、`CLAW_GATEWAY_BASE_URL`、`CLAW_PAIRING_KEY`、`CLAW_PAIRING_TRACE_ID`

---

### launcher（desktop-launcher）

#### 新增本地接口

| 接口 | 用途 |
|------|------|
| `GET /local/setup/profile` | 返回基于 launcher profile 的简化 setup profile，供节点角色初始化 |
| `POST /local/gateway/probe` | 直接用 httpx 探测目标网关，不依赖本机 gateway |
| `POST /local/node/install` | 直接调用 `install-claw-node.ps1`，不依赖本机 gateway |
| `POST /local/node/reset-credentials` | 直接清空本地节点 `.env` 配置 |

#### `LauncherProfile` 新增字段

- `enable_gateway: bool = True`：控制是否启动 gateway
- `start_stack` 保存此字段到 profile，`auto_restore` 读取此字段决定是否拉起 gateway

#### 进程管理修复

- `_detect_external_port_conflict`：识别并自动杀掉 launcher 重启后遗留的 `run-gateway` 子进程
- `statuses()`：`enable_gateway=false` 时跳过 gateway 状态检测，显示 `stopped` 而非 `failed`
- `ensureLauncherRuntimeForQuickSetup`：节点角色直接 return，不触发任何 `bootstrap/start`

---

### 节点服务（claw-node）

#### 虚拟网卡 IP 过滤

- `node_identity.py` 新增 `_BENCHMARK_NETWORK = 198.18.0.0/15`
- `is_usable_ipv4()` 过滤此网段，防止 Windows 虚拟网卡（如 Meta、Hyper-V）地址被上报为局域网 IP

---

### 安装脚本（install-claw-node.ps1）

#### 强制更新 Python 源文件

- 即使 bundle hash 未变（`ReuseBundle=true`），也强制从 repo 源码覆盖 `bundle/claw-node/claw_node/*.py`
- 确保代码修复（如 IP 过滤）在重装时立即生效，不依赖重新打包 bundle

#### bundle `.env` fallback

- 安装完成后在 `bundle/claw-node/.env` 写入 `CLAW_ENV_FILE=<config/node.env 路径>`
- 防止 WinSW XML `<env>` 标签失效时节点进程读不到配置

---

### 已知问题与注意事项

> [!IMPORTANT]
> 节点 Windows 服务的 `CLAW_ENV_FILE` 通过 WinSW XML 的 `<env>` 标签注入。如果手动修改了 XML 导致此标签丢失，节点会以空配置启动。此时需要重新安装节点或手动在 `bundle/claw-node/.env` 写入 `CLAW_ENV_FILE=<路径>`。

> [!IMPORTANT]
> 节点角色下 `enable_gateway` 必须为 `false`（存储在 `%APPDATA%\wechat-claw-hub\launcher-state.json`）。如果此值被意外改为 `true`，launcher 会尝试启动 gateway，导致 502。可手动编辑该文件修复。
