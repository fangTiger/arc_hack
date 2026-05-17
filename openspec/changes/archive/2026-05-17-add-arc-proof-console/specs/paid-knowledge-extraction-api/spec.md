## ADDED Requirements

### Requirement: 支持页面触发 Arc standards proof 创建
系统 MUST 在 live workbench 中提供 Arc standards proof console，让操作者可以从页面触发 ERC-8004 agent proof 与 ERC-8183 job proof 创建。

#### Scenario: 页面展示 proof console
- **当** 操作者访问 `/arc/sd/live`
- **则** 页面展示 Arc proof console
- **且** 页面展示 ERC-8004 与 ERC-8183 的配置状态
- **且** 页面从 `/api/arc/proofs/status` 读取 `runEnabled`
- **且** 在 `runEnabled=false` 时禁用 ERC-8004 与 ERC-8183 proof 创建控件，并提示需要设置 `ARC_PROOF_CONSOLE_ENABLED=true`

#### Scenario: status 接口返回运行期开关
- **当** 操作者调用 `GET /api/arc/proofs/status`
- **则** 系统返回 ERC-8004 与 ERC-8183 的配置状态
- **且** 响应包含 `runEnabled`
- **且** 响应中的 artifact 摘要与错误字段不得泄露私钥

#### Scenario: 页面触发 proof 但运行期开关未启用
- **当** 操作者调用 `POST /api/arc/proofs/erc8004` 或 `POST /api/arc/proofs/erc8183`
- **且** 服务端未显式设置 `ARC_PROOF_CONSOLE_ENABLED=true`
- **则** 系统返回 `403`
- **且** 系统不得调用 proof service 或真实 runner

#### Scenario: 页面触发 ERC-8004 proof
- **当** 操作者在服务端已配置 Arc RPC、owner 私钥、validator 私钥和 agent metadata URI
- **且** 服务端显式设置 `ARC_PROOF_CONSOLE_ENABLED=true`
- **且** 操作者在页面触发 ERC-8004 proof
- **则** 系统在服务端调用 ERC-8004 proof runner
- **且** 响应返回不含私钥的 agentId、tx hash、ArcScan 链接和 artifact 路径

#### Scenario: 页面触发 ERC-8183 proof
- **当** 操作者在服务端已配置 Arc RPC、client 私钥、provider 私钥和 USDC 预算
- **且** 服务端显式设置 `ARC_PROOF_CONSOLE_ENABLED=true`
- **且** 操作者在页面触发 ERC-8183 proof
- **则** 系统在服务端调用 ERC-8183 proof runner
- **且** 响应返回不含私钥的 jobId、最终状态、tx hash、ArcScan 链接和 artifact 路径

#### Scenario: 请求体包含敏感字段时拒绝执行
- **当** 操作者调用任一 proof POST API
- **且** 请求体包含 `privateKey`、`ownerPrivateKey`、`secret`、`password` 或同类敏感字段
- **则** 系统返回 `400`
- **且** 响应不得回显敏感值
- **且** 系统不得调用 proof service

#### Scenario: proof 配置缺失时安全失败
- **当** 操作者触发 proof 创建但服务端缺少必要环境变量
- **则** 系统返回 `400`
- **且** 响应列出缺失配置项但不泄露任何已有私钥值

#### Scenario: proof 执行中出现链上错误
- **当** proof runner 执行失败
- **则** 系统返回 `500`
- **且** 响应包含安全错误信息
- **且** 响应不得包含任何私钥值
