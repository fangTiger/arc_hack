## ADDED Requirements

### Requirement: 支持 Arc 官方 agent identity 证据
系统 MUST 提供一条 ERC-8004 agent proof runner，用于在 Arc Testnet 上注册 agent identity 并输出可审阅的 reputation / validation 证据。

#### Scenario: 运行 ERC-8004 agent proof
- **当** 操作者配置 Arc RPC、owner 私钥、validator 私钥和 agent metadata URI
- **则** runner 向 Arc Testnet 的 ERC-8004 IdentityRegistry 提交 agent 注册交易
- **且** runner 记录 agentId、metadata URI、registration tx hash 与 ArcScan 链接
- **且** runner 继续提交 reputation feedback 与 validation request/response
- **且** runner 输出不含私钥的 JSON artifact

#### Scenario: ERC-8004 环境变量缺失
- **当** 操作者未配置必要的 Arc RPC、owner 私钥、validator 私钥或 metadata URI
- **则** runner 在广播交易前失败
- **且** 错误信息列出缺失项但不泄露任何已有私钥值

### Requirement: 支持 Arc 官方 job escrow / settlement 证据
系统 MUST 提供一条 ERC-8183 job lifecycle runner，用于在 Arc Testnet 上创建 job、设置预算、fund escrow、提交 deliverable hash、完成结算并输出可审阅证据。

#### Scenario: 运行 ERC-8183 job lifecycle proof
- **当** 操作者配置 Arc RPC、client 私钥、provider 私钥和 USDC 预算
- **则** runner 在 AgenticCommerce 参考合约上创建 job
- **且** runner 设置预算、approve USDC、fund escrow、submit deliverable、complete job
- **且** runner 读取最终 job 状态并确认达到 `Completed`
- **且** runner 输出包含各阶段 tx hash、jobId、budget、deliverableHash、reasonHash 和 ArcScan 链接的 JSON artifact

#### Scenario: ERC-8183 预算无效
- **当** 操作者配置的预算为空、非数字或小于等于 0
- **则** runner 在广播交易前失败
- **且** 错误信息说明预算必须是正数 USDC

### Requirement: 支持 Arc standards proof artifact 文档化
系统 MUST 在 README 和 Arc/Circle runbook 中说明如何运行 ERC-8004 与 ERC-8183 技术证据路径。

#### Scenario: 新成员按文档准备 proof run
- **当** 新成员阅读项目文档
- **则** 可以找到 ERC-8004 与 ERC-8183 所需环境变量
- **且** 可以找到对应 npm scripts
- **且** 可以找到 artifact 输出路径与 ArcScan 链接字段说明
