## ADDED Requirements

### Requirement: 支持 CLI 触发的 Agent 会话
系统 MUST 提供一个 CLI 触发的 agent 风格工作流，围绕单条文本自动调用摘要、实体抽取、关系抽取三个按次计费工具，并输出可审阅的单次 session 产物。

#### Scenario: mock 模式下生成 agent session
- **当** 运营方在 `PAYMENT_MODE=mock` 或等效本地模式下运行 agent session CLI
- **则** 系统自动执行 `summary`、`entities`、`relations` 三次工具调用
- **且** 输出包含输入文本、三类抽取结果、每次调用证据与 graph 数据的 `session` 产物

#### Scenario: gateway 模式下生成真实付费 agent session
- **当** 运营方已启动 `PAYMENT_MODE=gateway` 的 seller 服务，并运行 agent session CLI
- **则** 系统对三个工具接口执行真实付费调用
- **且** session 产物记录每次调用的 `requestId`、支付交易、价格与可选 receipt `txHash`

### Requirement: 支持知识图谱演示页面
系统 MUST 提供基于单次 agent session 产物的网页展示页面，直观呈现摘要、节点、边以及支付证据。

#### Scenario: 查看最新 session 的图谱页面
- **当** 演示者访问最近一次 agent session 的 graph 页面
- **则** 系统展示该 session 的摘要、实体节点、关系边和支付摘要
- **且** 页面包含每次工具调用的关键证据字段

#### Scenario: 按 sessionId 查看历史图谱页面
- **当** 演示者访问指定 `sessionId` 的 graph 页面
- **则** 系统读取对应 session 产物并渲染页面
- **且** 若 session 不存在则返回 `404`

## MODIFIED Requirements

### Requirement: 提供部署与演示文档
系统 MUST 提供从本地运行到 Arc/Circle 真实配置的部署与演示文档。

#### Scenario: 按文档配置真实 buyer 演示
- **当** 新成员按照项目文档准备 seller 与 buyer 所需环境变量
- **则** 可以启动 `PAYMENT_MODE=gateway` 的 seller 服务
- **且** 可以使用官方 buyer SDK 对知识抽取接口完成真实支付调用
- **且** 可以根据文档确认余额、充值、支付结果与 receipt 证据

#### Scenario: 按文档运行 agent graph 演示
- **当** 新成员按照项目文档运行 agent session CLI 并访问 graph 页面
- **则** 可以生成单次 agent session 产物
- **且** 可以通过 graph 页面查看抽取结果与每步 payment/receipt 证据
