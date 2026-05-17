# Arc Signal Desk

![Arc Logo](docs/pic/logo.png)

`Arc Signal Desk` is a hackathon demo built for **Agentic Economy on Arc**. It turns AI analysis steps into individually priced actions, so users and agents can pay for exactly the next useful unit of work with `USDC + Circle Nanopayments` settlement on Arc.

[中文](#中文) | [English](#english)

## 中文

### 项目简介

`Arc Signal Desk` 是一个面向智能体经济场景的情报分析工作台。它把一次分析任务拆成多个独立的可付费动作，例如：

- `summary`
- `entities`
- `relations`

用户或上层 agent 提交一段文本、新闻链接或预置线索后，系统会按步骤执行这些工具调用，并把结果收束成一个可阅读、可复核、可追溯的决策界面。

这不是一个“会收费的 API”样品，而是一条完整的 agentic transaction loop：

1. 输入线索
2. 触发按次付费的分析动作
3. 返回结构化结论
4. 展示证据与关系图
5. 可选写入 Arc `UsageReceipt` 链上凭证

### 为什么它贴合本次主题

黑客松主题强调的是：**在亚美分级别的高频交易里，价值交换依然要具备经济可行性。**

`Arc Signal Desk` 正好围绕这个问题来设计：

- **按动作计价**：把 AI 分析拆成细粒度步骤，而不是粗暴按月订阅
- **稳定币原生**：围绕 `USDC` 做计价与结算口径，更接近真实商业模式
- **高频可追溯**：支持批量 demo、agent session、调用日志和链上 receipt
- **人机共用**：既支持浏览器工作台，也支持 agent runner 自动串行调用

### 核心能力

- 付费知识抽取 API：`summary` / `entities` / `relations`
- live workbench：`/arc/sd/live`
- graph 浏览页：`/arc/sd/graph/latest` 与 `/arc/sd/graph/:sessionId`
- whitelist 新闻链接导入：支持受限来源的文章分析
- gateway buyer runner：演示真实 buyer -> seller 的付费链路
- Arc `UsageReceipt` 合约：为成功动作补充链上凭证

### 快速开始

```bash
npm install --package-lock=false
npm test -- --run
npm run build
npm run demo:mock
```

如果要启动本地工作台：

```bash
npm run dev
```

默认入口：

```text
http://127.0.0.1:3000/arc/sd/live
http://127.0.0.1:3000/arc/sd/graph/latest
```

旧的 `/demo/*` 入口仍保留 302 跳转，方便已有录屏脚本或书签平滑迁移。

### 演示路径

本地稳定演示：

```bash
npm run dev
npm run demo:agent:mock
```

生成 mock receipt 证据：

```bash
DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock
```

运行真实 gateway buyer：

```bash
PAYMENT_MODE=gateway npm run dev
npm run demo:gateway:buyer
```

运行真实 gateway agent session：

```bash
PAYMENT_MODE=gateway npm run dev
npm run demo:agent:gateway
```

### Arc standards proof runners

如果你要补充官方标准型链上证据，现在有两条路径：

- UI：启动 `npm run dev` 后，打开 `http://127.0.0.1:3000/arc/sd/live`，在 `Arc Proof Console` 面板里点击 `创建 Agent Proof` 或 `创建 Job Proof`
- CLI：继续使用两条独立 runner

```bash
npm run arc:erc8004
npm run arc:erc8183
```

服务端同时暴露：

- `GET /api/arc/proofs/status`
- `POST /api/arc/proofs/erc8004`
- `POST /api/arc/proofs/erc8183`

注意：proof console 的链上广播默认关闭；只有在服务端显式设置 `ARC_PROOF_CONSOLE_ENABLED=true` 时，UI 和 `POST /api/arc/proofs/*` 才允许执行。`GET /api/arc/proofs/status` 会返回 `runEnabled` 供页面展示当前开关状态。

必需环境变量见 `.env.example`，重点包括：

- `ARC_PROOF_CONSOLE_ENABLED=true`
- `ARC_RPC_URL`
- `ARC_AGENT_OWNER_PRIVATE_KEY`
- `ARC_AGENT_VALIDATOR_PRIVATE_KEY`
- `ARC_AGENT_METADATA_URI`
- `ARC_JOB_CLIENT_PRIVATE_KEY`
- `ARC_JOB_PROVIDER_PRIVATE_KEY`
- `ARC_JOB_BUDGET_USDC`

默认产物：

- `artifacts/arc-standards/erc8004-agent.json`
- `artifacts/arc-standards/erc8183-job.json`

artifact 会保留 `txHash`、`jobId` / `agentId` 和 ArcScan 链接字段，但不会写入私钥。私钥只允许服务端从环境变量读取，不会出现在浏览器请求体、页面 HTML、JSON 响应或 proof status 摘要中。

### Circle Console proof

为了把 Arc 上已部署的 `UsageReceipt` 合约和 Circle Developer Console 账号关联起来，项目提供了 Circle Console proof 路径：

- UI：启动 `npm run dev` 后，打开 `http://127.0.0.1:3000/arc/sd/live`，在 `Circle Console Proof` 面板点击 `同步 Circle Console`
- CLI：运行 `npm run circle:console`

服务端 API：

- `GET /api/circle/console/status`
- `POST /api/circle/console/proof`

必需环境变量：

- `CIRCLE_API_KEY`
- `USAGE_RECEIPT_ADDRESS`
- `CIRCLE_CONSOLE_PROOF_ENABLED=true`，仅 UI / POST API 需要；CLI 可直接运行

默认产物：

- `artifacts/circle-console/proof.json`

这个 runner 会读取 Circle Wallets / Contracts，并在 Contracts library 缺少当前 `UsageReceipt` 时执行 import。artifact 只保存 `walletCount`、`contractCount`、`contractId`、合约地址和 requestId，不保存 API key。`CIRCLE_ENTITY_SECRET` 只在创建/管理 Circle 托管钱包时需要；`KIT_KEY` 是前端 App Kit key，本项目当前 Console proof 不需要它。

### 文档导航

- [Architecture](docs/architecture.md)
- [Product Brief](docs/product-brief.md)
- [Submission Kit](docs/submission-kit.md)
- [Local Dev Runbook](docs/runbooks/local-dev.md)
- [Arc / Circle Demo Runbook](docs/runbooks/arc-circle-demo.md)

### 技术栈

- `Node.js`
- `TypeScript`
- `Express`
- `Arc`
- `USDC`
- `Circle Nanopayments`
- `Circle Gateway`
- `x402`
- `Viem`
- `Foundry`
- `Vitest`

## English

### Overview

`Arc Signal Desk` is an agentic intelligence workbench built for the **Agentic Economy on Arc** hackathon. It turns AI analysis steps into individually priced actions so users and agents can pay for exactly the next useful piece of work.

The project combines:

- paid extraction APIs for `summary`, `entities`, and `relations`
- a live decision desk at `/arc/sd/live`
- a graph browser at `/arc/sd/graph/*`
- optional Arc `UsageReceipt` transactions for extra on-chain evidence

### Why It Fits The Theme

The hackathon is about making sub-cent, high-frequency economic activity viable for users, APIs, and AI agents. Arc Signal Desk is designed around that exact idea:

- **Per-action pricing** instead of coarse subscriptions
- **USDC-native economics** for predictable pricing language
- **Agent-ready workflows** via CLI runners and multi-step sessions
- **Auditable evidence** through logs, session artifacts, and optional receipts

### Quick Start

```bash
npm install --package-lock=false
npm test -- --run
npm run build
npm run demo:mock
```

To launch the desk locally:

```bash
npm run dev
```

Default URLs:

```text
http://127.0.0.1:3000/arc/sd/live
http://127.0.0.1:3000/arc/sd/graph/latest
```

Legacy `/demo/*` URLs still redirect to the branded product routes for old bookmarks and recording scripts.

### Demo Paths

Mock agent session:

```bash
npm run dev
npm run demo:agent:mock
```

Mock receipt evidence:

```bash
DEMO_REPEAT_COUNT=6 npm run demo:receipt:mock
```

Real gateway buyer:

```bash
PAYMENT_MODE=gateway npm run dev
npm run demo:gateway:buyer
```

Real gateway agent session:

```bash
PAYMENT_MODE=gateway npm run dev
npm run demo:agent:gateway
```

### Arc standards proof runners

For official standards-style onchain proof, there are now two paths:

- UI: start `npm run dev`, open `http://127.0.0.1:3000/arc/sd/live`, then use the `Arc Proof Console` buttons
- CLI: keep using the dedicated runners

```bash
npm run arc:erc8004
npm run arc:erc8183
```

The server also exposes:

- `GET /api/arc/proofs/status`
- `POST /api/arc/proofs/erc8004`
- `POST /api/arc/proofs/erc8183`

The proof console is off by default. Set `ARC_PROOF_CONSOLE_ENABLED=true` on the server before using the UI buttons or the proof POST endpoints. `GET /api/arc/proofs/status` also reports `runEnabled` for the live page.

Required environment variables are documented in `.env.example`, especially:

- `ARC_RPC_URL`
- `ARC_AGENT_OWNER_PRIVATE_KEY`
- `ARC_AGENT_VALIDATOR_PRIVATE_KEY`
- `ARC_AGENT_METADATA_URI`
- `ARC_JOB_CLIENT_PRIVATE_KEY`
- `ARC_JOB_PROVIDER_PRIVATE_KEY`

### Circle Console proof

To bind the deployed Arc `UsageReceipt` contract to the Circle Developer Console account:

- UI: start `npm run dev`, open `http://127.0.0.1:3000/arc/sd/live`, then use the `Circle Console Proof` button
- CLI: run `npm run circle:console`

Server APIs:

- `GET /api/circle/console/status`
- `POST /api/circle/console/proof`

Required env vars:

- `CIRCLE_API_KEY`
- `USAGE_RECEIPT_ADDRESS`
- `CIRCLE_CONSOLE_PROOF_ENABLED=true` for UI / POST execution

The default artifact is `artifacts/circle-console/proof.json`. It stores non-secret proof data such as Wallets / Contracts counts, Circle contract id, contract address, and request ids. It never stores the API key. `CIRCLE_ENTITY_SECRET` is only needed for managed wallet flows, and `KIT_KEY` is only needed for frontend App Kit usage.

Default artifacts:

- `artifacts/arc-standards/erc8004-agent.json`
- `artifacts/arc-standards/erc8183-job.json`

The artifacts include tx hashes, `agentId` / `jobId`, and ArcScan links, without persisting private keys. Private keys stay server-side in environment variables and are excluded from browser payloads, HTML, JSON responses, and proof summaries.

### Documentation

- [Architecture](docs/architecture.md)
- [Product Brief](docs/product-brief.md)
- [Submission Kit](docs/submission-kit.md)
- [Local Dev Runbook](docs/runbooks/local-dev.md)
- [Arc / Circle Demo Runbook](docs/runbooks/arc-circle-demo.md)

### Tech Stack

- `Node.js`
- `TypeScript`
- `Express`
- `Arc`
- `USDC`
- `Circle Nanopayments`
- `Circle Gateway`
- `x402`
- `Viem`
- `Foundry`
- `Vitest`
