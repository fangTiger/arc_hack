# paid-knowledge-extraction-api Specification

## Purpose
TBD - created by archiving change add-paid-knowledge-extraction-api. Update Purpose after archive.
## Requirements
### Requirement: 付费知识抽取接口
系统 MUST 提供以单次请求计费的知识抽取接口，并在支付成功后返回结构化结果。

#### Scenario: 未支付请求被要求付款
- **当** 调用方向任一知识抽取接口发送未附带有效支付凭证的请求
- **则** 系统返回 `402 Payment Required`
- **且** 响应中包含该接口的价格与支付要求

#### Scenario: 支付后返回结构化结果
- **当** 调用方向任一知识抽取接口发送附带有效支付凭证的请求
- **则** 系统返回对应的抽取结果
- **且** 返回体包含 `requestId`、`pricedOperation`、`result` 与支付元数据

### Requirement: 支持三种知识抽取操作
系统 MUST 至少支持摘要、实体抽取、关系抽取三种按次计费操作，并保持稳定的输出契约。

#### Scenario: 摘要抽取
- **当** 调用方请求摘要接口
- **则** 系统返回简明摘要
- **且** 不返回与摘要无关的结构字段

#### Scenario: 实体抽取
- **当** 调用方请求实体抽取接口
- **则** 系统返回实体数组
- **且** 每个实体至少包含名称与类型

#### Scenario: 关系抽取
- **当** 调用方请求关系抽取接口
- **则** 系统返回关系数组
- **且** 每条关系至少包含源实体、关系类型与目标实体

### Requirement: 支持本地可运行模式
系统 MUST 支持在无真实链上支付配置、无真实 LLM 密钥时的本地可运行模式，以便开发、测试与演示排练。

#### Scenario: 本地 mock 运行
- **当** 支付模式与 AI 模式均配置为 mock
- **则** 开发者可以在本地启动服务并完成端到端调用
- **且** 自动化测试不依赖外部网络凭证

### Requirement: 支持批量演示证据导出
系统 MUST 提供批量调用能力与可审阅的演示产物，用于展示调用频率、价格和执行结果。

#### Scenario: mock 批量运行演示
- **当** 运营方运行 mock 批量 buyer 脚本
- **则** 系统执行多次付费调用
- **且** 输出包含调用次数、成功率、价格汇总与关键支付信息的演示产物

#### Scenario: 真实 Gateway buyer 运行演示
- **当** 运营方已启动 `PAYMENT_MODE=gateway` 的 seller 服务，并运行基于官方 `GatewayClient` 的 buyer 脚本
- **则** buyer 脚本对 `POST /api/extract/*` 执行真实支付调用
- **且** 输出包含 `requestId`、支付金额、支付交易、调用结果与汇总统计的演示产物
- **且** 如配置了 receipt writer，则演示产物记录对应的 receipt `txHash`

### Requirement: 支持链上 receipt 凭证
系统 MUST 支持将成功的付费调用映射为 Arc 链上的可审阅凭证交易，以降低“至少 50 笔链上交易”要求的交付风险。

#### Scenario: 成功调用写入 receipt
- **当** 批量演示流程中的某次付费调用成功完成
- **则** 系统或其配套脚本向 Arc 上的 `UsageReceipt` 合约提交一笔凭证交易
- **且** 演示产物中记录该调用与 receipt `txHash` 的对应关系

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

