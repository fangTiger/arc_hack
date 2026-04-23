# Arc Signal Desk Product Brief

## 一句话定位

`Arc Signal Desk` 是一个面向智能体经济场景的情报分析与按次付费工作台：用户或上层 agent 提交一条新闻、文本或预置线索后，系统会把 `summary`、`entities`、`relations` 这些分析动作拆成独立的可计价步骤，用 `USDC + Circle Nanopayments + Arc` 完成高频、低单价、可追溯的价值交换。

## 我们要解决什么问题

今天很多 AI 工作流看起来自动化了，但经济模型仍然是粗粒度的：

- 要么按月订阅，无法反映真实使用量
- 要么单次调用价格过高，不适合高频 agent 协作
- 要么把结果展示成黑盒，无法回答“这一步值不值得付费”

这会直接卡住智能体经济的三个核心问题：

1. **单步动作无法精确定价**
2. **高频调用在传统 Gas 成本下不经济**
3. **调用结果、支付过程和链上证据彼此割裂**

`Arc Signal Desk` 的目标，就是把这三件事压进一个完整闭环。

## 产品结构

我们把产品拆成三层：

### 1. 可计价的 Agent Tool Layer

- `summary`
- `entities`
- `relations`

每个工具都可以作为独立的付费动作被调用，适合人类手动使用，也适合上层 agent 自动编排。

### 2. 可阅读的 Decision Layer

`/demo/live` 不是单纯的开发者控制台，而是一个“从输入到判断”的工作台。它让用户在一个页面内完成：

- 导入线索
- 观察分析状态
- 阅读执行摘要
- 核验关键判断
- 追踪证据与支付凭证

### 3. 可审计的 Evidence Layer

我们保留三类证据：

- 调用日志
- 支付元数据
- Arc `UsageReceipt` 链上凭证

这样既能讲清“每一步发生了什么”，也能讲清“每一步为什么值得被付费”。

## 为什么这件事适合 Arc + Circle

这次黑客松主题的关键，不只是“支持支付”，而是**支持具备经济可行性的高频、超低价支付**。这正是我们方案最强的契合点：

- **Sub-cent pricing**：我们把 AI 分析拆成按动作计费，而不是打包成重型订阅。
- **USDC-native economics**：定价和结算都围绕稳定币展开，更适合真实业务口径。
- **Arc-native settlement story**：我们既能演示实时工作流，也能补充链上 receipt 作为评审证据。
- **Agent-ready orchestration**：除了浏览器体验，我们还支持 agent session runner，把多个付费动作串成自动化流程。

## 我们的核心优势

### 优势 1：不是“一个会收费的 API”，而是一套可演示的 agentic transaction loop

很多项目只能证明“这里有支付能力”，但很难证明“支付之后，业务动作如何自然推进”。我们的 live desk + agent runner + graph 页面，把支付、分析、展示和证据串成了一条自然链路。

### 优势 2：按次付费粒度足够细，最能体现 Arc 的经济价值

如果每次动作只有几美厘甚至更低，传统 gas 开销会迅速侵蚀毛利；而本项目故意把价值密度压低，正好突出 Arc + Nanopayments 的必要性，而不是把它们当成普通支付通道。

### 优势 3：既能本地稳定演示，也能切到真实 Gateway / Arc 证据

我们保留了 `mock` 路径，方便开发与现场兜底；同时也有真实 gateway buyer、真实 seller middleware、可选 Arc receipt。这让项目既可交付，也可答辩。

### 优势 4：对评审很友好，能看见“价值交换发生在什么地方”

评审不需要去理解复杂后端日志，只需要看：

- live workbench 的状态推进
- graph 页的结构化结果
- artifacts 中的调用记录
- receipt 的链上哈希

就能理解系统是在“为动作定价”，而不是在做概念展示。

### 优势 5：天然适合扩展成更大的 agent economy 基础设施

当前我们聚焦在情报分析场景，但底层模式可以平移到：

- API 单次调用变现
- agent 之间的工具调用结算
- 按查询次数计费的数据服务
- 按计算时长计费的机器工作流

## 我们满足了哪些黑客松核心要求

### 真实单次操作定价

当前产品把 `summary / entities / relations` 设计为独立计价动作，天然满足“按次付费”的展示要求。

### 高频交易逻辑

项目包含批量 demo runner、gateway buyer runner 和 agent session runner，可以展示高频、多步、多次调用的数据与证据。

### 利润逻辑说明

我们的核心论点很直接：

- 单次 AI 工具动作的价值可以低到 sub-cent 量级
- 如果每次都承担传统 gas 成本，利润空间会被快速吃掉
- 因此需要 Arc + Circle Nanopayments 这类稳定币原生、面向高频微支付的基础设施

### 链上证据

项目用 `UsageReceipt` 合约把成功调用映射到 Arc 上的 receipt 交易，为“至少 50 笔链上交易”这一类评审口径提供可审阅证据。

## 建议对外讲法

如果要在 README、答辩或提交表单里用一句话概括，可以这样说：

> Arc Signal Desk turns AI research actions into economically viable, sub-cent transactions on Arc, so users and agents can pay for exactly the next piece of work instead of overpaying through subscriptions or gas-heavy settlement.
