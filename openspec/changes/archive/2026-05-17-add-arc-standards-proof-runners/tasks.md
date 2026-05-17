## 1. 实现任务

- [x] 1.1 建立 Arc standards 常量、ABI 与 artifact 类型
  Executor: Inner Codex
  目标：新增 `src/domain/arc-standards/` 基础模块，集中定义官方合约地址、最小 ABI、状态枚举和 artifact schema。

- [x] 1.2 实现 ERC-8004 agent proof runner
  Executor: Inner Codex
  目标：按 TDD 新增 agent 注册、reputation、validation 流程和 CLI 脚本，输出可审阅 JSON artifact。

- [x] 1.3 实现 ERC-8183 job lifecycle proof runner
  Executor: Inner Codex
  目标：按 TDD 新增 job escrow / settlement 流程和 CLI 脚本，输出可审阅 JSON artifact。

- [x] 1.4 更新文档与运行入口
  Executor: Inner Codex
  目标：更新 `package.json` scripts、`.env.example`、README 与 Arc/Circle runbook，说明技术路径、环境变量和 artifact 输出。

- [x] 1.5 审查与验证
  Executor: Outer Codex + Review Codex
  目标：运行 OpenSpec validate、构建、单测；由 reviewer 审查范围、TDD 证据、敏感信息处理和文档一致性。
