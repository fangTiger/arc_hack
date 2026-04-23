# Paid Knowledge Extraction API

基于 `Arc + USDC + x402/Circle Nanopayments` 题设设计的 Demo。当前版本覆盖两条演示路径：
- 付费知识抽取 API：`summary` / `entities` / `relations`
- 批量 demo runner：走 `402 -> 付款 -> 重试` 的 app 级 buyer 流程，可批量生成调用记录与统计摘要
- 真实 gateway buyer runner：使用官方 `GatewayClient.pay()` 对 seller 的 `POST /api/extract/*` 做真实 HTTP 支付
- agent session runner：自动串行执行 `summary`、`entities`、`relations` 三次付费工具调用
- graph 演示页面：`GET /demo/graph/latest` 与 `GET /demo/graph/:sessionId`
- live console 页面：`GET /demo/live`，支持“文章链接 / 手动文本 / 预置卡片”三种输入模式，并同页展示 live session 阶段、证据和最终图谱
- `UsageReceipt` 合约：为成功调用补充 Arc 侧 receipt 凭证

## 当前能力
- `AI_MODE=mock|real` 两种抽取模式都可切换
- `mock payment` 路径可本地完整运行
- `gateway` 模式已接入官方 `createGatewayMiddleware({ sellerAddress })` seller 路径，路由会在支付成功后继续进入业务 handler
- buyer 真实联调走独立脚本 `scripts/gateway-buyer-runner.ts`，产物默认写入 `artifacts/gateway-run/`
- agent graph 产物固定写入 `artifacts/agent-graph/<sessionId>/session.json`
- live console 状态固定写入 `artifacts/live-console/<sessionId>/live-session.json`
- graph 页面直接读取本地 artifact，不引入额外前端构建；如 source metadata 存在，会展示 `articleUrl`、`sourceSite`、导入标题、`importMode`、`importStatus` 与 `cachedAt`，并说明 `derived` 仅用于连通性展示
- 白名单新闻来源导入目前只支持 `wublock123`、`PANews`、`ChainCatcher`
- 预置新闻卡片使用本地缓存导入结果，脱网也能演示
- 可选 `CIRCLE_GATEWAY_NETWORKS` 与 `CIRCLE_GATEWAY_FACILITATOR_URL` 用于本地或测试环境缩小 gateway 入口范围
- `mock receipt` 与 `arc receipt` writer 都已接好接口
- 默认调用日志与 `/ops/stats` 共用 `artifacts/demo-run/call-log.jsonl`
- `mock` live 路径按 `summary -> entities -> relations` 逐步推进；`gateway` live 路径只保证整体状态和最终证据

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
http://127.0.0.1:3000/demo/live
http://127.0.0.1:3000/demo/graph/latest
```

live console 当前支持：
- `文章链接`：提交白名单站点原文链接，后端先导入再创建 session
- `手动文本`：直接提交本地文本
- `预置卡片`：提交缓存好的新闻文本与 metadata，不依赖实时抓取远端网页
- 当链接导入命中缓存回退时，页面会显示 `导入状态：缓存回退` 与 `缓存时间`

如果要录制 live console：
```bash
npm run dev
open http://127.0.0.1:3000/demo/live
```

说明：
- 推荐录屏路径：先点一次预置卡片证明脱网可演示，再切到 graph 页面展示来源元数据、`importStatus` / `cachedAt` 和 `derived` 说明，最后补一条白名单链接模式
- `PAYMENT_MODE=mock` 时，页面会逐步展示 `summary -> entities -> relations`
- `PAYMENT_MODE=gateway` 时，页面只保证整体状态和最终证据，不承诺逐步 payment 回调
- 若已有 `queued` 或 `running` 的 live session，再次创建会返回 `409` 和当前 `sessionId`

如果要直接生成 mock receipt 证据：
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
- `ARC_EXPLORER_BASE_URL` 默认为 `https://testnet.arcscan.app`，用于页面里的链上跳转链接
- `AI_MODE=real` 需要配置 `LLM_BASE_URL`、`LLM_MODEL`，可选 `LLM_API_KEY`
- `RECEIPT_MODE=mock|arc` 时，`/demo/live` 和 agent graph session 都会尝试补写 receipt；`RECEIPT_MODE=arc` 需要 `ARC_RPC_URL`、`ARC_PRIVATE_KEY`、`USAGE_RECEIPT_ADDRESS`
- receipt 合约已可本地测试，并可通过 Foundry script 部署到 Arc
- 真实 gateway buyer 需要 `GATEWAY_BUYER_BASE_URL`、`GATEWAY_BUYER_PRIVATE_KEY`、`GATEWAY_BUYER_CHAIN`
- agent graph CLI 可选读取 `AGENT_SOURCE_TYPE`、`AGENT_SOURCE_TITLE`、`AGENT_SOURCE_TEXT`、`GRAPH_BASE_URL`
- 如 buyer Gateway 余额不足，可配置 `GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT`
- live session latest 无命中时固定返回 `404`
