# V1 付费知识抽取 API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 交付一个可本地运行、可切换到 Arc/Circle 真实支付、并能通过最小 `UsageReceipt` 合约输出链上凭证的 V1 付费知识抽取 API。

**Architecture:** 后端使用 `Node.js + TypeScript + Express` 承载 API、支付适配层、AI 抽取适配层和演示脚本；合约层使用一个极小的 Solidity `UsageReceipt` 合约记录每次成功调用的链上凭证。支付主路径保持 `Circle Nanopayments + x402`，但本地开发与测试通过 `mock` 模式保证无需外部凭证也能完整运行。

**Tech Stack:** Node.js 25、TypeScript、Express、Vitest、Viem、Circle x402 batching SDK、Foundry（用于 Solidity 合约测试与部署）

---

### Task 1: 初始化服务骨架与测试框架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/config/env.ts`
- Create: `tests/smoke.test.ts`

**Step 1: 写最小冒烟测试**

在 `tests/smoke.test.ts` 中定义应用可导入、健康检查路由存在的失败测试。

**Step 2: 运行失败测试**

Run: `npm test -- --run tests/smoke.test.ts`
Expected: 失败，提示缺少项目配置或应用入口。

**Step 3: 建立 Node/TypeScript/Vitest/Express 基础骨架**

创建项目配置、最小 Express app、`/healthz` 路由与环境变量解析。

**Step 4: 重新运行测试**

Run: `npm test -- --run tests/smoke.test.ts`
Expected: 通过。

**Step 5: 自检**

Run: `npm run build`
Expected: TypeScript 构建通过。

### Task 2: 实现知识抽取领域模型与 provider 抽象

**Files:**
- Create: `src/domain/extraction/types.ts`
- Create: `src/domain/extraction/provider.ts`
- Create: `src/domain/extraction/mock-provider.ts`
- Create: `src/domain/extraction/real-provider.ts`
- Create: `tests/extraction.mock-provider.test.ts`

**Step 1: 写 mock provider 失败测试**

覆盖三类输出：`summary`、`entities`、`relations`，并断言输出结构稳定。

**Step 2: 运行失败测试**

Run: `npm test -- --run tests/extraction.mock-provider.test.ts`
Expected: 失败，提示 provider/types 未实现。

**Step 3: 实现领域类型与 provider 接口**

建立统一请求/响应 schema，并实现确定性的 `mock provider`；`real provider` 先提供受控 stub/适配器外壳。

**Step 4: 重新运行测试**

Run: `npm test -- --run tests/extraction.mock-provider.test.ts`
Expected: 通过。

**Step 5: 做一次重构**

抽出共享 schema 校验和返回构造逻辑，避免三种操作重复拼装。

### Task 3: 实现支付适配层与付费抽取路由

**Files:**
- Create: `src/domain/payment/types.ts`
- Create: `src/domain/payment/mock-payment.ts`
- Create: `src/domain/payment/circle-gateway.ts`
- Create: `src/routes/extract.ts`
- Modify: `src/app.ts`
- Create: `tests/routes.extract.test.ts`

**Step 1: 写抽取路由失败测试**

覆盖：
- 未支付请求返回 `402`
- mock 支付成功后返回结构化结果
- 三个 endpoint 定价固定且低于 `$0.01`

**Step 2: 运行失败测试**

Run: `npm test -- --run tests/routes.extract.test.ts`
Expected: 失败，提示路由或 payment adapter 缺失。

**Step 3: 实现支付抽象与三类 route**

实现 `mock payment` 与 `gateway payment` 抽象；在 `summary/entities/relations` 三个 endpoint 中复用统一定价与响应封装。

**Step 4: 重新运行测试**

Run: `npm test -- --run tests/routes.extract.test.ts`
Expected: 通过。

**Step 5: 做一次重构**

把价格表、请求校验、中间件装配移到独立模块，减少 route 文件复杂度。

### Task 4: 实现调用记录、运营统计与批量 buyer 演示脚本

**Files:**
- Create: `src/store/call-log-store.ts`
- Create: `src/routes/ops.ts`
- Modify: `src/app.ts`
- Create: `src/demo/corpus.ts`
- Create: `scripts/demo-runner.ts`
- Create: `tests/demo-runner.test.ts`

**Step 1: 写批量演示失败测试**

断言批量 runner 能产出固定数量的调用记录、统计摘要以及 requestId 列表。

**Step 2: 运行失败测试**

Run: `npm test -- --run tests/demo-runner.test.ts`
Expected: 失败，提示 demo runner/store 缺失。

**Step 3: 实现日志存储、统计接口与批量 runner**

实现本地 JSON/JSONL 产物写入、`/ops/stats` 读取与批量运行脚本；保证每次成功调用生成稳定 `requestId`。

**Step 4: 重新运行测试**

Run: `npm test -- --run tests/demo-runner.test.ts`
Expected: 通过。

**Step 5: 验证整合**

Run: `npm test`
Expected: 当前 Node 测试套件全部通过。

### Task 5: 实现 UsageReceipt 合约与 receipt 写链集成

**Files:**
- Create: `foundry.toml`
- Create: `contracts/src/UsageReceipt.sol`
- Create: `contracts/test/UsageReceipt.t.sol`
- Create: `contracts/script/DeployUsageReceipt.s.sol`
- Create: `src/domain/receipt/writer.ts`
- Modify: `scripts/demo-runner.ts`
- Create: `tests/receipt.writer.test.ts`

**Step 1: 写 contract 与 writer 的失败测试**

包括：
- 合约能记录 `requestId`、操作类型、调用摘要哈希
- Node 侧 writer 在 mock 模式下能返回伪 `txHash`
- demo runner 在 receipt 模式开启时会为每次成功调用追加 receipt 结果

**Step 2: 运行失败测试**

Run: `forge test`
Expected: 合约测试失败。

Run: `npm test -- --run tests/receipt.writer.test.ts`
Expected: Node writer 测试失败。

**Step 3: 实现最小 UsageReceipt 合约与 writer**

合约只做事件/最小存储，不承载支付结算；Node writer 支持 `mock` 与 `arc` 两种模式；demo runner 在成功调用后写 receipt。

**Step 4: 重新运行测试**

Run: `forge test`
Expected: 通过。

Run: `npm test -- --run tests/receipt.writer.test.ts`
Expected: 通过。

**Step 5: 验证联动**

Run: `npm test`
Expected: Node 测试继续通过，未破坏前序功能。

### Task 6: 补全文档与交付验证

**Files:**
- Create: `README.md`
- Create: `docs/runbooks/local-dev.md`
- Create: `docs/runbooks/arc-circle-demo.md`
- Modify: `openspec/changes/add-paid-knowledge-extraction-api/tasks.md`
- Modify: `.codex/session-state.md`

**Step 1: 写文档缺口清单**

明确需要覆盖的主题：
- mock 模式启动
- Circle Gateway 环境变量
- Arc receipt 合约部署
- 批量运行与证据导出
- “为何逐笔链上支付不经济”的说明

**Step 2: 完成运行文档**

把本地启动、真实模式配置、合约部署、演示命令、产物路径写清楚。

**Step 3: 运行最终验证**

Run: `npm test`
Expected: 通过。

Run: `npm run build`
Expected: 通过。

Run: `forge test`
Expected: 通过。

Run: `npm run demo:mock`
Expected: 生成演示产物与统计摘要。

**Step 4: 回填任务状态**

将本 change 的 `tasks.md` 对应条目标记为完成，并把关键验证结果写入文档或会话状态。
