# Desktop Launcher

Windows 一体化桌面启动器，负责：

- 首次启动向导
- 工作目录选择
- 主机 Redis / 节点缓存 Redis 下载与运行
- 启动网关与本地节点
- 提供本地控制面 API（`/local/*`），供 `agent-console` 开发前端代理调用
- 将“网关兼本机节点”收敛为统一的“安装器/管理器 + Windows 服务”模型：
  - 启动器只负责安装、重启、查看状态、导出诊断
  - 本机节点后端固定由 Windows 服务长期运行
  - 节点固定配置路径：`runtime/local-node-service/config/node.env`
  - 节点固定诊断目录：`runtime/local-node-service/diagnostics`

开发运行：

```bash
cd apps/desktop-launcher
python -m venv .venv
.venv\Scripts\activate
pip install -e .[build]
python -m launcher.main
```

开发态端口约定：

- 用户前端入口固定为 `http://127.0.0.1:5174`（开发模式，Vite dev server）
- 生产模式前端入口为 `http://127.0.0.1:8765`（由启动器直接托管 `agent-console/dist`）
- 启动器监听 `http://127.0.0.1:8765`，同时提供本地 API（`/local/*`、`/api/*`）和前端静态文件
