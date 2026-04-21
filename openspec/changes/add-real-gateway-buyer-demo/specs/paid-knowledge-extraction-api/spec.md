## MODIFIED Requirements

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

### Requirement: 提供部署与演示文档
系统 MUST 提供从本地运行到 Arc/Circle 真实配置的部署与演示文档。

#### Scenario: 按文档配置真实 buyer 演示
- **当** 新成员按照项目文档准备 seller 与 buyer 所需环境变量
- **则** 可以启动 `PAYMENT_MODE=gateway` 的 seller 服务
- **且** 可以使用官方 buyer SDK 对知识抽取接口完成真实支付调用
- **且** 可以根据文档确认余额、充值、支付结果与 receipt 证据
