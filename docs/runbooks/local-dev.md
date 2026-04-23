# Local Development Runbook

## 1. 前置条件
- Node.js `>= 22`
- npm `>= 11`
- Foundry 已安装
  如当前 shell 里没有 `forge`，先确认 Foundry 已按官方方式安装并已加入 `PATH`，可用 `which forge` 检查

## 2. 安装依赖
```bash
npm install --package-lock=false
```

## 3. 本地验证
```bash
npm test -- --run
npm run build
npm run test:contracts
```

## 4. 启动 API
运行时会自动读取项目根目录的 `.env`。默认会使用 `.env.example` 中的 `PAYMENT_MODE=mock` 与 `AI_MODE=mock`。

```bash
cp .env.example .env
npm run dev
```

服务启动后可用：
- `GET /healthz`
- `POST /api/extract/summary`
- `POST /api/extract/entities`
- `POST /api/extract/relations`
- `GET /demo/live`
- `POST /demo/live/session`
- `GET /demo/live/session/latest`
- `GET /demo/live/session/:sessionId`
- `GET /demo/graph/latest`
- `GET /demo/graph/:sessionId`
- `GET /ops/stats`

工作台创建契约：
- `POST /demo/live/session` 只接受二选一输入
- 文本模式：`text` + 可选 `title` / `sourceType` / `metadata`
- 链接模式：`articleUrl`
- `text` 与 `articleUrl` 同时出现会返回 `400`
- 两者都缺失会返回 `400`
- 链接模式只允许白名单来源：`wublock123`、`PANews`、`ChainCatcher`

默认情况下，`/ops/stats` 读取 `CALL_LOG_PATH`，其默认值是：
- `artifacts/demo-run/call-log.jsonl`

如果要切到真实 LLM：
- 设置 `AI_MODE=real`
- 设置 `LLM_BASE_URL`
- 设置 `LLM_MODEL`
- 如上游要求鉴权，再设置 `LLM_API_KEY`

如果要切到真实 Circle Gateway seller 路径：
- 设置 `PAYMENT_MODE=gateway`
- 如需 live console 也补写 receipt，设置 `RECEIPT_MODE=arc`
- 设置 `CIRCLE_SELLER_ADDRESS`
- 可选设置 `ARC_EXPLORER_BASE_URL`
- 可选设置 `CIRCLE_GATEWAY_NETWORKS`
- 可选设置 `CIRCLE_GATEWAY_FACILITATOR_URL`

如果要跑真实 gateway buyer：
- 设置 `GATEWAY_BUYER_BASE_URL`
- 设置 `GATEWAY_BUYER_PRIVATE_KEY`
- 设置 `GATEWAY_BUYER_CHAIN`
- 可选设置 `GATEWAY_BUYER_RPC_URL`
- 可选设置 `GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT`

## 5. 运行 mock demo
```bash
npm run demo:mock
```

每次运行前会先清理旧产物。生成物默认落在：
- `artifacts/demo-run/call-log.jsonl`
- `artifacts/demo-run/summary.json`

## 6. 运行 mock receipt demo
```bash
npm run demo:receipt:mock
```

这会在运行前清理 `artifacts/receipt-demo`，并在 summary 中额外输出 `receiptTxHashes`，同时把 `receiptTxHash` 写入 call log。

## 7. 运行 mock agent graph demo
先启动 API：
```bash
npm run dev
```

再在另一个终端执行：
```bash
npm run demo:agent:mock
```

CLI 会打印：
- `sessionId`
- `artifactPath`
- `graphUrl`

产物结构：
- `artifacts/agent-graph/<sessionId>/session.json`
- `artifacts/agent-graph/latest.json`

页面入口：
- `GET /demo/live`
- `GET /demo/graph/latest`
- `GET /demo/graph/<sessionId>`

工作台输入模式：
- `文章链接`：后端会先导入白名单原文，再创建 live session
- `手动文本`：直接提交输入框内容
- `预置卡片`：直接提交本地缓存导入结果，脱网也能演示
- 如果链接导入回退到缓存，live / graph 页面都会显示 `导入状态：缓存回退` 与 `缓存时间`

live session 状态产物：
- `artifacts/live-console/<sessionId>/live-session.json`
- `artifacts/live-console/latest.json`
- 可选 `artifacts/live-console/active.json`

## 8. 自定义 demo 参数
支持的环境变量：
- `DEMO_ARTIFACT_DIR`
- `DEMO_OPERATIONS`，例如 `summary,entities`
- `DEMO_REPEAT_COUNT`
- `RECEIPT_MODE=off|mock|arc`
- `PAYMENT_MODE=mock`
- `AI_MODE=mock|real`
- `AGENT_SOURCE_TYPE=news|research`
- `AGENT_SOURCE_TITLE`
- `AGENT_SOURCE_TEXT`
- `GRAPH_BASE_URL`

