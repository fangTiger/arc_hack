# Arc Proof Console Design

## 决策

### 服务端 API
新增 `createArcProofRouter`，挂载到 `/api/arc/proofs`：

- `GET /status` 返回 ERC-8004 / ERC-8183 的配置状态、最近 artifact 摘要，以及 `runEnabled` 开关状态。
- `POST /erc8004` 先拒绝敏感请求字段，再检查 `ARC_PROOF_CONSOLE_ENABLED===true`，最后才读取 `process.env` 中的 `ARC_AGENT_*` 配置并调用现有 `runErc8004AgentProof`。
- `POST /erc8183` 先拒绝敏感请求字段，再检查 `ARC_PROOF_CONSOLE_ENABLED===true`，最后才读取 `process.env` 中的 `ARC_JOB_*` 配置并调用现有 `runErc8183JobProof`。

API 不接受私钥字段。错误信息必须通过现有 sensitive sanitizer 处理，避免泄露 `.env` 中的密钥。
默认不开启链上广播；只有服务端显式设置 `ARC_PROOF_CONSOLE_ENABLED=true` 时，proof console 的 POST 接口才允许执行。测试环境下默认 service 仍额外阻止真实 runner。

### UI
在 `/arc/sd/live` 的现有控制区附近增加 `Arc Proof Console` 面板。面板提供：

- ERC-8004 / ERC-8183 配置状态。
- 两个触发按钮：创建 agent proof、创建 job proof。
- 运行中禁用按钮并显示状态。
- 当 `runEnabled` 为 false 时禁用按钮，并提示需要设置 `ARC_PROOF_CONSOLE_ENABLED=true`。
- 成功后展示 `agentId` / `jobId`、最终状态、主要 tx hash 和 ArcScan 链接。
- 失败后展示安全错误信息。

视觉策略沿用当前工作台的低调工具面板风格，避免新增独立 landing section。

### 测试策略
使用依赖注入的 proof service 测 API，不触网。成功路径测试必须显式注入 `ARC_PROOF_CONSOLE_ENABLED=true`。未启用时 POST 返回 `403` 且 injected service 不得被调用。UI 测试检查页面包含 proof console、按钮禁用逻辑、`runEnabled` 状态处理、JS 调用路径与安全文案。保留 CLI runner 测试。

### 安全边界
私钥只从服务端环境变量读取，不通过请求体、HTML、JSON 响应或 artifact 回显。UI 只展示公钥地址、tx hash、ArcScan 链接和配置是否完整。proof console 默认关闭，避免在未显式授权的运行时暴露链上广播入口。
