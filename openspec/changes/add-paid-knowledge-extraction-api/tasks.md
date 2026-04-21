## 1. 实现任务

- [x] 1.1 建立 V1 服务骨架与基础配置
  Executor: Inner Codex
  目标：初始化 Node.js + TypeScript + Express 项目结构、环境配置、测试框架与基础目录。

- [x] 1.2 建立知识抽取领域模型与 AI 适配层
  Executor: Inner Codex
  目标：定义请求/响应 schema，支持 `mock` 与 `real llm` 两种模式，保证无外部密钥时也可运行。

- [x] 1.3 建立支付适配层与三类付费 endpoint
  Executor: Inner Codex
  目标：实现 `summary`、`entities`、`relations` 三个 endpoint，并支持 `mock payment` 与 `circle gateway` 两种支付模式。

- [x] 1.4 建立演示数据、批量 buyer 与证据导出
  Executor: Inner Codex
  目标：支持批量发起付费调用、输出调用统计、价格统计、支付结果与演示产物，并为后续 receipt 写链保留稳定 requestId。

- [ ] 1.5 建立 `UsageReceipt` 合约、部署脚本与写链流程
  Executor: Inner Codex
  目标：部署最小 Arc 凭证合约，并在批量演示流程中为每次成功调用写入一笔 receipt 交易。

- [ ] 1.6 建立运维/演示辅助接口与文档
  Executor: Inner Codex
  目标：补充健康检查、运营统计接口，以及本地运行、Arc/Circle 配置、合约部署、演示步骤、风险说明文档。

- [ ] 1.7 完成验证并回填交付证据
  Executor: Inner Codex
  目标：运行测试、构建、批量演示脚本，将结果整理到交付文档中，并输出 `50 次成功调用 + 50 笔 receipt tx` 的证据。
