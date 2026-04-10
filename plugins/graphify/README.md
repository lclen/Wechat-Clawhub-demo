# Graphify Plugin

这个目录提供一个 repo-local Codex plugin 壳子，内部封装了基于 [graphify](https://github.com/safishamsi/graphify) 的 skill。

## 目录说明

- `.codex-plugin/plugin.json`: 插件元数据
- `skills/graphify/SKILL.md`: Codex 调用说明
- `scripts/install-graphify-codex.ps1`: Windows 安装和集成脚本

## 推荐用法

在仓库根目录执行：

```powershell
.\plugins\graphify\scripts\install-graphify-codex.ps1
graphify .
```

如果你只是想让 Codex 在这个项目中优先参考图谱，也可以直接使用：

```powershell
graphify install --platform codex
```
