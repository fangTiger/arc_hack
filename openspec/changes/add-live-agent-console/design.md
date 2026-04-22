# V3 Live Console 设计

## 目标
`V3` 的目标是把现有支付和 graph 能力包装成一个适合录屏的“现场演示台”。用户在页面里输入标题和文本，点击开始后，页面按固定阶段展示：
- 创建 session
- 摘要调用
- 实体抽取
- 关系抽取
- 图谱生成完成

每一步都显示状态、价格、payment transaction 和可选 receipt `txHash`。完成后同一页面直接展示图谱和总结，不要求用户跳到另一个页面。为控制风险，`mock` 路径保证三步伪实时推进；`gateway` 路径在 `V3` 只保证整体运行态和最终完成证据。

## 产品边界
本阶段做“伪实时”，不做 websocket / SSE。前端采用轮询模式获取状态更新。只支持单条文本和单次运行。明确不做：
- 并发 session 管理后台
- 历史列表页
- 多文档融合
- 图数据库
- 复杂身份或多用户能力

## 交互方案
### 页面入口
新增 `GET /demo/live` 页面。

页面结构：
- 左侧：输入区与开始按钮
- 右侧：阶段卡片、证据摘要、图谱预览

为适合录屏，页面默认提供：
- 一键填充 sample 文本
- 大标题与大卡片
- 固定步骤顺序
- 明确的成功/运行中/失败视觉状态

### 运行方式
1. 页面调用 `POST /demo/live/session`
2. 服务端立即返回 `sessionId`
3. 前端每 `1000ms` 轮询 `GET /demo/live/session/:sessionId`
4. 页面根据状态更新阶段卡片
5. 完成后直接渲染 graph 与证据

新增一个便于录屏恢复的读取入口：
- `GET /demo/live/session/latest`

### 状态模型
新增 `LiveSessionStatus`：
- `queued`
- `running`
- `completed`
- `failed`

新增步骤状态：
- `summary`
- `entities`
- `relations`

页面视觉上会展示 5 个阶段卡片：
- `create`
- `summary`
- `entities`
- `relations`
- `graph`

其中真正由后端返回的步骤状态只有 `summary / entities / relations`；`create` 与 `graph` 由整体状态推导。

每个步骤至少包含：
- `status`
- `requestId`
- `price`
- `paymentTransaction`
- `receiptTxHash`
- `startedAt` / `completedAt`

额外边界：
- 无效输入返回 `400`
- 轮询不存在的 `sessionId` 返回 `404`
- 读取 `latest` 且尚无 session 时返回 `404`
- 若已有 `queued` 或 `running` 的 active live session，再次创建返回 `409` 和当前 `sessionId`

## 存储方案
新增 `FileLiveAgentSessionStore`，目录建议：

`artifacts/live-console/<sessionId>/live-session.json`

该文件记录 live 运行状态。同时维护：
- `artifacts/live-console/latest.json`
- 可选 `artifacts/live-console/active.json`

完成后同时写出已有的 `agent graph session.json`，保证 V2/V3 共享最终结果结构。

## 执行模型
新增 `src/demo` 或 `src/services` 下的可复用 runner service，由 CLI 和 live route 共用。`scripts/agent-graph-runner.ts` 只保留 CLI 入口，不允许 route 直接依赖 `scripts/`。

扩展现有 agent session 执行逻辑，支持 progress callback。服务端 route 在收到创建请求后，用后台异步任务执行：
- 先写 `queued`
- 每开始一个步骤就写 `running`
- 每完成一个步骤就更新对应证据
- 全部完成后写 `completed`，并附完整 `AgentSession`

`mock` 路径：
- 逐步写入 `summary -> entities -> relations`
- 页面完整展示伪实时阶段推进

`gateway` 路径：
- 维持现有 `payBatch()` 主链路
- 页面只保证 `queued/running/completed/failed` 的整体状态和最终证据
- 不承诺在单次真实运行中逐步拿到每一步 payment 结果

因为是录屏导向，前端允许对完成状态做轻量延时展示，但不要求服务端强制 sleep。这样既保证视频观感，也不影响真实 gateway 演示。

## 前端实现
不引入前端构建工具。`/demo/live` 直接输出 HTML + CSS + 少量内联 JS。

视觉方向：
- 更偏答辩大屏，而不是后台系统
- 强调时间线、证据卡片和图谱区
- 避免深色默认与模板化控制台风格

## 测试策略
- live session store 单测
- live session API 单测：创建、读取 latest、轮询、错误输入、重复创建、缺失 session
- 页面 smoke：至少验证页面可渲染关键文案和状态区
- runner 进度回调单测
- V2 CLI `/demo/graph` 非回归测试
- 全量测试、构建、mock live smoke 和 gateway 最终完成 smoke

## 风险与控制
主要风险是把“伪实时”做成一个半套任务系统。控制策略是：
- 单 session
- 轮询而非推送
- 文件存储而非数据库
- 复用现有 agent session 结果结构
- 页面只服务演示，不引入复杂前端工程
- `gateway` 路径不强行做逐步回调
