# 变更：refactor-workbench-layout-and-graph-density

## Why
当前工作台已经把输入、判断、证据、凭证和图谱放在同一页，但仍有三个明显的产品问题：

1. 用户粘贴长新闻后，`事件总览` 直接承接长摘要，首屏会被一大段文本占满，真正需要快速判断的信息反而被推到下方。
2. 当前图谱节点和关系数量过少，更多依赖轻量兜底与弱关系，导致 rich article 在视觉上仍像“样例图”，没有形成足够的关系密度。
3. 页面整体仍是“左侧输入 + 右侧结果 + 长列表继续往下堆”的形态，阅读流不稳定、层级切换频繁，对首次使用者不友好。

这三个问题已经不再是局部修饰，而是同一组信息架构缺陷：

- 总览层没有和全文分析层分离
- 图谱层没有独立的“图用实体 / 图用关系”筛选与排序
- 页面布局没有把“快速判断”放在第一优先级

因此需要发起一个新的后续变更，针对工作台进行完整的布局重构，并同步重构图谱抽取与展示策略。

## What Changes
- 将工作台改为 `结果优先` 的完整重构布局，引入更宽的主阅读区、稳定的上下文侧栏和细节抽屉 / 弹窗
- 将 `事件总览` 改为紧凑 briefing 卡，只显示生成标题、1-2 句事件摘要、关键指标与展开入口，不再直接承接长正文摘要
- 为判断卡、证据卡、预置样本卡引入统一的 detail drawer / modal，降低首屏纵向长度
- 将图谱从“抽取结果的直接映射”重构为“抽取候选层 + 构图层 + 渲染层”链路，允许 rich article 输出更高密度的核心节点与关系
- 将独立 graph 页面与工作台内嵌图谱统一为 ECharts 交互式浏览体验，并明确缩放 / 拖拽 / derived 边的语义
- 在实现前增加一次 UI 审核员评审，先验证页面信息架构与视觉方向，再进入编码阶段

## Out of Scope
- 新增新闻源、站点解析器或通用 URL 导入
- 引入图数据库、持久化图库或复杂 ontology 系统
- 新建历史列表页、收藏/watchlist、团队协作等后台能力
- 重做支付协议、receipt 合约或 live session 的底层协议

## Impact
- 受影响规范：`paid-knowledge-extraction-api`
- 预期受影响代码：
  - `src/routes/live.ts`
  - `src/routes/live-workbench.ts`
  - `src/routes/graph.ts`
  - `src/demo/agent-graph.ts`
  - `src/demo/agent-session-runner.ts`
  - `src/demo/live-session.ts`
  - `src/domain/extraction/normalizer.ts`
  - `src/domain/extraction/real-provider.ts`
  - `tests/routes.live.test.ts`
  - `tests/routes.graph.test.ts`
  - `tests/live-workbench.test.ts`
  - `tests/extraction.real-provider.test.ts`

## Assumptions
- 继续保留单页工作台，不拆成多页产品流程
- 继续沿用 Express 输出 HTML + 原生 JS + ECharts，不引入新的前端构建体系
- “事件总览变短”优先通过新的摘要层级与展示策略解决，而不是单纯做 CSS 截断
- rich article 的“图谱变密”需要同时改抽取上限、构图逻辑和渲染层限幅，不能只靠 prompt 微调
