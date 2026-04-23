# Arc Workbench Brand And Presets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 live workbench 增加 Arc 品牌层、动态预置资讯和可直接试跑的真实链接入口。

**Architecture:** 保持现有 live session API、轮询和结果建模不变，在服务端渲染层新增一个轻量动态预置 provider。页面继续由 `src/routes/live.ts` 负责 HTML/CSS/脚本输出，provider 负责把 Arc 相关白名单资讯转换成可直接启动分析的预置卡片，并在失败时回退到静态预置。

**Tech Stack:** TypeScript, Express, Vitest, Playwright, OpenSpec

---

### Task 1: 定义动态预置 provider

**Files:**
- Create: `src/demo/live-preset-provider.ts`
- Modify: `src/demo/news-presets.ts`
- Test: `tests/live-preset-provider.test.ts`

1. 先写 provider 的 failing tests，覆盖成功抓取、失败回退和缓存命中。
2. 实现最小 provider，只依赖当前 `newsImporter.import()` 和静态 presets。
3. 运行 `npm test -- --run tests/live-preset-provider.test.ts`，确认转绿。

### Task 2: 重构 live 页面品牌层与预置入口

**Files:**
- Modify: `src/routes/live.ts`
- Test: `tests/routes.live.test.ts`
- Test: `tests/e2e/live-workbench.spec.ts`

1. 先写 failing tests，覆盖 Arc 品牌元素、Arc favicon、动态预置卡片与试跑链接区。
2. 将 `/demo/live` 渲染改为异步，接入 provider 输出。
3. 更新页面头部品牌区、预置区和导入仓试跑链接。
4. 运行定向路由测试和 E2E。

### Task 3: 整体验证

**Files:**
- Modify: `openspec/changes/add-arc-branded-dynamic-presets/tasks.md`

1. 运行 `npm test -- --run`
2. 运行 `npm run test:e2e -- live-workbench.spec.ts`
3. 运行 `npm run build`
4. 运行 `openspec validate add-arc-branded-dynamic-presets --strict --no-interactive`
5. 更新任务清单状态
