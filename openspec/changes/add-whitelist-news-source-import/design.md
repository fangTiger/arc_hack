# V4 白名单新闻源导入设计

## 目标
`V4` 的目标是把 live console 的入口从“粘贴全文”升级成“粘贴新闻链接”，让演示者更像在使用一个真实产品。用户在页面里输入文章链接后，系统自动识别来源、抽取正文、生成一次按次付费的 agent session，并最终展示知识图谱与支付证据。

为控制交付风险，本阶段只支持少量白名单站点：
- `wublock123.com`
- `panewslab.com`
- `chaincatcher.com`

不做：
- 全网搜索
- 任意站点正文抽取
- 浏览器爬虫或 headless 渲染
- 多文档聚合图谱
- 图数据库

## 输入与产品形态
live console 页面新增两种输入模式：
- `文章链接`
- `手动文本`

默认优先展示 `文章链接`。页面还会提供 3-6 张预置新闻卡片，并同时附带本地缓存的导入结果，保证录屏时不依赖临场找新闻或外站实时可用性。

`POST /demo/live/session` 的输入契约扩展为严格二选一：
- 传统文本模式：`title + text + sourceType`
- 链接模式：`articleUrl`

约束如下：
- `text` 与 `articleUrl` 必须且只能存在一种
- 两类字段都缺失时返回 `400`
- 两类字段同时出现时返回 `400`
- `articleUrl` 不是合法 `http/https` URL 时返回 `400`
- 抓取过程中若发生重定向，最终 URL 的 host 仍必须在白名单内

当提供 `articleUrl` 时，服务端先执行导入，再沿用现有 live session 流程。这样页面可以“一次点击直接开始”，而不是先导入再二次提交。

## 新闻源导入架构
新增 `src/domain/news-import/`，拆成三个层次：

1. `source-detector`
- 负责识别 URL 是否属于白名单
- 归一化 host，例如带 `www` 和不带 `www` 的场景

2. `article-fetcher`
- 使用 Node 原生 `fetch`
- 拉取原始 HTML
- 不引入新依赖，不做浏览器渲染
- 使用固定抓取上限，避免 live session 被慢站点拖死：
  - timeout：`8000ms`
  - 响应体大小上限：`1_000_000 bytes`

3. `site-extractors`
- 每个站点一个 extractor
- 使用站点专用的标题、时间、正文边界规则
- 抽取失败时允许走有限回退，例如 `og:title`、`articleBody`、正文段落拼接

返回统一结构：

```ts
type ImportedArticle = {
  sourceUrl: string;
  sourceSite: 'wublock123' | 'panews' | 'chaincatcher';
  sourceType: 'news';
  title: string;
  text: string;
  excerpt?: string;
};
```

为了避免导入超长内容拖慢后续抽取，导入结果需要做文本清洗：
- 去 HTML 标签
- 合并连续空白
- 去除“相关推荐 / 声明 / 下载 App / 分享”一类尾部噪声
- 固定正文长度上限为前 `3000` 个字符

## 轻量图谱退化策略
当前图谱在低信息量文本上容易返回空结果，这对现场演示不稳定。`V4` 需要把目标从“强实体知识图谱”收敛成“轻量关键词图谱”。

具体策略：
- 实体抽取优先返回 `2-4` 个节点，不追求更多
- 若文本缺少强实体，则允许返回时间、主题、状态词，统一标成 `topic`
- 关系抽取最多返回 `3` 条边
- 若不存在强关系，则允许退化成 `描述`、`状态`、`提到`、`日期` 这类弱关系

这项策略需要同时覆盖：
- `mock provider`
- `real provider`

`mock` 路径要保证中文文本也能产出有限节点，不能再依赖英文大写词。`real` 路径则通过更明确的提示词和结果清洗，限制节点和关系数量，避免图谱噪声过多。

同时必须保留一条回归保护：对于包含稳定人名、机构名、产品名和明确事件的文本，不允许无条件降级成只有 `topic` 的弱关系图谱。退化策略只用于弱信息文本，而不是覆盖所有输入。

## Live Console 集成
live console 页面增加：
- URL 输入框
- 输入模式切换
- 白名单来源说明
- 预置新闻卡片
- 导入失败时的明确提示

预置新闻卡片不只保存远端 URL，而是同时内置缓存的导入结果，用于录屏时的稳定兜底。页面可以展示原始 URL，但启动时优先使用本地缓存的 `title/text/sourceSite/articleUrl`，避免因外站波动导致演示失败。

source 元数据必须贯穿共享契约，而不只是 live session 本地状态。当前 `ExtractionRequest` / `AgentSession.source` 只包含 `title/text/sourceType`，`V4` 需要把 `articleUrl` 与 `sourceSite` 纳入共享 source 结构，使 live store、agent session 产物和 graph 页面使用同一套来源元数据。

推荐结构：

```ts
type SourceMetadata = {
  articleUrl?: string;
  sourceSite?: 'wublock123' | 'panews' | 'chaincatcher';
  importMode?: 'manual' | 'link' | 'preset';
};

type ExtractionRequest = {
  sourceType: 'news' | 'research';
  title?: string;
  text: string;
  metadata?: SourceMetadata;
};
```

session 存储结构需要记录导入来源，便于图谱页和证据区展示：

```ts
type LiveSessionSource = {
  sourceType: 'news' | 'research';
  title?: string;
  text: string;
  metadata?: SourceMetadata;
};
```

完成后的 graph 页面也应展示：
- 原始链接
- 来源站点
- 导入标题

同时，`GET /demo/live/session/latest`、`GET /demo/live/session/:sessionId` 和轮询返回的 live session payload 也必须带出相同的来源元数据，避免页面只能在 graph 结果页看到来源信息。

## 测试策略
本阶段测试不依赖真实外网。使用固定 HTML fixture 覆盖：
- 3 个白名单站点的成功导入
- 不支持的 URL 返回 `400`
- `text` / `articleUrl` 同时提交或同时缺失时返回 `400`
- 重定向后 host 不在白名单时返回 `400`
- 站点解析失败时返回可理解错误
- live session 在链接模式下的成功创建
- 预置卡片在脱网条件下仍可启动 live session
- 低信息量中文文本的轻量图谱退化
- 强实体文本的实体导向输出非回归

验证命令维持：
- `npm test -- --run`
- `npm run build`
- `openspec validate add-whitelist-news-source-import --strict --no-interactive`

## 风险与控制
主要风险不在页面，而在站点正文抽取会随页面结构变化而失效。控制策略是：
- 明确白名单，只做 3 个站点
- 不依赖单一 selector，保留两层回退
- 测试使用 HTML fixture 锁定当前已知结构
- 页面提供带本地缓存结果的预置新闻卡片作为兜底

另一个风险是图谱过空或过吵。控制策略是：
- 限制节点和边数量
- 明确弱关系白名单
- 优先“少而稳”，而不是“多而乱”
