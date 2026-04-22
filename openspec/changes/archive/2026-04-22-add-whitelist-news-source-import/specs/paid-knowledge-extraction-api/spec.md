## ADDED Requirements

### Requirement: 支持白名单新闻源链接导入
系统 MUST 支持从有限白名单新闻站点导入文章链接，并将其转换为可直接进入 live session 的标准化文本输入。

#### Scenario: 导入支持的新闻链接
- **当** 演示者提交来自 `wublock123.com`、`panewslab.com` 或 `chaincatcher.com` 的文章链接
- **则** 系统识别来源站点并抓取文章正文
- **且** 系统返回标准化的标题、正文、来源站点和原始链接

#### Scenario: 拒绝不在白名单内的链接
- **当** 演示者提交不在支持列表中的文章链接
- **则** 系统返回 `400`
- **且** 响应明确说明该链接来源暂不支持

#### Scenario: 导入失败时给出明确错误
- **当** 支持站点的页面抓取或解析失败
- **则** 系统返回明确的导入失败信息
- **且** 不启动新的 live session

#### Scenario: 链接与文本同时缺失被拒绝
- **当** 演示者创建 live session 时既未提供 `text` 也未提供 `articleUrl`
- **则** 系统返回 `400`
- **且** 响应明确说明必须提供文本或链接之一

#### Scenario: 白名单链接重定向到非白名单 host 被拒绝
- **当** 演示者提交的白名单文章链接在抓取过程中重定向到非白名单 host
- **则** 系统返回 `400`
- **且** 不启动新的 live session

#### Scenario: 抓取超时或响应体过大时安全失败
- **当** 支持站点的页面抓取超过 `8000ms` 或响应体超过 `1000000 bytes`
- **则** 系统返回明确的导入失败信息
- **且** 不启动新的 live session

### Requirement: 支持轻量关键词图谱退化
系统 MUST 在低信息量文本或弱实体文本上退化为轻量关键词图谱，避免演示过程中频繁出现空节点或空关系。

#### Scenario: 弱信息文本仍返回有限节点
- **当** 输入文本缺少稳定的人名、公司名或强事件实体
- **则** 系统仍返回 `2-4` 个有限关键词节点
- **且** 节点类型可退化为 `topic`

#### Scenario: 弱信息文本返回有限弱关系
- **当** 输入文本难以抽出稳定主谓宾关系
- **则** 系统返回至多 `3` 条弱关系
- **且** 关系类型限定在 `描述`、`状态`、`提到`、`日期` 等轻量关系集合

#### Scenario: 强实体文本保持实体导向输出
- **当** 输入文本包含稳定的人名、机构名、产品名或明确事件实体
- **则** 系统仍返回以实体和关系为主的结构化结果
- **且** 不会无条件把所有节点都降级为 `topic`

### Requirement: 图谱页面展示导入来源元数据
系统 MUST 在链接导入成功后，将来源链接、来源站点和导入标题贯穿到可审阅的图谱展示层。

#### Scenario: graph 页面展示来源信息
- **当** 某次 session 由白名单文章链接导入而来
- **则** 对应 graph 页面展示原始链接、来源站点和导入标题
- **且** live result 与 agent session 产物中的来源元数据保持一致

#### Scenario: live session payload 展示来源信息
- **当** 页面读取 `latest`、指定 `sessionId` 或轮询某次由链接导入产生的 live session
- **则** 返回的 live session payload 包含 `articleUrl`、`sourceSite` 和导入方式等来源元数据
- **且** 这些元数据与对应的 agent session 产物保持一致

## MODIFIED Requirements

### Requirement: 支持页面触发的 Live Agent 演示台
系统 MUST 提供一个页面触发的 live console，让演示者输入单条文本或白名单文章链接后，在同一页面里按阶段观察 agent session 的运行进度、支付证据和最终图谱。

#### Scenario: 创建文本模式 live session
- **当** 演示者在 live console 页面提交标题和文本
- **则** 系统创建一个新的 live session
- **且** 返回可轮询的 `sessionId`

#### Scenario: 创建链接模式 live session
- **当** 演示者在 live console 页面提交支持的白名单文章链接
- **则** 系统先导入文章内容再创建新的 live session
- **且** 返回可轮询的 `sessionId`

#### Scenario: 读取最近一次 live session
- **当** 演示者或页面请求最近一次 live session
- **则** 系统返回最近一次 session 的状态或标识
- **且** 若尚无 session 则返回 `404`

#### Scenario: 轮询 live session 状态
- **当** live console 页面轮询某个进行中的 live session
- **则** 系统返回当前整体状态和每个步骤的进度信息
- **且** 在步骤完成时返回对应的支付证据字段

#### Scenario: mock 路径逐步推进 live session
- **当** live console 在 `mock` 路径下运行
- **则** 系统按 `summary -> entities -> relations` 顺序推进步骤状态
- **且** 页面可以逐步展示每个阶段的完成情况

#### Scenario: gateway 路径返回最终 live 结果
- **当** live console 在 `gateway` 路径下运行
- **则** 系统至少返回整体运行状态和最终完成结果
- **且** 完成后返回每一步的支付与可选 receipt 证据

#### Scenario: live session 输入无效
- **当** 演示者提交空文本、非法 URL，或同时提交文本与链接
- **则** 系统返回 `400`
- **且** 不创建新的 live session

#### Scenario: 轮询不存在的 live session
- **当** 页面轮询不存在的 `sessionId`
- **则** 系统返回 `404`

#### Scenario: 已有运行中的 live session 时再次创建
- **当** 系统已有一个 `queued` 或 `running` 的 active live session 且页面再次发起创建请求
- **则** 系统返回 `409`
- **且** 返回当前运行中 session 的标识

#### Scenario: live session 完成后展示图谱
- **当** live session 成功完成
- **则** 页面展示摘要、图谱节点、关系边和支付/receipt 证据
- **且** 最终结果与 agent session 产物保持一致

#### Scenario: 使用预置新闻卡片启动 live session
- **当** 演示者在 live console 页面选择预置新闻卡片
- **则** 页面使用该卡片内置缓存的导入结果启动一次 live session
- **且** 演示者无需手动粘贴全文即可稳定完成演示

#### Scenario: 脱网时使用预置卡片仍可演示
- **当** 外站暂时不可达或演示环境处于脱网状态且演示者选择预置新闻卡片
- **则** 系统仍可基于本地缓存导入结果启动一次 live session
- **且** 不依赖实时抓取远端网页
