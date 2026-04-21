# V1 设计：付费新闻/研报知识抽取 API

## 目标
V1 聚焦做成一个“真实可运行、可计费、可批量演示”的 API 产品，而不是直接做完整知识图谱系统。输入是一段新闻或研报文本；输出是摘要、实体或关系抽取结果；每次调用先经过 `402 Payment Required` 协商，再以 USDC 纳米支付完成访问。

## 架构决策
### 1. 服务形态
- 技术栈：`Node.js + TypeScript + Express`
- 支付：优先使用 `@circle-fin/x402-batching` 的 seller/buyer 官方路径
- 模式切换：
  - `PAYMENT_MODE=mock`：本地开发与自动化测试使用
  - `PAYMENT_MODE=gateway`：接 Arc + Circle Gateway 的真实演示使用

### 2. AI 形态
- 抽象一个 `KnowledgeExtractionProvider`
- 支持两种实现：
  - `AI_MODE=mock`：返回稳定、可预测的测试数据，保证仓库在无模型密钥时也可运行
  - `AI_MODE=real`：通过外部 LLM 返回真实摘要/实体/关系结果
- V1 只要求单文档输入，不做多文档融合、实体消歧、长期图谱存储

### 3. 数据与证据
- 每次请求生成标准化调用记录，写入本地演示产物目录
- 采用“追加式 JSONL/JSON 产物”而不是数据库，降低依赖与部署复杂度
- 产物至少包含：请求类型、价格、支付模式、执行状态、调用时间、输出摘要信息
- 额外引入一个最小 `UsageReceipt` 合约：每次成功付费调用后，由批量 buyer 使用 Arc demo wallet 写入一笔 receipt 交易，建立“请求结果 -> Arc tx hash”的可追溯映射

## API 设计
### 付费 endpoint
- `POST /api/extract/summary`
- `POST /api/extract/entities`
- `POST /api/extract/relations`

### 公共请求体
```json
{
  "sourceType": "news",
  "title": "可选标题",
  "text": "待处理正文"
}
```

### 公共返回结构
- `requestId`
- `pricedOperation`
- `result`
- `payment`
- `meta`

V1 保证输出结构稳定，便于 V2 被 agent 工具调用，V3 被知识图谱前端消费。

## 定价策略
- `summary`: `$0.004`
- `entities`: `$0.003`
- `relations`: `$0.005`

这三档定价都低于 `$0.01`，且能清晰说明如果每次请求都承担传统逐笔 gas，则利润空间会快速被侵蚀。

## 演示路径
1. 启动 seller API
2. buyer 脚本读取内置新闻/研报样本
3. 按配置批量触发 `summary/entities/relations`
4. 每次成功调用后向 `UsageReceipt` 合约写入一笔 Arc 交易
5. 导出演示产物与统计摘要
6. 在运营统计接口或静态产物中展示总调用数、总价格、成功率、支付元数据与 receipt tx 列表

## 非目标
- V1 不做知识图谱前端
- V1 不做多用户权限系统
- V1 不做图数据库或长期索引
- V1 不做自动网页抓取

## 风险与缓解
### 1. “50 笔链上交易”解释风险
Nanopayments 使用批量结算，`50` 次付费调用不必然对应 `50` 笔独立链上结算交易。V1 仍以真实纳米支付 API 为核心，同时通过 `UsageReceipt` 合约稳定地产出 `50` 笔 Arc 侧业务凭证交易，并在文档中同时展示 Gateway transfer、batch settlement 与 receipt tx 三类证据。

### 2. 外部模型不稳定
通过 `AI_MODE=mock` 保证本地与 CI 可运行；真实演示再切换到外部模型。

### 3. 真实支付依赖凭证
通过 `PAYMENT_MODE=mock` 解耦测试与本地开发；真实 Arc/Circle 集成放入明确的部署 runbook。
