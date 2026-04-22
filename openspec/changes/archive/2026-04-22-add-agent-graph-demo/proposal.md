# 变更：add-agent-graph-demo

## Why
`V1` 已经完成真实 `gateway buyer`、真实 payment 和真实 Arc receipt 证据，但当前产品形态仍然偏“底层 API + 演示脚本”。黑客松下一阶段需要把它提升成更贴题的 `machine pays for machine tools` 故事：由一个 agent 风格的工作流自动调用付费知识抽取工具，并把结果展示成可理解的知识图谱页面。

如果直接跳到完整知识图谱系统，会把范围扩到多文档融合、实体消歧、图数据库和前端状态管理，交付风险明显升高。`V2` 需要在不破坏现有支付主路径的前提下，提供一个可运行、可演示、可验证的“CLI 触发 agent -> 三次付费工具调用 -> 图谱页面展示”闭环。

## What Changes
- 新增一个 CLI 触发的 agent session runner，围绕单条文本自动调用 `summary`、`entities`、`relations`
- 将单次 agent session 输出为结构化产物，记录输入、抽取结果、支付证据与可视化 graph 数据
- 新增网页演示路由，用于展示单次 session 的摘要、节点、边和支付/receipt 证据
- 补充测试、运行脚本与文档，覆盖 `mock` 与 `gateway` 两条主路径

## Impact
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：`src/app.ts`、`src/routes/`、`src/store/`、`scripts/`、`tests/`、`README.md`、`docs/runbooks/`
