## 1. 实现任务
- [x] 1.1 新增白名单新闻源导入 domain，支持 `wublock123`、`PANews`、`ChainCatcher` 的 URL 识别、HTML 抽取与统一结构化返回。Executor: Inner Codex
- [x] 1.2 扩展共享 source 契约、live console 与 live session API，支持以 `articleUrl` 直接创建 session，并在页面上增加 URL 模式与带本地缓存结果的预置新闻卡片。Executor: Inner Codex
- [x] 1.3 调整 `mock` / `real` 抽取策略，对低信息量文本稳定输出 `2-4` 个关键词节点与至多 `3` 条弱关系。Executor: Inner Codex
- [x] 1.4 更新 graph 展示、运行文档与演示说明，补充导入来源元数据、预置卡片兜底和录屏建议。Executor: Inner Codex
- [x] 1.5 完成定向测试、全量测试、构建和 OpenSpec 校验，并准备主审材料。Executor: Outer Codex
