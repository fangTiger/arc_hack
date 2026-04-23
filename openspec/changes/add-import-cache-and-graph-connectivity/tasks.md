## 1. 实现任务
- [x] 1.1 新增新闻导入缓存存储、URL 规范化与 alias key 机制，支持成功导入写缓存、request/finalUrl 命中同一缓存、失败时按同 URL 回退缓存。Executor: Inner Codex
- [x] 1.2 扩展来源元数据与 live 导入流程，记录 `importStatus` 和可选 `cachedAt`，并在 live payload 中返回 `live/cache` 状态。Executor: Inner Codex
- [x] 1.3 为 graph 展示层增加连通性后处理：已有边时移除零度节点，无边时补 1-3 条带 provenance 标记的轻量辅助边。Executor: Inner Codex
- [x] 1.4 更新 graph/live 页面文案与运行文档，明确显示实时抓取/缓存回退状态、缓存时间、derived 辅助边说明和推荐录屏路径。Executor: Inner Codex
- [x] 1.5 完成定向测试、全量测试、构建与 OpenSpec 校验，并准备主审材料。Executor: Outer Codex
