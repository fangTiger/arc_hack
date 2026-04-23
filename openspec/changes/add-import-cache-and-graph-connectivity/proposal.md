# 变更：add-import-cache-and-graph-connectivity

## Why
`V4` 已经把 live console 升级到“白名单链接导入 + 预置卡片 + 轻量关键词图谱”，但现场使用时仍暴露出两个影响演示稳定性的实际问题：

1. 同一篇新闻在外站波动或模板变化时仍可能抓取失败，导致真实链接导入不稳定。
2. 图谱结果在弱文本或关系较少时可能出现孤立节点，页面观感不稳定，也会削弱“结构化理解”的可信度。

这两个问题都属于产品可交付性的稳定性短板，优先级高于视觉重做和页面产品化改文案。`V5.1` 需要把系统从“能跑”推进到“稳定可演示”：实时抓取优先，但失败时可对同 URL 自动回退到本地缓存；图谱渲染优先保证连通性，避免展示多个孤立节点。

## What Changes
- 为白名单新闻导入增加本地缓存层：成功抓取即缓存，后续同 URL 失败时自动回退缓存
- 为缓存回退增加来源状态字段与页面提示，区分 `live` 与 `cache`，避免静默伪装成实时抓取成功
- 为 graph 构建增加连通性后处理，优先隐藏孤立节点，必要时自动补 1-3 条带 `derived` 标记的轻量连接边
- 补充对应测试、运行文档和录屏建议

## Out of Scope
- 去除页面 demo 感、重命名产品文案
- 更炫酷的视觉重做
- 搜索新闻、任意网址抓取、headless 浏览器
- 多 session 历史管理后台

## Impact
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：`src/domain/news-import/`、`src/demo/agent-graph.ts`、`src/routes/live.ts`、`src/routes/graph.ts`、`tests/`、`README.md`、`docs/runbooks/`、`docs/plans/`
