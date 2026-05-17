# Arc Standards Proof Runners Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Arc Signal Desk 增加 ERC-8004 agent identity 与 ERC-8183 job settlement 两条官方标准型链上证据 runner。

**Architecture:** 业务逻辑进入 `src/domain/arc-standards/`，CLI 只做环境解析与调用。runner 使用依赖注入，测试通过 mock viem client 验证交易顺序、artifact 输出和错误处理。

**Tech Stack:** TypeScript, Node.js, Viem, Vitest, OpenSpec.

---

## Context

当前项目已有 Gateway/x402、agent session、UsageReceipt 和文档。新能力不改现有 payment 主路径，不做录屏，不新增依赖。官方合约与函数来自 Arc Docs：

- ERC-8004 IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- ERC-8004 ValidationRegistry: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`
- ERC-8183 AgenticCommerce: `0x0747EEf0706327138c69792bF28Cd525089e4583`
- Arc Testnet USDC: `0x3600000000000000000000000000000000000000`

## Task 1: Arc Standards 基础模块

**Files:**
- Create: `src/domain/arc-standards/constants.ts`
- Create: `src/domain/arc-standards/abi.ts`
- Create: `src/domain/arc-standards/artifacts.ts`
- Test: `tests/arc-standards.artifacts.test.ts`

**Step 1: Write failing tests**

测试 `buildArcScanTxUrl()`、artifact writer 会创建目录并写 JSON、私钥字段不会出现在 artifact 类型输入中。

Run: `npm test -- --run tests/arc-standards.artifacts.test.ts`
Expected: FAIL because modules do not exist.

**Step 2: Implement constants / ABI / artifact helper**

导出常量、最小 ABI、`writeJsonArtifact(path, value)`。只保留本 change 使用的 ABI。

**Step 3: Verify**

Run: `npm test -- --run tests/arc-standards.artifacts.test.ts`
Expected: PASS.

## Task 2: ERC-8004 Agent Proof Runner

**Files:**
- Create: `src/domain/arc-standards/erc8004-agent.ts`
- Create: `scripts/erc8004-agent-runner.ts`
- Test: `tests/erc8004-agent-runner.test.ts`

**Step 1: Write failing tests**

覆盖：
- 缺失 `ARC_RPC_URL` / owner key / validator key / metadata URI 时失败且不泄密。
- happy path 按顺序调用 `register`、`giveFeedback`、`validationRequest`、`validationResponse`。
- 从 mock Transfer log 解析 `agentId`，输出 tx hash 和 explorer links。

Run: `npm test -- --run tests/erc8004-agent-runner.test.ts`
Expected: FAIL because runner does not exist.

**Step 2: Implement runner**

实现 `parseErc8004AgentEnv(source)` 和 `runErc8004AgentProof(options)`。CLI 从 env 构建 viem clients，默认输出 `artifacts/arc-standards/erc8004-agent.json`。

**Step 3: Verify**

Run: `npm test -- --run tests/erc8004-agent-runner.test.ts`
Expected: PASS.

## Task 3: ERC-8183 Job Lifecycle Runner

**Files:**
- Create: `src/domain/arc-standards/erc8183-job.ts`
- Create: `scripts/erc8183-job-runner.ts`
- Test: `tests/erc8183-job-runner.test.ts`

**Step 1: Write failing tests**

覆盖：
- 缺失 env 或预算无效时广播前失败。
- happy path 按顺序调用 `createJob`、`setBudget`、USDC `approve`、`fund`、`submit`、`complete`。
- 从 mock `JobCreated` log 解析 `jobId`，读取 final job，artifact 标记 `Completed`。

Run: `npm test -- --run tests/erc8183-job-runner.test.ts`
Expected: FAIL because runner does not exist.

**Step 2: Implement runner**

实现 `parseErc8183JobEnv(source)` 和 `runErc8183JobProof(options)`。预算使用 USDC 6 decimals，默认 `1` USDC。CLI 默认输出 `artifacts/arc-standards/erc8183-job.json`。

**Step 3: Verify**

Run: `npm test -- --run tests/erc8183-job-runner.test.ts`
Expected: PASS.

## Task 4: Docs and Scripts

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/runbooks/arc-circle-demo.md`
- Modify: `openspec/specs/paid-knowledge-extraction-api/spec.md` only during archive, not now

**Step 1: Write docs/script expectations**

Add scripts:

```json
"arc:erc8004": "node --import tsx scripts/erc8004-agent-runner.ts",
"arc:erc8183": "node --import tsx scripts/erc8183-job-runner.ts"
```

Document required env vars and output paths.

**Step 2: Verify**

Run: `npm run build`
Expected: PASS.

Run: `npx openspec validate add-arc-standards-proof-runners --strict --no-interactive`
Expected: PASS.

Run: `npm test -- --run`
Expected: PASS.

## File Allowlist

- `openspec/changes/add-arc-standards-proof-runners/**`
- `docs/plans/2026-05-17-arc-standards-proof-runners.md`
- `src/domain/arc-standards/**`
- `scripts/erc8004-agent-runner.ts`
- `scripts/erc8183-job-runner.ts`
- `tests/arc-standards.artifacts.test.ts`
- `tests/erc8004-agent-runner.test.ts`
- `tests/erc8183-job-runner.test.ts`
- `package.json`
- `package-lock.json` only if npm changes it; no new dependency expected
- `.env.example`
- `README.md`
- `docs/runbooks/arc-circle-demo.md`

## Review Gates

- Worker must show RED then GREEN evidence for each new test file.
- Reviewer must check no private keys are logged or written.
- Reviewer must check docs match scripts and env names.
- Outer Codex runs final build, tests, and OpenSpec validation.
