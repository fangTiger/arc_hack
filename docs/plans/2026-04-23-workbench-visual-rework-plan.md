# Workbench Visual Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `/demo/live` 从旧演示页延续样式重构为结果优先的情报分析台，并修复浏览器端“服务端已完成但页面仍停留在分析中”的终态同步问题。

**Architecture:** 主要在 `src/routes/live.ts` 内重写页面结构、样式和前端交互，继续复用 `live-workbench.ts` 的结果建模能力；通过在轮询链路增加快照新鲜度和终态优先保护来修复前端卡住问题，并用现有 route/view-model 测试覆盖布局语义与终态回归。

**Tech Stack:** Express SSR HTML、内联 CSS/JS、Vitest、OpenSpec

---

### Task 1: 收口设计与测试边界

**Files:**
- Modify: `openspec/changes/add-trusted-research-workbench/proposal.md`
- Modify: `openspec/changes/add-trusted-research-workbench/design.md`
- Modify: `openspec/changes/add-trusted-research-workbench/tasks.md`
- Modify: `openspec/changes/add-trusted-research-workbench/specs/paid-knowledge-extraction-api/spec.md`
- Modify: `.codex/session-state.md`

**Step 1: 将本轮“结果优先的情报分析台 + 终态稳定性”要求补进 proposal/design/spec/tasks**

**Step 2: 更新会话状态，明确 Stage、allowlist 和 handoff seed**

### Task 2: 为新布局与终态稳定性写失败测试

**Files:**
- Modify: `tests/routes.live.test.ts`
- Modify: `tests/live-workbench.test.ts`

**Step 1: 为页面 HTML 语义更新断言，锁定工具带、导入抽屉、主阅读区、深读层、情报侧栏和详情抽屉的关键标识**

**Step 2: 为终态不被旧快照覆盖补一条失败测试，优先验证快照新鲜度/终态优先规则**

### Task 3: 重写 `/demo/live` 页面结构与风格

**Files:**
- Modify: `src/routes/live.ts`
- Optional Modify: `src/routes/live-workbench.ts`

**Step 1: 将现有“输入面板 + 结果面板”改成工具带 + 主区 + 侧栏布局**

**Step 2: 把输入入口做成可展开导入仓 / 工具行为，移出首屏主阅读区**

**Step 3: 强化 `事件总览 -> 关键判断 -> 证据摘录 -> 深读层` 的层级，压缩预置样本和长文本直出**

**Step 4: 改造详情层为桌面右侧抽屉、移动端全屏**

**Step 5: 按“浅底矿物质科技感”重做 CSS token、排版、卡片层级和右侧情报侧栏**

### Task 4: 修复轮询终态卡住问题

**Files:**
- Modify: `src/routes/live.ts`

**Step 1: 为 polling state 增加快照时间戳/优先级记录**

**Step 2: 在 `pollSession()`/`updateView()` 中丢弃过期响应，保证 terminal status 具备覆盖优先级**

**Step 3: 保持 retained-result 逻辑只服务重跑/失败恢复，不得影响 completed 终态展示**

### Task 5: 验证与收口

**Files:**
- Modify: `tests/routes.live.test.ts`
- Modify: `tests/live-workbench.test.ts`
- Modify: `.codex/session-state.md`

**Step 1: 运行定向测试**

Run: `npm test -- --run tests/routes.live.test.ts tests/live-workbench.test.ts`

**Step 2: 运行全量测试与构建**

Run: `npm run build && npm test -- --run`

**Step 3: 运行 OpenSpec 校验**

Run: `openspec validate add-trusted-research-workbench --strict --no-interactive`
