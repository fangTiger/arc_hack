# Paid Knowledge Extraction API

基于 `Arc + USDC + x402/Circle Nanopayments` 题设设计的 Demo。当前版本覆盖两条演示路径：
- 付费知识抽取 API：`summary` / `entities` / `relations`
- 批量 demo runner：走 `402 -> 付款 -> 重试` 的 app 级 buyer 流程，可批量生成调用记录与统计摘要
- 真实 gateway buyer runner：使用官方 `GatewayClient.pay()` 对 seller 的 `POST /api/extract/*` 做真实 HTTP 支付
- agent session runner：自动串行执行 `summary`、`entities`、`relations` 三次付费工具调用
- graph 演示页面：`GET /demo/graph/latest` 与 `GET /demo/graph/:sessionId`
- `UsageReceipt` 合约：为成功调用补充 Arc 侧 receipt 凭证

## 当前能力
- `AI_MODE=mock|real` 两种抽取模式都可切换
- `mock payment` 路径可本地完整运行
- `gateway` 模式已接入官方 `createGatewayMiddleware({ sellerAddress })` seller 路径，路由会在支付成功后继续进入业务 handler
- buyer 真实联调走独立脚本 `scripts/gateway-buyer-runner.ts`，产物默认写入 `artifacts/gateway-run/`
- agent graph 产物固定写入 `artifacts/agent-graph/<sessionId>/session.json`
- graph 页面直接读取本地 artifact，不引入额外前端构建
- 可选 `CIRCLE_GATEWAY_NETWORKS` 与 `CIRCLE_GATEWAY_FACILITATOR_URL` 用于本地或测试环境缩小 gateway 入口范围
- `mock receipt` 与 `arc receipt` writer 都已接好接口
- 默认调用日志与 `/ops/stats` 共用 `artifacts/demo-run/call-log.jsonl`

## 快速开始
```bash
npm install --package-lock=false
npm test -- --run
npm run build
npm run demo:mock
```

如果要跑本地 agent graph 闭环：
```bash
npm run dev
npm run demo:agent:mock
```

CLI 结束时会打印：
- `sessionId`
- `artifactPath`
- `graphUrl`

默认页面入口：
```bash
http://127.0.0.1:3000/demo/graph/latest
```

如果要直接生成 `50+` 次调用与 `50+` 笔 mock receipt 证据：
```bash
DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock
```

如果要跑真实 gateway buyer：
```bash
PAYMENT_MODE=gateway npm run dev
npm run demo:gateway:buyer
```

如果要跑真实 gateway agent graph：
```bash
PAYMENT_MODE=gateway npm run dev
npm run demo:agent:gateway
```

## 关键路径
- 本地开发：见 [docs/runbooks/local-dev.md](/Users/captain/python/arc_hack/docs/runbooks/local-dev.md)
- Arc/Circle 演示与合约部署：见 [docs/runbooks/arc-circle-demo.md](/Users/captain/python/arc_hack/docs/runbooks/arc-circle-demo.md)

## 重要说明
- 运行时会自动读取项目根目录的 `.env`
- 当前默认启动是 `PAYMENT_MODE=mock`、`AI_MODE=mock`
- `AI_MODE=real` 需要配置 `LLM_BASE_URL`、`LLM_MODEL`，可选 `LLM_API_KEY`
- receipt 合约已可本地测试，并可通过 Foundry script 部署到 Arc
- 真实 gateway buyer 需要 `GATEWAY_BUYER_BASE_URL`、`GATEWAY_BUYER_PRIVATE_KEY`、`GATEWAY_BUYER_CHAIN`
- agent graph CLI 可选读取 `AGENT_SOURCE_TYPE`、`AGENT_SOURCE_TITLE`、`AGENT_SOURCE_TEXT`、`GRAPH_BASE_URL`
- 如 buyer Gateway 余额不足，可配置 `GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT`
