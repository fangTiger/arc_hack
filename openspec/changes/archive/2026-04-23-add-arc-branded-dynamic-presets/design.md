# 设计：Arc 品牌化与动态预置资讯

## 概述
本轮继续沿用现有 live workbench 页面骨架，不调整 live session API、轮询模型和结果建模，只在页面品牌层与预置资讯来源层做增强。整体思路是：由服务端在渲染 `/demo/live` 时优先拉取一组 Arc 相关的白名单新闻，生成可直接启动分析的动态预置卡片；若动态抓取不足，则自动回退到当前静态预置卡片，保证首屏始终可用。

## 品牌策略
- 页面左上角加入 Arc wordmark 与副标题，强化“Arc economic terminal / stablecoin-native workbench”的产品识别
- favicon 改为 Arc 风格图标，并与页面顶部品牌元素保持一致
- 页面内不新增大段品牌宣讲，只在工具带、凭证区和试跑入口处强调 Arc / Circle / USDC / Gateway

## 动态预置策略
- 新增 `LiveNewsPresetProvider`，接收 `newsImporter` 并在服务端生成预置卡片
- provider 维护一组人工筛选过的 Arc 相关来源池，来源仅限当前已支持解析的 PANews / ChainCatcher 链接
- provider 使用短 TTL 内存缓存，避免每次请求都重新抓取
- 抓取成功时根据 `ImportedArticle` 生成预置卡片；抓取失败时回退到现有静态卡片
- 动态结果不足时允许“动态 + 静态”混合补位，避免预置区空白

## 试跑入口
- 在导入仓增加“推荐试跑链接”区域，直接展示已验证可解析的真实 URL
- 该入口只承担填充与试跑作用，不扩大支持站点范围

## 测试策略
- 为 provider 增加单元测试，覆盖成功、失败回退与缓存命中
- 路由测试覆盖 Arc 品牌元素、动态预置卡片与试跑链接区域
- 浏览器 E2E 覆盖动态预置入口仍可启动分析
