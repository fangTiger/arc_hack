# 变更：add-arc-standards-proof-runners

## Why
当前项目已经具备 `Circle Gateway / x402` 付费 API、agent session、`UsageReceipt` 链上凭证和 live workbench，但“官方 Arc agent 标准”证据仍然偏弱。为了把项目从黑客松 demo 推向更强的 builder 证明包，需要补齐 Arc 文档中明确强调的 ERC-8004 agent identity/reputation/validation 与 ERC-8183 job escrow/settlement 技术路径。

本变更不做录屏、不做营销页、不重开项目，也不改现有 mock / gateway 主路径。它只新增可测试、可运行、可审阅的技术 runner，使同一个主身份可以生成更强的链上贡献证据：agent 注册、reputation/validation、job 创建、USDC escrow、deliverable hash、job completion 和 artifact manifest。

## What Changes
- 新增 Arc standards 常量与最小 ABI：ERC-8004 registry 地址、ERC-8183 AgenticCommerce 地址、Arc Testnet USDC 地址。
- 新增 ERC-8004 runner：使用 Arc Testnet 私钥钱包注册 agent、解析 agentId、写入 reputation、发起并响应 validation，并输出 JSON 证据。
- 新增 ERC-8183 runner：创建 job、设置预算、approve USDC、fund escrow、submit deliverable、complete job、读取最终 job 状态，并输出 JSON 证据。
- 新增脚本入口与 npm scripts，方便从 CLI 运行两条官方标准路径。
- 更新 README / runbook / `.env.example`，说明所需环境变量、输出产物和 ArcScan 证据位置。
- 补充 Vitest 单测，使用依赖注入模拟链上客户端，覆盖 happy path、缺失环境变量和 artifact 输出。

## Non-goals
- 不承诺或暗示官方空投。
- 不实现 App Kit / Unified Balance；该能力作为后续单独 change。
- 不要求本轮真实广播交易，因为真实广播依赖私钥、USDC 余额和外部 RPC。
- 不替换现有 `UsageReceipt` 合约或 Gateway buyer 主路径。

## Impact
- 受影响规范：`paid-knowledge-extraction-api`
- 受影响代码：`src/domain/arc-standards/`、`scripts/`、`tests/`、`README.md`、`docs/runbooks/arc-circle-demo.md`、`.env.example`、`package.json`
