## ADDED Requirements

### Requirement: 支持页面触发的 Live Agent 演示台
系统 MUST 提供一个页面触发的 live console，让演示者输入单条文本后在同一页面里按阶段观察 agent session 的运行进度、支付证据和最终图谱。

#### Scenario: 创建 live session
- **当** 演示者在 live console 页面提交标题和文本
- **则** 系统创建一个新的 live session
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
- **当** 演示者提交空文本或无效输入
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

## MODIFIED Requirements

### Requirement: 支持知识图谱演示页面
系统 MUST 提供基于单次 agent session 产物的网页展示页面，直观呈现摘要、节点、边以及支付证据。

#### Scenario: 查看最新 session 的图谱页面
- **当** 演示者访问最近一次 agent session 的 graph 页面
- **则** 系统展示该 session 的摘要、实体节点、关系边和支付摘要
- **且** 页面包含每次工具调用的关键证据字段

#### Scenario: 按 sessionId 查看历史图谱页面
- **当** 演示者访问指定 `sessionId` 的 graph 页面
- **则** 系统读取对应 session 产物并渲染页面
- **且** 若 session 不存在则返回 `404`

#### Scenario: 从 live console 进入最终图谱
- **当** live console 中某次运行成功完成
- **则** 页面可以直接展示最终图谱或提供明确入口进入对应 graph 页面
- **且** 演示者无需重新输入 sessionId

### Requirement: 提供部署与演示文档
系统 MUST 提供从本地运行到 Arc/Circle 真实配置的部署与演示文档。

#### Scenario: 按文档配置真实 buyer 演示
- **当** 新成员按照项目文档准备 seller 与 buyer 所需环境变量
- **则** 可以启动 `PAYMENT_MODE=gateway` 的 seller 服务
- **且** 可以使用官方 buyer SDK 对知识抽取接口完成真实支付调用
- **且** 可以根据文档确认余额、充值、支付结果与 receipt 证据

#### Scenario: 按文档录制 live console 演示
- **当** 新成员按照项目文档启动服务并打开 live console 页面
- **则** 可以输入或填充示例文本并启动一次 live session
- **且** 可以在同一页面里录制步骤推进、支付证据和最终图谱展示
