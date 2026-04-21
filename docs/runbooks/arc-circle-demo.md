# Arc / Circle Demo Runbook

## 目标
这份 runbook 解决两件事：
1. 如何把 `UsageReceipt` 合约部署到 Arc
2. 如何让 demo runner 用 `arc receipt` 模式真实写链

## 0. 当前版本边界
- API 本地可运行路径以 `mock payment` 为主
- `gateway` 模式当前已能返回 x402 风格的 `402 Payment Required` 响应结构
- 真实 Arc 写链已经可通过 `ReceiptWriter(mode=arc)` 完成

也就是说：
- “真实链上证据” 当前走 `UsageReceipt`
- “真实 Circle Gateway 验签/清算闭环” 还处在接口外壳阶段，后续可继续补强

## 1. 准备环境变量
```bash
export ARC_RPC_URL=\"https://your-arc-rpc.example\"
export ARC_PRIVATE_KEY=\"0xyourprivatekey\"
export CIRCLE_SELLER_ADDRESS=\"0xYourSellerAddress\"
export LLM_BASE_URL=\"https://llm.example.com/v1\"
export LLM_MODEL=\"gpt-4.1-mini\"
```

如果要在 app 中切到 gateway challenge 外壳：
```bash
export PAYMENT_MODE=gateway
```

## 2. 部署 UsageReceipt 合约
先确认 Foundry 可用：
```bash
source /Users/captain/.zshenv
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

## 4. 启动 gateway challenge 外壳
```bash
PAYMENT_MODE=gateway npm run dev
```

此时调用 `POST /api/extract/*` 且不带支付头，会收到 `402` 响应，包含：
- `x402Version`
- `accepts`
- `payTo`
- 微支付金额

这可用于演示 API 已切到 x402 风格的收费入口。

## 5. 推荐的黑客松演示顺序
1. 先演示 `npm run demo:mock`，证明 API / 统计 / 批量调用可运行
2. 再演示 `DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock`，产出 `54` 次成功调用和 `54` 笔 receipt hash，说明 receipt 层如何把调用映射到链上凭证
3. 最后切到真实 Arc receipt：
   `RECEIPT_MODE=arc DEMO_OPERATIONS=summary DEMO_ARTIFACT_DIR=artifacts/receipt-demo node --import tsx scripts/demo-runner.ts`

## 6. 经济性说明建议
答辩时建议明确区分三类证据：
- `高频调用次数`
- `Gateway/x402 challenge 入口`
- `Arc receipt txHash`

并说明为什么逐笔链上支付不经济：
- 本项目单次收费只有 `$0.003 ~ $0.005`
- 如果每次 API 调用都承担传统逐笔结算成本，利润会迅速被侵蚀
- 因此真实经济主路径应该是纳米支付 / 批量结算，而不是每次都做重型链上支付
