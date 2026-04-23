# V5.1 抓取缓存回退与图谱连通性设计

## 目标
`V5.1` 聚焦“稳定性”而不是“包装感”。目标只有两条：
- 白名单新闻链接在首次成功后具备本地缓存回退能力
- 图谱页面在弱关系场景下尽量不出现多个孤立节点

本轮明确不碰页面视觉风格和文案产品化，避免范围失控。

## 一、新闻导入缓存回退

### 策略
缓存策略采用“实时抓取优先，失败时回退同 URL 本地缓存”：

1. 用户提交 `articleUrl`
2. 系统先尝试实时抓取并解析
3. 若成功：
   - 返回实时结果
   - 按规范化 URL 写入本地缓存
   - 刷新缓存时间
4. 若失败：
   - 若存在同 URL 缓存，则自动回退缓存
   - 若不存在缓存，则维持失败

### 缓存边界
- 缓存键：规范化后的 URL 字符串
- 仅对白名单新闻导入生效
- 仅缓存已成功解析的结构化结果，不缓存原始 HTML
- 缓存内容至少包含：
  - `sourceUrl`
  - `canonicalUrl`
  - `sourceSite`
  - `sourceType`
  - `title`
  - `text`
  - `excerpt`
  - `cachedAt`

建议新增 `src/store/news-import-cache-store.ts`，落盘到：

`artifacts/news-import-cache/<stable-key>.json`

### URL 规范化规则
缓存 key 规则必须固定，不能依赖实现者自由发挥。

规范化规则如下：
- 仅接受 `http/https`
- scheme 统一小写
- host 统一小写，并对支持站点去掉前缀 `www.`
- 去掉 fragment/hash
- 去掉默认端口
- path 在非根路径时去掉结尾 `/`
- query 保留，但移除以下跟踪参数：
  - `utm_*`
  - `spm`
  - `ref`
  - `fbclid`
  - `gclid`
- 剩余 query 参数按 key/value 排序后重建

### 请求 URL 与 finalUrl
当前实现同时拿得到：
- 请求 URL
- 抓取后 `finalUrl`

为避免 canonical redirect 导致同一内容命不中缓存，成功导入后系统必须：
- 以规范化后的 `finalUrl` 作为主缓存 key
- 如规范化后的请求 URL 与主 key 不同，则额外写入一个 alias key 指向同一缓存记录

失败回退时：
- 先按规范化后的请求 URL 查找
- 若命中 alias，则解析到主缓存记录

这样可以同时覆盖：
- 同 URL 失败回退
- canonical / redirect URL 再次访问仍命中历史缓存

### 来源元数据
为了让页面对缓存回退保持诚实，需要把来源状态贯穿到现有 metadata：

```ts
type SourceMetadata = {
  articleUrl?: string;
  sourceSite?: SupportedNewsSite;
  importMode?: 'manual' | 'link' | 'preset';
  importStatus?: 'live' | 'cache';
  cachedAt?: string;
};
```

行为要求：
- 实时抓取成功：`importStatus='live'`
- 缓存回退成功：`importStatus='cache'` 且带 `cachedAt`

### 页面表现
本轮不做重视觉，只在现有页面上增加轻量提示：
- live console 完成态显示：
  - `导入状态：实时抓取` 或 `导入状态：缓存回退`
  - 若是缓存回退，则显示 `缓存时间`
- live console 完成态或 graph 页面中显示：
  - `导入状态：实时抓取` 或 `导入状态：缓存回退`
  - 若是缓存回退，则显示 `缓存时间`

这样能保证演示稳定，同时不误导观众。

## 二、图谱连通性

### 问题定义
当前 `buildAgentGraph()` 按实体和关系直接建图：
- 有实体但关系缺失时，会出现多个孤立节点
- 有少量关系时，也可能只连接一部分节点，剩余节点零度悬空

这会削弱页面观感，也让“结构化理解”显得不稳定。

### 处理策略
图谱连通性后处理分两层：

#### 层 1：已有边时隐藏零度节点
- 若原始关系图已经存在至少 `1` 条边
- 则默认移除所有零度节点

目的：优先展示真正有关系的结构，不让零度节点污染画面。

#### 层 2：完全无边时自动补轻量连接
- 若原始关系图 `0` 条边
- 则从实体节点中选主节点，构造最多 `1-3` 条轻量连接边
- 轻量连接标签只允许：
  - `提到`
  - `描述`
  - `状态`

建议规则：
- 取第一个节点为主节点
- 其余最多 3 个节点向主节点连边
- 边标签优先用 `提到`

目的：保证页面可视上是连通图，而不是若干漂浮点。

### 约束
- 不改变 session 原始 `entities` / `relations` 语义层数据
- 只对 `graph.nodes` / `graph.edges` 这个展示层做后处理
- 如后处理补边，必须标记边来源为 `derived`

例如：

```ts
type AgentGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  provenance?: 'original' | 'derived';
};
```

graph 页面至少需要一处可见文案说明：
- `original` 来自真实抽取关系
- `derived` 仅用于展示连通性辅助

## 三、测试策略

### 新闻缓存
- 首次成功导入后写缓存
- 同 URL 再次导入且 fetch 失败时自动回退缓存
- canonical / redirect URL 重新访问时仍可命中同一缓存
- 无缓存时失败仍保持失败
- live success 时返回 `importStatus='live'`
- 缓存回退结果带 `importStatus='cache'`
- live console 完成态和 graph 页面都能展示缓存状态与可选 `cachedAt`

### 图谱连通性
- 有部分边时，零度节点不再进入最终 graph
- 无边时自动补 `1-3` 条辅助边
- 辅助边带 `provenance='derived'`
- 强实体和弱文本原始抽取结果不被篡改，只调整展示 graph

### 验证命令
- `npm test -- --run`
- `npm run build`
- `openspec validate add-import-cache-and-graph-connectivity --strict --no-interactive`

## 风险与控制

### 风险 1：缓存掩盖真实抓取失败
控制：
- 页面明确显示 `缓存回退`
- 只对白名单 URL 的历史成功结果回退
- 不把缓存伪装成实时抓取

### 风险 2：自动补边显得“造假”
控制：
- 仅在展示层补边
- 原始 `relations` 保持不变
- 边数严格限制在 `1-3`
- 使用固定弱关系标签

### 风险 3：缓存键不稳定
控制：
- 固定 URL 规范化规则
- 成功后同时写主 key 与 alias key
- 测试覆盖 request URL / finalUrl / redirect 命中关系
