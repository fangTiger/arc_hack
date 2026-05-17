# 变更：添加 Circle Console proof 与 Contracts 归因

## 为什么
当前项目已经能在 Arc Testnet 上生成 `UsageReceipt`、ERC-8004 agent proof 和 ERC-8183 job proof，但这些证据主要归因到 EVM 钱包与 ArcScan。为了增强 Circle/Arc builder 证明包，还需要把项目主合约和 Circle Developer Console 账号关联起来，并生成可审阅的 Circle API proof artifact。

## 变更内容
- 新增 Circle Console proof runner，使用 `CIRCLE_API_KEY` 调用 Circle API，验证测试 key 可用并读取 Wallets / Contracts 状态。
- 支持将已部署的 `UsageReceipt` 合约导入 Circle Contracts library，形成 Console 侧合约记录；导入前先查询，避免重复导入。
- 新增服务端 API 与 live workbench UI 入口，让操作者可以从界面触发 Circle Console proof。
- 生成 `artifacts/circle-console/proof.json`，只保存非敏感状态、合约 ID、合约地址、API 请求 ID 与时间戳，不保存 API key。
- 更新 `.env.example`、README 与 runbook，说明 `CIRCLE_API_KEY`、可选 `CIRCLE_ENTITY_SECRET` / `KIT_KEY` 的边界。

## 非目标
- 本变更不部署新的 Circle template 合约，因为模板部署需要 `CIRCLE_ENTITY_SECRET` / dev-controlled wallet。
- 本变更不把 API key、Entity Secret 或 Kit Key 放到浏览器请求体、HTML、JSON 响应或 artifact。
- 本变更不自动提交 Grant / Arc House 内容。

## 影响范围
- 受影响规范：`paid-knowledge-extraction-api`
- 受影响代码：`src/domain/*`、`src/routes/*`、`src/app.ts`、`src/routes/live.ts`、`scripts/*`、`tests/*`
- 受影响文档：`.env.example`、`README.md`、`docs/runbooks/arc-circle-demo.md`
