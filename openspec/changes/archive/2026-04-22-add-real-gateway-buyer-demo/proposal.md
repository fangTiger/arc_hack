# 变更：新增真实 Gateway buyer 演示链路

## 为什么
当前 V1 已完成 `mock payment` 与真实 Circle Gateway seller middleware，但 buyer 侧仍停留在本地 mock 演示。这样虽然 seller 已能返回真实 `402` challenge，却还没有一条官方 buyer SDK 驱动的端到端支付链路，黑客松现场演示时仍需要口头解释 buyer 如何完成真实支付。

## 变更内容
- 新增一个基于官方 `GatewayClient` 的 buyer 演示运行器
- 为 `POST /api/extract/*` 增加 POST 探测与真实支付编排能力
- 支持在 buyer 演示中输出支付交易、余额变化、调用摘要与可选 receipt 证据
- 补充 buyer 相关环境变量、运行文档与验收步骤

## 不包含
- 不自动拉起 seller 开发服务器
- 不实现前端钱包交互
- 不在本轮引入 V2 Agent Tool 化

## 影响范围
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：buyer 支付编排、demo 脚本、环境配置、文档、测试
- 风险关注：官方 `GatewayClient.supports(url)` 只走 `GET`，不适用于当前 `POST` 接口，因此需要自定义 POST 预探测，但实际支付仍坚持使用官方 buyer SDK
