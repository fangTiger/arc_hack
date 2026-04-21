# Arc / Circle Demo Runbook

## 目标
这份 runbook 解决两件事：
1. 如何把 `UsageReceipt` 合约部署到 Arc
2. 如何让 demo runner 用 `arc receipt` 模式真实写链
3. 如何用真实 gateway buyer 跑通 seller 的 `POST /api/extract/*`

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

## 6. 推荐的黑客松演示顺序
1. 先演示 `npm run demo:mock`，证明 API / 统计 / 批量调用可运行
2. 再演示 `DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock`，产出 `54` 次成功调用和 `54` 笔 receipt hash，说明 receipt 层如何把调用映射到链上凭证
3. 启动 `PAYMENT_MODE=gateway npm run dev`，展示 seller 返回官方 `402`
4. 再跑真实 buyer：
   `DEMO_ARTIFACT_DIR=artifacts/gateway-run node --import tsx scripts/gateway-buyer-runner.ts`
5. 最后切到真实 Arc receipt：
   `RECEIPT_MODE=arc DEMO_OPERATIONS=summary DEMO_ARTIFACT_DIR=artifacts/gateway-run node --import tsx scripts/gateway-buyer-runner.ts`

## 7. 经济性说明建议
答辩时建议明确区分三类证据：
- `高频调用次数`
- `Gateway/x402 challenge 入口`
- `Arc receipt txHash`

并说明为什么逐笔链上支付不经济：
- 本项目单次收费只有 `$0.003 ~ $0.005`
- 如果每次 API 调用都承担传统逐笔结算成本，利润会迅速被侵蚀
- 因此真实经济主路径应该是纳米支付 / 批量结算，而不是每次都做重型链上支付
