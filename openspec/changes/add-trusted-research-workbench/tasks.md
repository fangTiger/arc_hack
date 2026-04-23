## 1. 实现任务
- [x] 1.1 为比赛版工作台页面补充测试，锁定事件总览卡、关键判断区、证据区、分析凭证区与辅助关系图的骨架。Executor: Outer Codex
- [x] 1.2 扩展 live 结果展示所需的数据映射，支持事件卡、判断卡和证据区文案生成。Executor: Outer Codex
- [x] 1.3 重构 `live console` 页面结构与样式，提升主区层次与整体视觉表现，同时保留辅助关系图。Executor: Outer Codex
- [x] 1.4 更新页面提示文案与必要文档，使比赛版边界、导入方式和可信凭证表达一致。Executor: Outer Codex
- [x] 1.5 运行定向测试、构建与 OpenSpec 校验，确认比赛版工作台可继续迭代。Executor: Outer Codex

## 2. 后续迭代
- [ ] 2.1 为关键判断补充真实 evidence alignment，避免继续依赖“相关原文片段”作为人工复核占位。Executor: Outer Codex
- [x] 2.2 调整 live 首页恢复逻辑，只自动恢复运行中的 active session，不默认回显上一次 completed/failed 结果。Executor: Outer Codex
- [x] 2.3 将 `entities / relations` 收敛到共享的结构化分析结果，提升主体与关系的一致性和稳定性。Executor: Outer Codex
- [x] 2.4 将辅助关系图切换为 ECharts 渲染，并在弱数据场景下稳定降级为清单视图。Executor: Outer Codex
