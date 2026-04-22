# 变更：add-whitelist-news-source-import

## Why
`V3` 的 live console 已经能把“输入文本 -> 付费调用 -> 图谱展示”录到一屏里，但入口仍然偏开发者式：要么手动粘贴全文，要么回填 sample。对黑客松答辩和录屏来说，这个入口的产品感还不够，评委也更难直观理解“用户拿一篇真实新闻就能直接跑出知识图谱”。

本轮需要把入口升级成更像真实产品的形态，但范围必须受控。我们不做全网搜索、也不做通用网页抽取平台，只支持少量白名单新闻源。这样既能显著提升演示质感，又不会把工程复杂度推到不可控的程度。

## What Changes
- 新增白名单新闻源链接导入能力，首批支持 `wublock123.com`、`panewslab.com`、`chaincatcher.com`
- 在 live console 中增加“文章链接”输入模式，允许演示者直接粘贴白名单链接并启动一次 live session
- 为导入文本新增“少量关键词 + 弱关系”的轻量图谱退化策略，避免低信息量文本频繁出现空图
- 增加录屏友好的预置新闻卡片，并以内置缓存的导入结果作为稳定兜底
- 补充运行文档，明确支持站点、失败回退和推荐录屏流程

## Impact
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：`src/routes/`、`src/demo/`、`src/domain/extraction/`、`src/store/`、`tests/`、`README.md`、`docs/runbooks/`、`docs/plans/`
