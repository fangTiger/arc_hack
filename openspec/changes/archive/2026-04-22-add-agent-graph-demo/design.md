# V2 Agent Graph Demo 设计

## 目标
`V2` 的目标不是引入一个真正的多 agent 框架，而是把现有付费 API 封装成一个“agent 自动付费调用工具”的可演示产品。用户通过 CLI 提交一段新闻或研报文本后，系统自动执行三步工具调用：摘要、实体抽取、关系抽取。然后把单次 session 的结果落成产物，并通过网页展示层把 `entities + relations` 画成知识图谱。

## 范围边界
本阶段只支持“单条文本 -> 单次 session -> 单张图谱”的闭环。明确不做：多文档合并、图数据库、实体消歧、网页抓取、复杂任务编排、多人协同工作流。页面只服务于演示与验收，不引入前端构建系统，也不新增重量级可视化依赖。

## 架构方案
### 1. Agent Session Runner
新增一个脚本级 orchestrator，复用已有 buyer 支付主路径。

- `mock` 模式：通过应用内调用或 mock buyer 完成三次工具调用，保证本地可跑
- `gateway` 模式：复用现有 buyer 能力，对 `/api/extract/summary`、`/entities`、`/relations` 执行真实付费调用
- 可选 receipt：沿用现有 receipt writer，为每次成功调用补充 Arc `txHash`

session runner 的输出是一个 `session.json`，包含：
- `sessionId`
- 输入文本与来源
- 三步抽取结果
- 每一步的 `requestId`、价格、payment transaction、payload hash、receipt tx hash
- 预计算的 graph `nodes` / `edges`

### 2. Session Artifact Store
新增一个轻量 store，用文件系统保存 `agent session` 产物。推荐目录：

`artifacts/agent-graph/<sessionId>/session.json`

同时维护一个 `latest.json` 或软引用式索引，方便演示页面读取最近一次 session。MVP 只需要文件落盘和按 id 读取，不做数据库。

### 3. Graph View Route
新增演示路由，至少支持：

- `GET /demo/graph/latest`
- `GET /demo/graph/:sessionId`

服务端读取 `session.json`，返回一个无需构建步骤的 HTML 页面。页面展示：
- 输入标题与摘要
- 节点和边的可视化视图
- 三次工具调用的 payment/receipt 证据卡片
- 总价格与调用次数

图谱布局采用确定性、轻量实现。优先使用原生 SVG / HTML / 少量内联 JS，不新增可视化依赖。

## 数据模型
### Agent Session
- `status`: `completed`
- `source`: 原始输入
- `summary`
- `entities`
- `relations`
- `runs`: 三次调用的证据数组
- `graph.nodes`
- `graph.edges`
- `totals.totalPrice`
- `totals.successfulRuns`

### Graph 生成规则
- `entities` 直接映射为节点，按 `name` 去重
- `relations` 映射为边
- 若关系引用了未知节点，则补一个 `unknown` 类型节点，避免页面断边
- 节点颜色按 `organization / person / topic / unknown` 区分

## 错误处理
- 任一步支付或抽取失败时，CLI 直接非零退出
- 不做复杂重试编排；重试由操作者重新执行 CLI
- 页面仅展示已完成 session，不展示半成品
- 找不到 session 时返回 `404`

## 测试策略
- session runner 单测：校验三步调用、session artifact 结构、graph 生成和证据映射
- graph route 单测：校验 `latest` 和 `by id` 页面响应
- 端到端 smoke：在 `mock` 模式下运行 agent CLI，确认产物和页面都可读取
- 如条件允许，再补一个 `gateway` 路径的契约测试，验证 session 结构兼容真实 buyer 返回值

## 风险与控制
最大风险是把页面和 agent 概念做得过重。控制策略是：`V2` 只在现有 buyer 主路径上加一层编排和展示，不改 payment 核心逻辑。这样即使页面效果朴素，仍然可以靠真实支付证据和自动化 session 产物支撑答辩。 
