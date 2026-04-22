# V3 Live Console 设计

## 目标
`V3` 面向录屏和答辩。核心不是新增支付能力，而是把已有 `V2` 能力包装成一个单页演示台：输入文本、点击开始、按阶段展示 `summary -> entities -> relations -> graph`，并在同一页面里展示 payment 和 receipt 证据。

## 方案选择
我们明确不做 websocket，而做 `轮询式伪实时`。原因很直接：画面已经足够炫，但工程风险低得多。对于录屏来说，稳定性比技术炫技更重要。只要阶段切换明确、状态卡片清楚、图谱和证据在同页可见，评委并不会因为它不是 websocket 而扣分。

这里再收一层边界：`mock` 路径负责录屏友好的逐步推进，`gateway` 路径只保证整体运行完成和最终证据，不强行把现有 `payBatch()` 拆成逐步实时回调。

## 页面结构
新页面建议为 `/demo/live`。布局采用偏答辩大屏风格，而不是后台控制台风格：
- 左栏：文本输入、sample 填充、开始按钮
- 右栏上半：五阶段卡片和运行状态
- 右栏下半：图谱预览与证据卡片

为了录屏友好，页面要满足三个点：
- 默认有示例内容，避免现场打字太多
- 状态变化明显，便于视频里看清
- 成功后不跳页，直接展示结果

## 技术结构
后端新增 live session API 和文件存储，用 `artifacts/live-console/<sessionId>/live-session.json` 记录状态，同时维护 `latest` 指针。最终完成时仍然写现有 `agent session` 产物，保证与 `V2` 共用结果结构。前端用少量内联 JS 每秒轮询一次状态。完成后直接在页面里渲染 graph，而不是强制跳到另一个页面。

实现上不允许 route 直接调用 `scripts/agent-graph-runner.ts`。必须先把可复用 runner 能力下沉到 `src/demo` 或 `src/services`，再由 CLI 和 live route 共用。

## 验收标准
- 页面可输入文本并触发一次 live session
- 支持读取最近一次 live session
- 页面可轮询并显示三步进度
- 无效输入、缺失 session、重复创建都有明确返回
- 每步可见 `requestId / price / paymentTransaction / receiptTxHash`
- 完成后同页展示图谱
- `mock` 路径可稳定录屏
- `gateway` 路径至少可完成一轮最终完成 smoke
