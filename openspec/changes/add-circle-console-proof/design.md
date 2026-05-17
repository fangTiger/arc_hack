# Circle Console Proof Design

## 决策

### Circle API proof runner
新增 `src/domain/circle-console/`：

- `parseCircleConsoleEnv(source)` 读取 `CIRCLE_API_KEY`、`CIRCLE_API_BASE_URL`、`USAGE_RECEIPT_ADDRESS`、`CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH`。
- `runCircleConsoleProof(options)` 调用 Circle API：
  - `GET /v1/w3s/wallets` 验证 API key 可用。
  - `GET /v1/w3s/contracts?blockchain=ARC-TESTNET` 读取当前 Circle Contracts library。
  - 如配置 `USAGE_RECEIPT_ADDRESS`，先查找是否已有相同 `contractAddress`；没有则调用 `POST /v1/w3s/contracts/import` 导入 `UsageReceipt`。
- artifact 只包含：`checkedAt`、`walletCount`、`contractCount`、`usageReceiptImportStatus`、`contractId`、`contractAddress`、`requestIds`、`source`。不得写入 `CIRCLE_API_KEY`。

### API 与 UI
新增 `createCircleConsoleRouter`，挂载到 `/api/circle/console`：

- `GET /status` 返回本地配置状态、最近 artifact 摘要，以及 `runEnabled`。
- `POST /proof` 在 `CIRCLE_CONSOLE_PROOF_ENABLED=true` 时运行 proof；默认关闭外部写入，避免误触发 import。

`/arc/sd/live` 增加 Circle Console proof 卡片：

- 显示 API key 是否配置、UsageReceipt 是否可导入、最近 Console artifact。
- 提供“同步 Circle Console”按钮。
- 成功后展示 Circle contract id、合约地址、导入状态、artifact 路径。

### 安全边界
API key 只从服务端环境变量读取。请求体不得接受 `apiKey`、`secret`、`password`、`token` 等字段。所有错误信息必须经过敏感值脱敏。测试环境中默认 service 不触发真实 Circle API。

### 后续阶段
当 `CIRCLE_ENTITY_SECRET` 可用时，再新增 Circle dev-controlled wallet + template deployment runner；当 `KIT_KEY` 可用时，再新增 App Kit Send / Unified Balance proof。
