# Trusted Research Workbench Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `/demo/live` 从偏 demo 的 live console 重构为比赛版“可信投研工作台”页面。

**Architecture:** 保持现有 live session API 与轮询机制不变，优先重构 live 页面主区结构与展示文案。数据层先使用现有 `summary / entities / relations / metadata / runs` 派生出事件卡、判断卡、证据区和凭证区，不先引入新的后端持久化模型。

**Tech Stack:** Express 路由内联 HTML/CSS/JS、TypeScript、Vitest

---

### Task 1: 锁定工作台页面骨架

**Files:**
- Modify: `tests/routes.live.test.ts`
- Modify: `src/routes/live.ts`

**Step 1: Write the failing test**

为 live console 页面新增断言，要求页面包含：
- `可信投研工作台`
- `事件总览`
- `关键判断`
- `证据摘录`
- `分析凭证`
- `辅助关系图`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes.live.test.ts`

**Step 3: Write minimal implementation**

在 `src/routes/live.ts` 中补充新的页面标题、版块文案与基础结构。

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/routes.live.test.ts`

### Task 2: 派生事件卡与判断卡数据

**Files:**
- Modify: `tests/routes.live.test.ts`
- Modify: `src/routes/live.ts`

**Step 1: Write the failing test**

为 live 完成态新增断言，要求页面能展示：
- 事件类型或事件标签
- 关键结论卡
- 核心主体
- 证据摘录

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes.live.test.ts`

**Step 3: Write minimal implementation**

在 `src/routes/live.ts` 中基于现有 session 数据派生展示字段，优先保证 mock / gateway 都能回落到稳定文案。

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/routes.live.test.ts`

### Task 3: 重构视觉层级并保留辅助图

**Files:**
- Modify: `src/routes/live.ts`

**Step 1: Write the failing test**

复用前两步测试，不新建额外行为测试。

**Step 2: Write minimal implementation**

重构布局为：
- 左侧输入
- 中间主区：事件总览 / 关键判断 / 证据摘录
- 右侧侧栏：核心主体 / 分析凭证 / 辅助关系图

**Step 3: Run focused verification**

Run: `npm test -- tests/routes.live.test.ts`

### Task 4: 回归与构建

**Files:**
- Modify: `openspec/changes/add-trusted-research-workbench/tasks.md`
- Modify: `README.md` 或 `docs/runbooks/local-dev.md`（如必要）

**Step 1: Run relevant tests**

Run: `npm test -- tests/routes.live.test.ts tests/routes.graph.test.ts tests/agent-graph-runner.test.ts tests/news-import.test.ts`

**Step 2: Run full build**

Run: `npm run build`

**Step 3: Validate OpenSpec**

Run: `openspec validate add-trusted-research-workbench --strict --no-interactive`

**Step 4: Mark tasks complete**

更新 `openspec/changes/add-trusted-research-workbench/tasks.md`
