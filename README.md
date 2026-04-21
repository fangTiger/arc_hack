# Paid Knowledge Extraction API

基于 `Arc + USDC + x402/Circle Nanopayments` 题设设计的 V1 Demo。当前版本先把最小可运行闭环做扎实：
- 付费知识抽取 API：`summary` / `entities` / `relations`
- 批量 demo runner：可批量生成调用记录与统计摘要
- `UsageReceipt` 合约：为成功调用补充 Arc 侧 receipt 凭证

## 当前能力
- `mock` 模式可本地完整运行
- `gateway` 模式已提供 x402 风格的 `402` 要求响应外壳
- `mock receipt` 与 `arc receipt` writer 都已接好接口

## 快速开始
```bash
npm install --package-lock=false
npm test -- --run
npm run build
npm run demo:mock
```

## 关键路径
- 本地开发：见 [docs/runbooks/local-dev.md](/Users/captain/python/arc_hack/docs/runbooks/local-dev.md)
- Arc/Circle 演示与合约部署：见 [docs/runbooks/arc-circle-demo.md](/Users/captain/python/arc_hack/docs/runbooks/arc-circle-demo.md)

## 重要说明
- 当前默认启动是 `PAYMENT_MODE=mock`
- `gateway` 模式目前主要用于展示真实 x402 challenge 结构，后续可继续补强真实 Circle Gateway 验签与清算逻辑
- receipt 合约已可本地测试，并可通过 Foundry 部署到 Arc
