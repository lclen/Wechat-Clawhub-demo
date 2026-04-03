# Desktop Launcher

Windows 一体化桌面启动器，负责：

- 首次启动向导
- 工作目录选择
- 主机 Redis / 节点缓存 Redis 下载与运行
- 启动网关与本地节点
- 托管现有 `agent-console` 前端并代理 `/api`
- 将“网关兼本机节点”收敛为启动器统一托管模式：本机节点 token 由启动器持久化管理，并在启动时自动停用冲突的本机 Windows 节点服务，避免出现网关 token 与独立安装节点配置漂移

开发运行：

```bash
cd apps/desktop-launcher
python -m venv .venv
.venv\Scripts\activate
pip install -e .[build]
python -m launcher.main
```
