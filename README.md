# Paid Knowledge Extraction API

基于 `Arc + USDC + x402/Circle Nanopayments` 题设设计的 V1 Demo。当前版本先把最小可运行闭环做扎实：
- 付费知识抽取 API：`summary` / `entities` / `relations`
- 批量 demo runner：走 `402 -> 付款 -> 重试` 的 app 级 buyer 流程，可批量生成调用记录与统计摘要
- `UsageReceipt` 合约：为成功调用补充 Arc 侧 receipt 凭证

## 当前能力
- `AI_MODE=mock|real` 两种抽取模式都可切换
- `mock payment` 路径可本地完整运行
- `gateway` 模式当前提供 x402 风格的 `402` challenge 外壳，真实 Circle Gateway 验签/清算会在下一轮补齐
- `mock receipt` 与 `arc receipt` writer 都已接好接口
- 默认调用日志与 `/ops/stats` 共用 `artifacts/demo-run/call-log.jsonl`

## 快速开始
```bash
npm install --package-lock=false
npm test -- --run
npm run build
npm run demo:mock
```

如果要直接生成 `50+` 次调用与 `50+` 笔 mock receipt 证据：
```bash
DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock
```

## 关键路径
- 本地开发：见 [docs/runbooks/local-dev.md](/Users/captain/python/arc_hack/docs/runbooks/local-dev.md)
- Arc/Circle 演示与合约部署：见 [docs/runbooks/arc-circle-demo.md](/Users/captain/python/arc_hack/docs/runbooks/arc-circle-demo.md)

## 重要说明
- 运行时会自动读取项目根目录的 `.env`
- 当前默认启动是 `PAYMENT_MODE=mock`、`AI_MODE=mock`
- `AI_MODE=real` 需要配置 `LLM_BASE_URL`、`LLM_MODEL`，可选 `LLM_API_KEY`
- receipt 合约已可本地测试，并可通过 Foundry script 部署到 Arc
