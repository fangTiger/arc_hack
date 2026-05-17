# Arc Standards Proof Runners 设计

## 目标
本阶段目标是给 `Arc Signal Desk` 增加两条“官方标准型链上证据”路径：

1. ERC-8004：证明项目不只是自称 agent workflow，而是可以注册 Arc Testnet 上的 agent identity，并形成 reputation / validation 留痕。
2. ERC-8183：证明项目不只是 per-call API，而是可以把一次 agentic work 映射成 job、escrow、deliverable 和 settlement 生命周期。

这两条路径都应以 CLI runner + JSON artifact 为主，不进入 live workbench UI，不扩大前端范围。

## 架构
新增 `src/domain/arc-standards/` 模块，分三层：

- `constants.ts`：Arc Testnet chain、官方合约地址、USDC 地址、explorer URL、状态枚举。
- `erc8004-agent.ts`：纯 TypeScript runner，接收 wallet client / public client / artifact writer 依赖，执行 agent 注册、reputation、validation。
- `erc8183-job.ts`：纯 TypeScript runner，接收 client/provider wallet 和 public client，执行 job lifecycle。

CLI 入口放在 `scripts/`：

- `scripts/erc8004-agent-runner.ts`
- `scripts/erc8183-job-runner.ts`

脚本只负责读取环境变量、创建 viem clients、调用 domain runner、打印 summary。核心逻辑必须留在 `src/domain/arc-standards/`，方便单测。

## 数据流
ERC-8004 runner 输入：

- `ARC_RPC_URL`
- `ARC_AGENT_OWNER_PRIVATE_KEY`
- `ARC_AGENT_VALIDATOR_PRIVATE_KEY`
- `ARC_AGENT_METADATA_URI`
- 可选 `ARC_AGENT_VALIDATION_REQUEST_URI`

输出 `artifacts/arc-standards/erc8004-agent.json`，包含 owner、validator、agentId、metadataUri、registrationTxHash、reputationTxHash、validationRequestTxHash、validationResponseTxHash、requestHash、explorer links。

ERC-8183 runner 输入：

- `ARC_RPC_URL`
- `ARC_JOB_CLIENT_PRIVATE_KEY`
- `ARC_JOB_PROVIDER_PRIVATE_KEY`
- `ARC_JOB_BUDGET_USDC`
- 可选 `ARC_JOB_DESCRIPTION`

输出 `artifacts/arc-standards/erc8183-job.json`，包含 client、provider、jobId、budgetAtomic、budgetUsdc、create/setBudget/approve/fund/submit/complete tx hashes、deliverableHash、reasonHash、finalStatus、explorer links。

## 错误处理
- 缺少必要环境变量时，脚本必须在广播前失败，并明确列出缺失项。
- 不打印私钥或带敏感 query 的 URL。
- 交易失败时保留安全错误信息，不把私钥写入 artifact。
- 若无法从 `Transfer` 或 `JobCreated` event 解析 id，应失败并提示交易 hash，方便人工到 ArcScan 检查。

## 测试策略
- 对 runner 使用依赖注入，mock `writeContract`、`waitForTransactionReceipt`、`getLogs`、`readContract`。
- ERC-8004 测试必须证明：按顺序广播 register / giveFeedback / validationRequest / validationResponse，并写出 agentId 与 tx hashes。
- ERC-8183 测试必须证明：按顺序广播 createJob / setBudget / approve / fund / submit / complete，并写出 completed 状态。
- 环境解析测试覆盖缺失私钥、缺失 RPC、无效预算。
- 运行全量 `npm test -- --run` 与 `npm run build`。

## 风险与控制
- 风险：真实合约 ABI 与文档更新不一致。控制：ABI 只保留本流程用到的最小函数和事件，并在 runbook 中标注来源为 Arc 官方教程。
- 风险：真实运行需要 USDC gas / escrow 余额。控制：脚本提前输出地址和预算；余额不足由链上交易失败显示，不在代码里自动 faucet。
- 风险：引入过大依赖。控制：只用已存在的 `viem`，不新增外部包。