示例：
```bash
DEMO_OPERATIONS=summary,relations RECEIPT_MODE=mock npm run demo:mock
```

生成 `54` 次成功调用和 `54` 笔 mock receipt：
```bash
DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock
```

运行自定义 agent graph：
```bash
AGENT_SOURCE_TITLE="Arc expands agent commerce" \
AGENT_SOURCE_TEXT="Arc lets agents pay for machine tools. Circle settles usage with USDC." \
npm run demo:agent:mock
```

## 9. 录制 mock 工作台流程
先启动 API：
```bash
npm run dev
```

然后打开：
```bash
http://127.0.0.1:3000/demo/live
```

页面会：
- 支持在 `文章链接 / 手动文本 / 预置卡片` 三种模式之间切换
- 调用 `POST /demo/live/session`
- 每秒轮询 `GET /demo/live/session/:sessionId`
- 在 `mock` 路径下按 `summary -> entities -> relations` 逐步推进
- 以 `事件总览 -> 关键判断 -> 证据摘录` 的固定主链路展示结果，并在右侧补充 graph 预览与 payment / receipt 证据
- 预置卡片直接使用本地缓存导入结果，不依赖实时抓取远端网页
- 链接模式只接受白名单站点：`wublock123`、`PANews`、`ChainCatcher`
- 完成后跳到 graph 页面时，可看到 `articleUrl`、`sourceSite`、导入标题与 `importMode`，并以辅助关系浏览器方式查看可缩放图谱

推荐录屏路径：
1. 先用 `预置卡片` 录一遍，证明脱网也能稳定运行。
2. 在工作台首屏展示 `事件总览 -> 关键判断 -> 证据摘录` 的连续阅读链，以及失败/重跑时旧结果会保留的行为。
3. 完成后切到 `GET /demo/graph/latest`，展示来源元数据、`importStatus` / `cachedAt` 和 `derived` 连通性说明。
4. 如果现场网络稳定，再补录一条 `文章链接` 模式，使用白名单来源 URL。

边界：
- `GET /demo/live/session/latest` 无命中时固定返回 `404`
- 若已有 `queued` 或 `running` 的 active live session，再次创建会返回 `409` 和当前 `sessionId`
- `active live session` 的定义仅为 `queued` 或 `running`

## 10. 运行真实 gateway buyer demo
先启动 seller：
```bash
PAYMENT_MODE=gateway npm run dev
```

再在另一个终端执行 buyer：
```bash
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
DEMO_ARTIFACT_DIR=artifacts/gateway-run \
node --import tsx scripts/gateway-buyer-runner.ts
```

说明：
- buyer 会先对 `POST /api/extract/*` 做未支付探测，再用官方 `GatewayClient.pay()` 完成真实支付
- buyer 产物固定落在独立目录，例如 `artifacts/gateway-run/call-log.jsonl` 与 `artifacts/gateway-run/summary.json`
- 这不会污染 seller `/ops/stats` 默认读取的 `artifacts/demo-run/call-log.jsonl`
- 如果报错提示 buyer Gateway 余额不足，可设置 `GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT=1.0` 让脚本先自动 `deposit()`

如需同时补写 receipt：
```bash
PAYMENT_MODE=gateway \
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
RECEIPT_MODE=mock \
npm run demo:gateway:buyer
```

## 11. 运行真实 gateway agent graph demo
先启动 seller：
```bash
PAYMENT_MODE=gateway npm run dev
```

再执行：
```bash
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
DEMO_ARTIFACT_DIR=artifacts/agent-graph \
node --import tsx scripts/agent-graph-runner.ts
```

如需附加 receipt：
```bash
PAYMENT_MODE=gateway \
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
RECEIPT_MODE=mock \
npm run demo:agent:gateway
```

## 12. 录制真实 gateway live console
先启动 seller：
```bash
PAYMENT_MODE=gateway RECEIPT_MODE=arc npm run dev
```

再打开：
```bash
http://127.0.0.1:3000/demo/live
```

这里的边界必须明确：
- 页面只保证整体 `queued / running / completed / failed`
- 完成后返回最终 `summary / entities / relations / graph` 与 payment evidence
- 不承诺像 `mock` 一样逐步展示每一步 payment 回调
- 如果 `RECEIPT_MODE=arc` 且 Arc 环境变量完整，完成后会返回真实 `receiptTxHash`
- 如需降低现场网络风险，优先使用 `预置卡片` 模式；它读取的是本地缓存导入结果，不依赖远端新闻站点
