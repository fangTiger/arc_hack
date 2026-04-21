# V1 付费知识抽取 API 设计

## 目标
`V1` 的目标不是直接做一个完整知识图谱平台，而是先交付一个真实可运行的“付费 AI 文本处理产品核心”。用户提交一段新闻或研报文本后，可以为一次摘要、实体抽取或关系抽取付费。支付层使用 `Arc + USDC + Circle Nanopayments + x402`，抽取层输出稳定 JSON，为后续 `V2 Agent Tool` 和 `V3 知识图谱可视化` 提供统一数据契约。

## 产品边界
输入范围限定为单篇新闻或研报文本。`V1` 不做网页抓取、不做多文档融合、不做知识库索引，也不做实体消歧。这样可以把时间集中在两条最关键的交付链路上：一条是“付费后访问”的经济链路，另一条是“结构化结果可复用”的产品链路。知识图谱本身不作为 `V1` 的验收条件，而是由 `entities + relations` 的稳定输出来为后续版本自然铺路。

## 技术路线
服务层采用 `Node.js + TypeScript + Express`，因为 Circle 官方的 Nanopayments seller/buyer 示例就是这条路径，接入成本最低。系统内部保持两层抽象：`PaymentAdapter` 和 `KnowledgeExtractionProvider`。前者支持 `mock` 与 `gateway` 两种模式，保证本地测试不依赖 Arc/Circle 真实凭证；后者支持 `mock` 与 `real` 两种模式，保证没有模型密钥时也能完整跑通演示。所有调用记录输出到本地演示产物目录，先用 JSON/JSONL 控制复杂度。为了降低“50 笔链上交易”口径风险，`V1` 额外加入一个最小 `UsageReceipt` 合约，由 buyer 在每次成功调用后写入一笔 Arc receipt 交易。

## 验收标准
- 提供 `summary`、`entities`、`relations` 三个付费 endpoint
- 在 `mock` 模式下可本地完整运行并通过测试
- 在 `gateway` 模式下可切到真实 Arc/Circle 支付路径
- 提供批量 buyer 脚本，支持高频调用演示与证据导出
- 提供最小 `UsageReceipt` 合约与写链流程，支持 `50` 次成功调用对应 `50` 笔 Arc receipt 交易
- 提供部署与运行文档，明确真实支付配置步骤、合约部署步骤与风险说明

## 主要风险
最大风险不是 AI 抽取本身，而是 `Nanopayments` 的批量结算与“至少 50 笔链上交易”要求之间可能存在解释差异。`V1` 现在直接纳入最小链上 receipt 证据层，避免把这个风险留到最后。答辩时需要明确区分三类证据：`Gateway transfer`、`Gateway batch settlement`、`Arc receipt transaction`，并解释为什么真实经济主路径仍然应该是批量结算而不是逐笔上链支付。
