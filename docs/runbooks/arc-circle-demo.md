# Arc / Circle Demo Runbook

![Arc Logo](../pic/logo.png)

## 目标
这份 runbook 解决几件事：
1. 如何把 `UsageReceipt` 合约部署到 Arc
2. 如何让 demo runner 用 `arc receipt` 模式真实写链
3. 如何用真实 gateway buyer 跑通 seller 的 `POST /api/extract/*`
4. 如何把三次真实付费调用组合成 agent graph session 并在页面展示
5. 如何用 live console 录一段更适合答辩的单页演示

## 0. 当前版本边界
- API 本地可运行路径以 `mock payment` 为主
- `gateway` 模式已接入真实 Circle Gateway seller middleware，未付款请求会被官方 middleware 拦截并返回 `402`
- 真实 Arc 写链已经可通过 `ReceiptWriter(mode=arc)` 完成

也就是说：
- “真实链上证据” 当前走 `UsageReceipt`
- “真实 Circle Gateway seller 侧接入” 与 buyer 真实联调都已可单独演示

## 1. 准备环境变量
```bash
export ARC_RPC_URL=\"https://your-arc-rpc.example\"
export ARC_PRIVATE_KEY=\"0xyourprivatekey\"
export CIRCLE_SELLER_ADDRESS=\"0xYourSellerAddress\"
export GATEWAY_BUYER_BASE_URL=\"http://127.0.0.1:3000\"
export GATEWAY_BUYER_PRIVATE_KEY=\"0xyourgatewaybuyerprivatekey\"
export GATEWAY_BUYER_CHAIN=\"arcTestnet\"
export LLM_BASE_URL=\"https://llm.example.com/v1\"
export LLM_MODEL=\"gpt-4.1-mini\"
```

如果要在 app 中切到真实 gateway seller 模式：
```bash
export PAYMENT_MODE=gateway
export CIRCLE_SELLER_ADDRESS=\"0xYourSellerAddress\"
# 可选
export CIRCLE_GATEWAY_NETWORKS=\"eip155:5042002,eip155:84532\"
export CIRCLE_GATEWAY_FACILITATOR_URL=\"https://gateway.example/facilitator\"
export GATEWAY_BUYER_RPC_URL=\"https://rpc.testnet.arc.network\"
export GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT=\"1.0\"
```

如果要让 CLI 打印可访问的 graph 页面链接，可额外设置：
```bash
export GRAPH_BASE_URL=\"http://127.0.0.1:3000\"
```

## 2. 部署 UsageReceipt 合约
先确认 Foundry 可用：
```bash
which forge
forge test
```

部署命令：
```bash
forge script contracts/script/DeployUsageReceipt.s.sol:DeployUsageReceiptScript \
  --rpc-url \"$ARC_RPC_URL\" \
  --private-key \"$ARC_PRIVATE_KEY\" \
  --broadcast
```

记下输出里的合约地址，并设置：
```bash
export USAGE_RECEIPT_ADDRESS=\"0xYourDeployedReceiptAddress\"
```

## 3. 验证 arc receipt 写链
执行：
```bash
RECEIPT_MODE=arc \
DEMO_OPERATIONS=summary \
DEMO_ARTIFACT_DIR=artifacts/receipt-demo \
node --import tsx scripts/demo-runner.ts
```

要求：
- `ARC_RPC_URL` 已设置
- `ARC_PRIVATE_KEY` 已设置
- `USAGE_RECEIPT_ADDRESS` 已设置

成功后，输出 summary 中会包含：
- `requestIds`
- `receiptTxHashes`

同时 `artifacts/receipt-demo/call-log.jsonl` 会记录每次调用对应的 `receiptTxHash`。

## 4. 启动 gateway seller 路径
```bash
PAYMENT_MODE=gateway npm run dev
```

此时调用 `POST /api/extract/*` 且不带支付头，会收到官方 middleware 返回的 `402` 响应，并带有 `PAYMENT-REQUIRED`。

支付成功后，请求会继续进入业务 handler，响应会回传 gateway payment 元数据，调用日志也会记录 `payer`、`network`、`transaction`。

`scripts/demo-runner.ts` 仍然只面向 `mock payment` 与 `receipt` 演示；真实 gateway buyer 走独立脚本。

## 5. 运行真实 gateway buyer
在 seller 启动后，另开一个终端执行：
```bash
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
DEMO_ARTIFACT_DIR=artifacts/gateway-run \
node --import tsx scripts/gateway-buyer-runner.ts
```

关键点：
- buyer 会先做一次自定义 `POST` probe，确认 seller 的 `402` 响应里存在当前链可用的 `GatewayWalletBatched` 选项
- 真正支付仍然只走官方 `GatewayClient.pay()`
- 产物会写入 `artifacts/gateway-run/call-log.jsonl` 与 `artifacts/gateway-run/summary.json`
- 如果 buyer Gateway 余额不足而你又不想手工先充值，可设置 `GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT`

