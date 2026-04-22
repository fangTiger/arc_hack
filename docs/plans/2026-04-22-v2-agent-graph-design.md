# V2 Agent Tool + Graph 设计

## 推荐方案
`V2` 采用 `CLI 触发 + 网页展示结果`。这条路径的好处是能最大化复用当前稳定基线：seller、gateway buyer、receipt writer 和演示产物都已经跑通。新阶段不再扩张支付层，而是在支付层之上增加一个轻量 orchestrator 和展示层，把“机器为机器工具付费”的故事讲完整。

## 产品定义
用户通过 CLI 提交一段新闻或研报文本，系统自动发起三次工具调用：摘要、实体抽取、关系抽取。三次调用完成后，产出一个单次 session 文件，里面既包含抽取结果，也包含三次支付和可选 receipt 证据。然后用户可以打开一个 graph 页面，看到本次 session 的摘要、节点、边以及每一步的价格、支付交易、receipt 交易。

## 技术路线
后端继续使用现有 `Express + TypeScript` 单体结构，不新增前端构建工具。CLI 侧新增 `agent session runner`，优先复用现有 buyer 能力，而不是单独再造一套 HTTP client。存储层新增 `agent session store`，把 `session.json` 落在 `artifacts/agent-graph/<sessionId>/`。页面层新增一个演示 route，直接输出 HTML + SVG 视图。这样可以避免前端工程化成本，也方便现场演示时一键启动。

## Session 结构
`session` 至少包含：
- `sessionId`
- 输入标题、来源和原始文本
- `summary`、`entities`、`relations`
- `runs`：三次调用的证据数组
- `graph.nodes` / `graph.edges`
- `totals`：总价、成功次数

这里最关键的是 `runs` 必须能对齐：
- `requestId`
- `paymentTransaction`
- `payloadHash`
- `receiptTxHash`

这样页面不仅有图，还能展示“这张图是三次真实付费调用得来的”。

## 风险控制
本阶段只做单条文本和单次 session，不做多文档融合，不做图数据库，不做实体消歧。页面也不引入外部图库，避免在视觉层消耗太多时间。真正的重点是：让 agent 编排、支付证据和图谱展示形成一个连贯闭环。只要这个闭环成立，`V2` 就已经比单纯的 API Demo 更像一个可答辩的产品。
