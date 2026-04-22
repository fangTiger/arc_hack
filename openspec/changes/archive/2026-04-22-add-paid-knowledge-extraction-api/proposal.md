# 变更：新增付费知识抽取 API（V1）

## 为什么
黑客松提交要求我们交付一个真实可运行的 Arc + USDC + Circle Nanopayments Demo，并清晰展示单次操作定价、交易频率与经济可行性。当前仓库尚无产品实现，必须先定义一个最小但可扩展的 V1。

## 变更内容
- 新增一个基于 `x402 + Circle Nanopayments + Arc` 的付费 API 服务
- 提供 `summary`、`entities`、`relations` 三个知识抽取能力
- 提供批量 buyer 运行器与演示数据，用于生成高频付费调用证据
- 新增一个最小 `UsageReceipt` 合约与写链流程，用于生成可审阅的 Arc 链上调用凭证
- 提供部署、环境配置、演示与验证文档
- 为后续 `V2 Agent Tool 化` 与 `V3 知识图谱可视化` 预留稳定输出契约

## 影响范围
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：新的 Node.js/TypeScript 服务、支付适配层、AI 适配层、批量调用脚本、Solidity 凭证合约、验证文档
- 风险关注：Nanopayments 的批量结算与“至少 50 笔链上交易”要求之间存在解释风险，因此 V1 直接纳入链上 receipt 证据层
