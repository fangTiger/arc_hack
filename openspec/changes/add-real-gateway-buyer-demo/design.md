# 设计：真实 Gateway buyer 演示链路

## 目标
在不破坏现有 `mock demo` 与 seller 路径的前提下，补一条真实 buyer 演示链：
1. seller 使用官方 `createGatewayMiddleware`
2. buyer 使用官方 `GatewayClient.pay()`
3. buyer 对 `POST /api/extract/*` 逐次真实支付
4. buyer 产出自己的调用日志与 summary
5. 如配置了 receipt writer，则在支付成功后补写 receipt 证据

## 架构决策

### 1. buyer SDK 选型
- 直接使用 `@circle-fin/x402-batching/client` 的 `GatewayClient`
- 不手写 `PAYMENT-SIGNATURE` 编码
- 不自己实现签名逻辑或 x402 协商状态机

### 2. POST 探测策略
官方 `GatewayClient.supports(url)` 只发 `GET`，与当前 `POST /api/extract/*` 契约不兼容。

因此 buyer 运行器在批量支付前先执行一次自定义 POST 探测：
- 向目标接口发送未支付的 `POST` 请求
- 期望收到 `402`
- 校验存在 `PAYMENT-REQUIRED`
- 解析并记录 `accepts` 中是否存在当前链可用的 `GatewayWalletBatched` 选项

探测仅用于演示前检查；真实支付仍交给 `GatewayClient.pay()`

### 3. buyer 运行器
新增一个独立脚本，例如 `scripts/gateway-buyer-runner.ts`，负责：
- 读取 buyer 相关环境变量
- 计算本次演示预估总价
- 查询 buyer 的 wallet / gateway 余额
- 如 `gateway.available` 不足且配置了自动充值额度，则调用 `deposit()`
- 按语料、操作类型和重复次数执行 `pay()`
- 写出 `call-log.jsonl` 与 `summary.json`

### 4. 证据产物
buyer 产物目录与现有 mock demo 分离，默认写入 `artifacts/gateway-run/`

调用日志复用现有 JSONL 风格，至少记录：
- `requestId`
- `operation`
- `price`
- `paymentMode=gateway`
- `paymentStatus=paid`
- `paymentAmount`
- `paymentTransaction`
- `paymentNetwork`
- `receiptTxHash`（如果启用 receipt）

summary 至少包含：
- `totalRuns`
- `successCount`
- `requestIds`
- `paymentTransactions`
- `balances.before`
- `balances.after`
- `deposit`（如发生）

### 5. 环境变量
新增 buyer 侧运行配置：
- `GATEWAY_BUYER_BASE_URL`
- `GATEWAY_BUYER_PRIVATE_KEY`
- `GATEWAY_BUYER_CHAIN`
- `GATEWAY_BUYER_RPC_URL`（可选）
- `GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT`（可选）

已有变量继续沿用：
- `DEMO_OPERATIONS`
- `DEMO_REPEAT_COUNT`
- `RECEIPT_MODE`
- `ARC_RPC_URL`
- `USAGE_RECEIPT_ADDRESS`
- `ARC_PRIVATE_KEY`

## 非目标
- 不做 seller 进程管理
- 不做跨链 withdraw 流程
- 不做 buyer UI
- 不做自动调用 `searchTransfers()` 追踪历史账单

## 风险与缓解

### 1. 测试无法触达真实链
通过依赖注入或 mock `GatewayClient`，保证自动化测试覆盖 buyer 编排逻辑；真实链联调通过 runbook 单独执行。

### 2. buyer 余额不足
允许配置自动 `deposit()`，并在 summary 中明确记录充值结果；若未配置自动充值，则给出清晰报错。

### 3. `supports()` 不支持 POST
通过自定义 POST 探测解决接口契约不匹配问题，但不替代真实支付流程。
