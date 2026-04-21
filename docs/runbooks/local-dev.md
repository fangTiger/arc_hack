# Local Development Runbook

## 1. 前置条件
- Node.js `>= 22`
- npm `>= 11`
- Foundry 已安装
  如当前 shell 里没有 `forge`，先执行：
  `source /Users/captain/.zshenv`

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
默认会使用 `.env.example` 中的 `PAYMENT_MODE=mock`。

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

## 5. 运行 mock demo
```bash
npm run demo:mock
```

生成物默认落在：
- `artifacts/demo-run/call-log.jsonl`
- `artifacts/demo-run/summary.json`

## 6. 运行 mock receipt demo
```bash
npm run demo:receipt:mock
```

这会在 summary 中额外输出 `receiptTxHashes`，并把 `receiptTxHash` 写入 call log。

## 7. 自定义 demo 参数
支持的环境变量：
- `DEMO_ARTIFACT_DIR`
- `DEMO_OPERATIONS`，例如 `summary,entities`
- `RECEIPT_MODE=off|mock|arc`

示例：
```bash
DEMO_OPERATIONS=summary,relations RECEIPT_MODE=mock npm run demo:mock
```
