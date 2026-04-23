# 变更：为投研工作台加入 Arc 品牌层与动态预置资讯

## 为什么
当前 live workbench 的页面结构已经更像产品，但 Arc 品牌锚点仍然偏弱，预置资讯也完全依赖本地静态卡片，无法稳定体现“Arc / Circle / USDC / Gateway”这一题设主线。

## 变更内容
- 为 live workbench 增加 Arc 品牌层，包括顶部 Arc wordmark、Arc 风格 favicon 与更明确的 Arc / Circle 语义提示
- 将预置资讯从纯静态卡片升级为“动态优先、静态兜底”的服务端预置源
- 动态预置源仅使用当前已支持的新闻站点，并优先挑选 Arc 相关报道
- 在导入仓中增加可直接试跑的真实链接入口，帮助演示者快速验证链接导入能力

## 影响范围
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：
  - `src/routes/live.ts`
  - `src/demo/news-presets.ts`
  - `src/domain/news-import/*`
  - `tests/routes.live.test.ts`
  - `tests/e2e/live-workbench.spec.ts`
