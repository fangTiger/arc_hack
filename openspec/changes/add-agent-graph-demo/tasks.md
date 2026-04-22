## 1. 实现任务

- [x] 1.1 建立 agent session 数据模型与 artifact store
  Executor: Inner Codex
  目标：定义单次 session 的结果结构、graph 数据结构和文件存储接口，支持按 `sessionId` 读写以及读取最新 session。

- [x] 1.2 建立 CLI 触发的 agent session runner
  Executor: Inner Codex
  目标：新增脚本复用现有付费知识抽取能力，自动调用 `summary`、`entities`、`relations`，输出 `session.json` 并打印可访问的 graph URL。

- [x] 1.3 建立 graph 演示路由与页面
  Executor: Inner Codex
  目标：新增 `/demo/graph/latest` 与 `/demo/graph/:sessionId` 页面，展示摘要、节点、边以及 payment/receipt 证据。

- [x] 1.4 补充测试与文档
  Executor: Inner Codex
  目标：覆盖 session runner、graph store、graph 页面、mock smoke 路径，并补充 README 与 runbook 的 `V2` 使用方式。

- [x] 1.5 完成验证并提交原子变更
  Executor: Outer Codex + Inner Codex
  目标：运行针对性测试、全量测试、构建与 OpenSpec 校验，由主控审查后形成原子提交。
