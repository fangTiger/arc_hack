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
- `GET /ops/stats`

默认情况下，`/ops/stats` 读取 `CALL_LOG_PATH`，其默认值是：
- `artifacts/demo-run/call-log.jsonl`

如果要切到真实 LLM：
- 设置 `AI_MODE=real`
- 设置 `LLM_BASE_URL`
- 设置 `LLM_MODEL`
- 如上游要求鉴权，再设置 `LLM_API_KEY`

如果要切到真实 Circle Gateway seller 路径：
- 设置 `PAYMENT_MODE=gateway`
- 设置 `CIRCLE_SELLER_ADDRESS`
- 可选设置 `CIRCLE_GATEWAY_NETWORKS`
- 可选设置 `CIRCLE_GATEWAY_FACILITATOR_URL`

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

## 7. 自定义 demo 参数
支持的环境变量：
- `DEMO_ARTIFACT_DIR`
- `DEMO_OPERATIONS`，例如 `summary,entities`
- `DEMO_REPEAT_COUNT`
- `RECEIPT_MODE=off|mock|arc`
- `PAYMENT_MODE=mock`
- `AI_MODE=mock|real`

示例：
```bash
DEMO_OPERATIONS=summary,relations RECEIPT_MODE=mock npm run demo:mock
```

生成 `54` 次成功调用和 `54` 笔 mock receipt：
```bash
DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock
```
