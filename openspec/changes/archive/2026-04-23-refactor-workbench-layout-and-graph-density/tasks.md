## 1. 设计与评审
- [x] 1.1 梳理当前工作台在长新闻、长摘要、长页面滚动和图谱稀疏上的具体症状，并固化到设计稿。Executor: Outer Codex
- [x] 1.2 输出新一版 layout / IA 设计，明确首屏 wireframe、首屏折叠规则、详情交互、图谱位置与移动端退化策略。Executor: Outer Codex
- [x] 1.3 将提案交给 UI 审核员做页面布局评审，收敛主要风险与修改建议。Executor: UI Reviewer
- [x] 1.4 根据 UI 审核结论补强提案，固化首屏布局契约、briefing 规则和图谱密度验收目标。Executor: Outer Codex

## 2. 工作台重构
- [x] 2.1 为新的 result-first 布局补测试，锁定顶部 briefing、主判断区、证据抽屉、侧栏与图谱区的骨架。Executor: Inner Codex
- [x] 2.2 重构 `live-workbench` view model，拆分 `headline / briefing / full summary / evidence context / graph candidates` 等层级。Executor: Inner Codex
- [x] 2.3 重构 `live.ts` 页面布局、交互与响应式样式，确保长新闻不会让事件总览失控增长。Executor: Inner Codex
- [x] 2.4 为判断卡、证据卡和预置资讯卡片实现统一详情交互，减少首屏纵向滚动。Executor: Inner Codex

## 3. 图谱密度与渲染
- [x] 3.1 重构 rich article 的实体/关系筛选上限与排序逻辑，输出更高密度但仍可控的核心图谱数据。Executor: Inner Codex
- [x] 3.2 重构 `agent-session-runner -> buildAgentGraph` 的实际构图链路，引入 graph candidates、selection、ranking 与 densify / prune 规则。Executor: Inner Codex
- [x] 3.3 在工作台内嵌图谱和独立 graph 页面统一 ECharts 交互能力，并明确 derived 边的语义表达。Executor: Inner Codex
- [x] 3.4 为图谱弱数据场景保留稳定降级策略，避免节点变多后噪声反而劣化体验。Executor: Inner Codex

## 4. 验证
- [x] 4.1 运行与工作台、图谱、抽取链路相关的定向测试与构建验证。Executor: Outer Codex
- [x] 4.2 根据 UI 审核结论和实现结果更新文档、OpenSpec 与会话状态。Executor: Outer Codex
