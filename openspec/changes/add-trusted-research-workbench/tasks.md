## 1. 已完成基础工作
- [x] 1.1 为比赛版工作台页面补充测试，锁定事件总览卡、关键判断区、证据区、分析凭证区与辅助关系图的骨架。Executor: Outer Codex
- [x] 1.2 扩展 live 结果展示所需的数据映射，支持事件卡、判断卡和证据区文案生成。Executor: Outer Codex
- [x] 1.3 重构 `live console` 页面结构与样式，提升主区层次与整体视觉表现，同时保留辅助关系图。Executor: Outer Codex
- [x] 1.4 更新页面提示文案与必要文档，使比赛版边界、导入方式和可信凭证表达一致。Executor: Outer Codex
- [x] 1.5 运行定向测试、构建与 OpenSpec 校验，确认比赛版工作台可继续迭代。Executor: Outer Codex
- [x] 1.6 调整 live 首页恢复逻辑，只自动恢复运行中的 active session，不默认回显上一次 completed/failed 结果。Executor: Outer Codex
- [x] 1.7 将 `entities / relations` 收敛到共享的结构化分析结果，提升主体与关系的一致性和稳定性。Executor: Outer Codex
- [x] 1.8 将辅助关系图切换为 ECharts 渲染，并在弱数据场景下稳定降级为清单视图。Executor: Outer Codex
- [x] 1.9 允许手动正文输入时省略标题，并在 summary 返回后自动生成展示标题。Executor: Outer Codex

## 2. 产品模式化重构
- [x] 2.1 将 `live` 首页升级为产品模式工作台：顶部状态总控条、收纳式导入仓、主结论区、态势侧栏，并移除用户侧 demo 叙事。Executor: Inner Codex
- [x] 2.2 将主区固定为 `事件总览 -> 关键判断 -> 证据摘录` 的连续阅读链，并把判断、证据、来源上下文做成可追溯闭环。Executor: Inner Codex
- [x] 2.3 引入“页面状态 / 分析阶段”双层模型，明确 `待导入 / 待分析 / 分析中 / 分析完成 / 分析失败` 与阶段提示之间的职责边界。Executor: Inner Codex
- [x] 2.4 为重新分析与失败恢复保留旧结果，直到新结果可替换；若新一轮失败，则继续保留旧结果并叠加失败反馈。Executor: Inner Codex
- [x] 2.5 将来源、流程、支付与 receipt 证据收纳为统一的分析元信息入口，避免右侧侧栏重新碎片化。Executor: Inner Codex
- [x] 2.6 约束辅助关系图与核心主体的态势侧栏表达，并在弱数据场景下降级为主体清单或关系清单，不与主结论区争抢焦点。Executor: Inner Codex
- [x] 2.7 为关键判断、证据摘录和预置资讯卡片补充详情层，保持首屏紧凑且支持查看完整内容与上下文。Executor: Inner Codex
- [x] 2.8 提升结构化分析的实体/关系密度，并将独立 graph 页面维持为可缩放的辅助浏览器，而不是主阅读入口。Executor: Inner Codex
- [x] 2.9 更新文案、响应式布局、回归测试与运行文档，验证产品模式首屏、可核验链路和低成本重分析体验。Executor: Outer Codex

## 3. 强化工作台重构与终态稳定性
- [x] 3.1 按“结果优先的情报分析台”重写 `/demo/live` 首屏布局：顶部工具带、可展开导入仓、宽主阅读区、稳定右侧情报侧栏，移除旧版演示页骨架与教学式提示。Executor: Inner Codex
- [x] 3.2 将主区进一步收束为 `事件总览 -> 关键判断 -> 证据摘录 -> 深读层`，把预置资讯、长摘要、长凭证与完整上下文降到工具入口、详情抽屉或中段区域。Executor: Inner Codex
- [x] 3.3 统一详情交互为桌面右侧抽屉 / 移动端全屏详情层，去掉显式 demo 提示语，并强化正文、证据与凭证的阅读层级。Executor: Inner Codex
- [x] 3.4 为 `/demo/live` 前端轮询链路补充快照新鲜度与终态优先保护，修复服务端已完成但页面仍停留在“分析中”的问题。Executor: Inner Codex
- [x] 3.5 更新页面与视图模型测试，覆盖新布局语义、详情层语义以及终态不被旧 `running` 快照覆盖的回归场景。Executor: Inner Codex
- [x] 3.6 运行定向测试、全量测试、构建与 OpenSpec 校验，完成本轮 Outer review 和验证收口。Executor: Outer Codex
