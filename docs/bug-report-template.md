# Bug 上报模板

请复制以下模板填写，尽量一次带全，方便快速定位。

## 基本信息

- 提交版本：
- 机器角色：主机 / 节点 / 两边都有
- 操作系统：
- 启动方式：源码启动 / 桌面启动器对照
- 问题首次出现时间：

## 配置摘要（不要贴敏感值）

- 网关地址：
- Node ID：
- 是否启用 discovery：
- 是否启用 pairing key：
- 是否启用本地缓存 Redis：
- transcript / identity / memory / runtime 目录：

## 复现步骤

1.
2.
3.

## 预期结果

-

## 实际结果

-

## 接口与状态快照

- `GET /api/system/status`：
- `GET /api/setup/profile`：
- `GET /api/nodes`：
- `GET /api/sessions`：
- `GET /local/bootstrap/status`（如适用）：

## 日志与产物位置

- 网关日志：
- 节点日志：
- Redis 日志：
- transcript 文件：
- 相关 task_id / session_id / node_id：

## 额外备注

- 是否可稳定复现：
- 是否与某次配置修改/重启有关：
- 其他线索：
