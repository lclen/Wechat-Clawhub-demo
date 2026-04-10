---
name: graphify
description: 把当前代码库或资料目录生成 graphify 知识图谱，并优先基于图谱回答架构问题
trigger: $graphify
---

# $graphify

把任意目录交给 graphify，产出可持续复用的知识图谱、审计报告和查询入口。

适用场景：
- 刚接手一个仓库，先看结构再动代码
- 代码、文档、截图、PDF 混在一起，需要统一理解
- 需要把“为什么这么设计”沉淀为可查询的图

## 默认行为

- 如果用户没有给路径，默认使用当前目录 `.`。
- 保留用户传入的附加参数，例如 `--update`、`--mode deep`、`--no-viz`。
- 优先执行真实命令，不只给口头建议。
- 运行完成后，优先阅读 `graphify-out/GRAPH_REPORT.md`，再回到聊天里总结关键结论。

## 执行步骤

### 1. 确认环境

在 Windows PowerShell 中优先执行：

```powershell
$python = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { throw "Python 未安装或未加入 PATH" }
& $python -m pip install --upgrade graphifyy
```

如果用户要在 Codex 中获得并行抽取能力，提醒检查 `~/.codex/config.toml` 是否开启：

```toml
[features]
multi_agent = true
```

### 2. 安装 Codex 平台集成

在仓库根目录执行：

```powershell
graphify install --platform codex
```

如果仓库已有 `AGENTS.md` 中的 graphify 规则，只需要说明“已存在，无需重复安装”。

### 3. 执行 graphify

根据用户输入拼接命令；如果没有额外参数，默认执行：

```powershell
graphify .
```

常见例子：

```powershell
graphify . --update
graphify . --mode deep
graphify . --no-viz
graphify query "show the auth flow"
graphify path "Gateway" "SessionStore"
```

### 4. 结果收口

运行完成后检查以下产物：

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/graph.html`

如果 `GRAPH_REPORT.md` 存在：
- 读取并总结 `God Nodes`
- 读取并总结 `Surprising Connections`
- 读取并总结 `Suggested Questions`

如果报告不存在但命令成功：
- 告知用户实际生成了哪些文件
- 指出下一步最值得做的是打开 `graphify-out/graph.html` 或继续运行一次 `graphify . --update`

## 回答架构问题时的规则

只要仓库里存在 `graphify-out/GRAPH_REPORT.md`，回答架构、模块关系、历史设计意图这类问题前，应先读它，再决定是否回退到原始文件搜索。

优先顺序：
1. `graphify-out/GRAPH_REPORT.md`
2. `graphify-out/wiki/index.md`（如果存在）
3. `graphify-out/graph.json`
4. 原始源码和文档

## 失败处理

- 如果 `graphify` 命令不存在：先安装 `graphifyy`，再重试。
- 如果图谱为空：明确告诉用户“抽取成功但没有形成有效节点”，并建议缩小目录范围或检查 `.graphifyignore`。
- 如果目录过大：建议先对关键子目录运行，例如 `apps/gateway`、`apps/agent-console`、`docs`。

## 面向当前仓库的建议

这个仓库最值得先图谱化的目录通常是：

```powershell
graphify .\apps\gateway
graphify .\apps\agent-console
graphify .\docs
```

然后再对整个仓库执行一次：

```powershell
graphify .
```