如需在 buyer 成功支付后附加 Arc receipt：
```bash
PAYMENT_MODE=gateway \
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
RECEIPT_MODE=arc \
DEMO_OPERATIONS=summary \
DEMO_ARTIFACT_DIR=artifacts/gateway-run \
node --import tsx scripts/gateway-buyer-runner.ts
```

此时写入顺序为：
1. 先落 buyer `call-log.jsonl`
2. 再把 `receiptTxHash` 回填到对应 requestId
3. 最后写 `summary.json`

## 6. 运行真实 gateway agent graph
在 seller 启动后，另开一个终端执行：
```bash
PAYMENT_MODE=gateway \
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
DEMO_ARTIFACT_DIR=artifacts/agent-graph \
node --import tsx scripts/agent-graph-runner.ts
```

如果需要真实 Arc receipt：
```bash
PAYMENT_MODE=gateway \
GATEWAY_BUYER_BASE_URL=http://127.0.0.1:3000 \
GATEWAY_BUYER_PRIVATE_KEY=0xyourgatewaybuyerprivatekey \
GATEWAY_BUYER_CHAIN=arcTestnet \
RECEIPT_MODE=arc \
DEMO_ARTIFACT_DIR=artifacts/agent-graph \
node --import tsx scripts/agent-graph-runner.ts
```

成功后你会拿到：
- `artifacts/agent-graph/<sessionId>/session.json`
- `artifacts/agent-graph/latest.json`
- `graphUrl`

如果 seller 与 CLI 在同一仓库根目录运行，可直接访问：
- `GET /arc/sd/graph/latest`
- `GET /arc/sd/graph/<sessionId>`

graph 页面现在还会补充展示导入来源 metadata：
- 原始链接 `articleUrl`
- 来源站点 `sourceSite`
- 导入标题
- 导入方式 `importMode`
- 若命中缓存回退，还会显示 `importStatus` / `cachedAt`，并注明 `derived` 仅用于连通性展示

## 6.5 录制 live console
启动 seller 后直接打开：
```bash
http://127.0.0.1:3000/arc/sd/live
```

推荐做法：
- 如果你要录“阶段推进感”，用 `PAYMENT_MODE=mock`
- 如果你要录“真实支付闭环”，用 `PAYMENT_MODE=gateway`
- `gateway` live 页面只保证整体状态和最终证据，不承诺逐步回放每一步 payment

你可以用 live console 展示：
- 左侧输入区的 `文章链接 / 手动文本 / 预置卡片`
- 右侧 `create -> summary -> entities -> relations -> graph` 阶段卡片
- 每步 `requestId / price / paymentTransaction / receiptTxHash`
- 完成后同页出现最终图谱

输入模式说明：
- `文章链接`：只允许白名单来源 `wublock123`、`PANews`、`ChainCatcher`
- `手动文本`：适合现场临时替换 demo 文案
- `预置卡片`：使用本地缓存导入结果，脱网也能演示，适合作为现场兜底

推荐录屏路径：
1. 先用 `预置卡片` 录一段，突出“脱网也能演示”的稳定性。
2. 完成后切到 `GET /arc/sd/graph/latest`，展示来源元数据、`importStatus` / `cachedAt`、可复制字段和可点击原文链接。
3. 如网络稳定，再补一段 `文章链接` 模式，输入白名单新闻 URL，展示导入到图谱的完整路径。

相关产物：
- `artifacts/live-console/<sessionId>/live-session.json`
- `artifacts/live-console/latest.json`
- `artifacts/agent-graph/<sessionId>/session.json`

## 6.8 运行 Arc standards proof runners

如果你要在答辩或代码审阅里补 Arc 官方标准证据，而不是只展示 `UsageReceipt` / gateway 路径，现在有两种入口：

- UI：打开 `http://127.0.0.1:3000/arc/sd/live`，在 `Arc Proof Console` 中触发 `ERC-8004 Agent Proof` 或 `ERC-8183 Job Proof`
- CLI：单独运行 proof runners

```bash
npm run arc:erc8004
npm run arc:erc8183
```

建议先准备：

```bash
export ARC_RPC_URL="https://your-arc-rpc.example"
export ARC_PROOF_CONSOLE_ENABLED="true"
export ARC_AGENT_OWNER_PRIVATE_KEY="0xyouragentownerprivatekey"
export ARC_AGENT_VALIDATOR_PRIVATE_KEY="0xyouragentvalidatorprivatekey"
export ARC_AGENT_METADATA_URI="ipfs://your-agent-metadata"
export ARC_AGENT_VALIDATION_REQUEST_URI="ipfs://your-validation-request"
export ARC_JOB_CLIENT_PRIVATE_KEY="0xyourjobclientprivatekey"
export ARC_JOB_PROVIDER_PRIVATE_KEY="0xyourjobproviderprivatekey"
export ARC_JOB_BUDGET_USDC="1"
export ARC_JOB_DESCRIPTION="Arc Signal Desk proof job"
```

默认输出：

- `artifacts/arc-standards/erc8004-agent.json`
- `artifacts/arc-standards/erc8183-job.json`

对应 API：

