## 1. 实现任务

- [x] 1.1 建立 buyer 配置与支付编排层
  Executor: Inner Codex
  目标：封装官方 `GatewayClient` 的创建、余额检查、自动充值与支付调用能力，并为 POST 探测提供可测试的辅助函数。

- [x] 1.2 建立真实 buyer demo 脚本与产物导出
  Executor: Inner Codex
  目标：新增独立 buyer runner，支持批量真实支付、产物写出与可选 receipt 写链。

- [x] 1.3 补充测试与文档
  Executor: Inner Codex
  目标：覆盖 buyer 编排逻辑、脚本行为、环境变量解析与 runbook，明确 seller 启动、buyer 支付、充值与验收步骤。

- [ ] 1.4 完成验证并提交原子变更
  Executor: Outer Codex + Inner Codex
  目标：运行针对性测试、全量测试、构建与 OpenSpec 校验，并形成原子提交。
