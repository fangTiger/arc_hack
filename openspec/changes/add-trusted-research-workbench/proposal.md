# 变更：add-trusted-research-workbench

## Why
当前 `live console` 已经能完成链接导入、阶段展示、支付证据和图谱展示，但页面主叙事仍然偏向“输入文本 -> 看图谱”的 demo 结构。对比赛评委来说，这会弱化产品感，也会放大 URL 导入不稳定和图谱精度有限带来的负面观感。

我们已经明确把比赛版产品定位收敛为“可信投研工作台”：

- 主价值是把一条加密资讯转成可判断、可复核、可验证的投研线索
- 图谱只保留为辅助关系图，不再承担主结论职责
- 页面第一屏应优先展示事件判断、关键结论、证据摘录和分析凭证

因此需要把现有 live console 从“演示页”升级为“工作台”式单页结果结构。

## What Changes
- 重构 `live console` 的页面布局，主区升级为 `事件总览卡 + 关键判断区 + 证据区`
- 将 `payment / receipt / payloadHash` 等技术证据统一收纳为分析凭证区
- 保留图谱，但降级为辅助关系图，并弱化其主视觉地位
- 明确导入边界与导入状态提示，降低 URL 导入不稳定对答辩体验的影响
- 补充比赛版文案，使页面整体更像专业投研产品而不是技术 demo

## Out of Scope
- 通用 URL 解析或更多新闻站点支持
- 大规模图谱算法升级或复杂图交互
- 新增历史管理后台、团队协作或 watchlist
- 改造底层支付协议或 receipt 模式

## Impact
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：`src/routes/live.ts`、`src/demo/live-session.ts`、相关测试和运行文档