- `GET /api/arc/proofs/status`
- `POST /api/arc/proofs/erc8004`
- `POST /api/arc/proofs/erc8183`

你会在 artifact 里拿到：

- ERC-8004: `agentId`、`registrationTxHash`、`reputationTxHash`、`validationRequestTxHash`、`validationResponseTxHash`
- ERC-8183: `jobId`、`budgetAtomic`、`create/setBudget/approve/fund/submit/complete` 各阶段 tx hash、`deliverableHash`、`reasonHash`
- 每笔交易对应的 ArcScan 链接字段

注意：

- proof console 默认关闭；只有显式设置 `ARC_PROOF_CONSOLE_ENABLED=true` 时，UI 按钮和 proof POST API 才允许广播
- runner 不会打印或写入私钥
- proof console 也不会把私钥放进浏览器请求体、HTML、JSON 响应或 status 摘要
- `/api/arc/proofs/status` 会返回 `runEnabled`，方便在 live workbench 中展示当前是否允许执行
- 如果缺少必要环境变量，runner 会在广播前失败
- 测试通过依赖注入 mock `viem` client，不要求本地真实广播
- CLI 与 UI 共用同一套服务端环境变量，现场演示建议先看 `/api/arc/proofs/status` 是否已配置完成

## 6.9 运行 Circle Console proof

Circle Console proof 用来把已部署的 Arc `UsageReceipt` 合约导入 Circle Contracts library，形成 Console 侧可见记录。它不需要 `CIRCLE_ENTITY_SECRET` 或 `KIT_KEY`；当前只需要 Circle API key 与合约地址。

建议先准备：

```bash
export CIRCLE_API_KEY="test-api-key"
export CIRCLE_API_BASE_URL="https://api.circle.com"
export USAGE_RECEIPT_ADDRESS="0xYourReceiptContract"
export CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH="artifacts/circle-console/proof.json"
export CIRCLE_CONSOLE_PROOF_ENABLED="true"
```

CLI：

```bash
npm run circle:console
```

UI：

- 启动 `npm run dev`
- 打开 `http://127.0.0.1:3000/arc/sd/live`
- 在 `Circle Console Proof` 面板点击 `同步 Circle Console`

对应 API：

- `GET /api/circle/console/status`
- `POST /api/circle/console/proof`

默认输出：

- `artifacts/circle-console/proof.json`

你会在 artifact 里拿到：

- `walletCount`
- `contractCount`
- `usageReceiptImportStatus`
- Circle `contractId`
- Arc `contractAddress`
- Circle API `requestIds`

注意：

- proof API 默认关闭；只有显式设置 `CIRCLE_CONSOLE_PROOF_ENABLED=true` 时，UI 按钮和 POST API 才允许执行
- CLI 会读取项目 `.env`，但不会打印或写入 API key
- `CIRCLE_ENTITY_SECRET` 用于 Circle 托管钱包创建/管理，本项目当前 proof 不创建钱包，所以不使用
- `KIT_KEY` 用于前端 App Kit，本项目当前 proof 是服务端 Console API 归因，所以不使用
- 如果 Circle Contracts library 已经有相同 `UsageReceipt` 地址，runner 会跳过重复 import，并记录 `already_imported`

## 7. 推荐的黑客松演示顺序
1. 先演示 `npm run demo:mock`，证明 API / 统计 / 批量调用可运行
2. 再演示 `http://127.0.0.1:3000/arc/sd/live`，优先用 `预置卡片` 录一段逐步推进的单页 live console
3. 再演示 `DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock`，产出 `54` 次成功调用和 `54` 笔 receipt hash，说明 receipt 层如何把调用映射到链上凭证
4. 启动 `PAYMENT_MODE=gateway npm run dev`，展示 seller 返回官方 `402`
5. 再跑真实 buyer：
   `DEMO_ARTIFACT_DIR=artifacts/gateway-run node --import tsx scripts/gateway-buyer-runner.ts`
6. 再跑真实 agent graph：
   `DEMO_ARTIFACT_DIR=artifacts/agent-graph node --import tsx scripts/agent-graph-runner.ts`
7. 最后回到 `http://127.0.0.1:3000/arc/sd/live`，可先展示 `Arc Proof Console` 的 status / 按钮，再补一段 `文章链接` 模式；随后切到 graph 页面展示来源元数据与最终证据
8. 最后切到真实 Arc receipt：
   `RECEIPT_MODE=arc DEMO_ARTIFACT_DIR=artifacts/agent-graph node --import tsx scripts/agent-graph-runner.ts`

## 8. 经济性说明建议
答辩时建议明确区分三类证据：
- `高频调用次数`
- `Gateway/x402 challenge 入口`
- `Arc receipt txHash`
- `agent graph session 页面`

并说明为什么逐笔链上支付不经济：
- 本项目单次收费只有 `$0.003 ~ $0.005`
- 如果每次 API 调用都承担传统逐笔结算成本，利润会迅速被侵蚀
- 因此真实经济主路径应该是纳米支付 / 批量结算，而不是每次都做重型链上支付
