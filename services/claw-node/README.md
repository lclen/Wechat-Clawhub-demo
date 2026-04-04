# claw-node

`claw-node` 是 `wechat-claw-hub` 的 Windows 工作节点服务。

当前职责：

- 向主网关注册节点
- 定时发送心跳
- 定时拉取任务
- 调用 Dify 或 OpenAI 兼容模型
- 将结果或失败回传给主网关

推荐运行模型：

- 开发调试：`python -m claw_node.main`
- 正式运行：通过 `scripts/install-claw-node.ps1` 安装成 Windows 服务，由服务长期托管
- 固定配置文件：`<install-dir>/config/node.env`
- 固定诊断目录：`<install-dir>/diagnostics`

启动入口：

```bash
python -m claw_node.main
```

常用环境变量：

- `CLAW_MODEL_PROVIDER=auto|dify|openai`
- `CLAW_ENV_FILE`
- `CLAW_DIAGNOSTICS_DIR`
- `CLAW_SERVICE_MODE`
- `CLAW_SERVICE_NAME`
- `CLAW_DIFY_BASE_URL`
- `CLAW_DIFY_API_KEY`
- `CLAW_OPENAI_BASE_URL`
- `CLAW_OPENAI_API_KEY`
- `CLAW_OPENAI_MODEL`
- `CLAW_NODE_ADVERTISED_HOST`
- `CLAW_NODE_ADVERTISED_PORT`
- `CLAW_NODE_HOSTNAME`

节点启动时会自动探测本机 `hostname` 和局域网 IPv4，并在注册/心跳时把以下信息上报给主网关：

- `hostname`
- `lan_ip`
- `advertised_address`

如果自动探测拿到的地址不符合你的局域网部署方式，可以通过 `CLAW_NODE_ADVERTISED_HOST` 和 `CLAW_NODE_ADVERTISED_PORT` 手动覆盖。

节点诊断会落盘记录最近一次 `pair / register / heartbeat` 结果，便于本机管理器和网关控制台同时查看同一条链路。
