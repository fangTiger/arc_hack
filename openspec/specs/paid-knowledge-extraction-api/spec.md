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

