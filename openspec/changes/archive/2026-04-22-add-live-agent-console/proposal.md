# 变更：add-live-agent-console

## Why
`V2` 已经有 CLI 驱动的 agent session 和 graph 页面，但演示入口仍然偏“开发者脚本 + 结果页”。黑客松答辩和录屏场景更需要一个可以在页面里直接输入文本、点击开始、按步骤展示 `summary -> entities -> relations -> graph` 的伪实时演示台，让评委在一个屏幕里就能看懂“agent 在为机器工具付费调用”这件事。

如果继续把范围扩到 websocket、并发任务调度、历史后台，会明显提高交付风险。`V3` 需要在不改支付主链路的前提下，把已有能力包装成一个录屏友好的现场演示壳：大屏布局、稳定步骤、轮询更新、证据可见、最终图谱可直接展示。为了不和现有 `GatewayBuyer.payBatch()` 契约冲突，`V3` 的逐步伪实时推进以 `mock` 路径为主，`gateway` 路径只要求整体运行完成并展示最终证据。

## What Changes
- 新增一个可在页面输入文本并发起运行的 live console 页面
- 新增 live session 状态模型与后端 API，支持启动、轮询状态、读取最新 session，并在运行中拒绝重复创建
- 抽出可复用的 `src` 层 runner service，供 live route 和 CLI 共用，避免 route 直接依赖 `scripts/`
- 将 agent session runner 扩展为可报告步骤进度，驱动 `mock` 路径下的伪实时展示
- 新增录屏友好的展示文档，明确推荐演示路径

## Impact
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：`src/app.ts`、`src/routes/`、`src/store/`、`src/demo/`、`scripts/`、`tests/`、`README.md`、`docs/runbooks/`
