# Live Workbench Visual System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `live` 页面从浅色内容展示风格重构为更强的深色科技工作台，同时保持现有业务逻辑与浏览器回归稳定。

**Architecture:** 这轮实现只修改 `src/routes/live.ts` 中的页面结构与 CSS 视觉系统，不改 live session API、视图模型字段或轮询逻辑。测试上优先复用现有路由测试与 Playwright，用最小的断言调整锁定新视觉锚点。

**Tech Stack:** Express 路由内联 HTML/CSS/JS、Vitest、Playwright、OpenSpec

---

### Task 1: 补视觉重构的规格与测试锚点

**Files:**
- Create: `openspec/changes/refactor-live-workbench-visual-system/proposal.md`
- Create: `openspec/changes/refactor-live-workbench-visual-system/tasks.md`
- Create: `openspec/changes/refactor-live-workbench-visual-system/design.md`
- Create: `openspec/changes/refactor-live-workbench-visual-system/specs/paid-knowledge-extraction-api/spec.md`
- Test: `tests/routes.live.test.ts`
- Test: `tests/e2e/live-workbench.spec.ts`

**Step 1: 写会失败或待更新的测试断言**

在 `tests/routes.live.test.ts` 中增加对新视觉文案或结构锚点的断言，例如深色工作台相关说明、Hero 文案或新容器类名；必要时在 Playwright 中补一个不依赖颜色值的结构级断言。

**Step 2: 运行相关测试确认当前实现还不满足**

Run: `npm test -- --run tests/routes.live.test.ts`
Expected: 至少一条针对新视觉结构的断言失败

**Step 3: 保持 E2E 主链路锚点稳定**

确保新的视觉断言不依赖易抖动文案，也不破坏现有 `data-testid` 与关键 id。

### Task 2: 重构 live 页面视觉系统

**Files:**
- Modify: `src/routes/live.ts`

**Step 1: 重构全局视觉 token**

把根变量切到深色科技工作台方向，统一背景、卡片、边线、高光、正文、危险态与强调色。

**Step 2: 重构首屏布局与层级**

强化顶部状态带、主区 Hero、关键判断卡组、证据区和侧栏的体量差；保留原有交互结构与状态逻辑。

**Step 3: 统一弹层与图谱视觉**

让关系图弹层、详情抽屉和元信息区共享同一套深色终端式材质与层次。

**Step 4: 回归移动端与窄屏**

确保现有移动端全屏详情和关系图弹层依旧可用，不因新布局破坏窄屏体验。

### Task 3: 完成验证

**Files:**
- Modify: `openspec/changes/refactor-live-workbench-visual-system/tasks.md`

**Step 1: 跑测试**

Run: `npm test -- --run tests/routes.live.test.ts tests/e2e/live-workbench.spec.ts`
Expected: PASS

**Step 2: 跑全量验证**

Run: `npm test -- --run && npm run build`
Expected: PASS

**Step 3: 跑 OpenSpec 校验**

Run: `openspec validate refactor-live-workbench-visual-system --strict --no-interactive`
Expected: PASS

**Step 4: 更新任务状态**

把 `tasks.md` 中已完成项标成 `[x]`，记录本轮视觉重构已经进入可回归状态。
