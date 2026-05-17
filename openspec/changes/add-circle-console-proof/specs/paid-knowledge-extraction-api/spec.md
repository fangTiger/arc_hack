## ADDED Requirements

### Requirement: 支持 Circle Console proof 与合约归因
系统 MUST 提供 Circle Console proof 能力，让操作者可以用服务端 `CIRCLE_API_KEY` 验证 Circle Developer Console 账号可用，并将项目已部署的 Arc `UsageReceipt` 合约导入 Circle Contracts library。

#### Scenario: status 接口展示 Circle Console 配置状态
- **当** 操作者调用 `GET /api/circle/console/status`
- **则** 系统返回 `CIRCLE_API_KEY` 是否配置、`USAGE_RECEIPT_ADDRESS` 是否配置、最近 artifact 摘要与 `runEnabled`
- **且** 响应不得包含 API key、Entity Secret、Kit Key 或同类敏感值

#### Scenario: 未启用时拒绝执行 Circle Console proof
- **当** 操作者调用 `POST /api/circle/console/proof`
- **且** 服务端未显式设置 `CIRCLE_CONSOLE_PROOF_ENABLED=true`
- **则** 系统返回 `403`
- **且** 不得调用真实 Circle API

#### Scenario: 请求体包含敏感字段时拒绝执行
- **当** 操作者调用 `POST /api/circle/console/proof`
- **且** 请求体包含 `apiKey`、`secret`、`password`、`token` 或同类敏感字段
- **则** 系统返回 `400`
- **且** 响应不得回显敏感值
- **且** 不得调用 proof service

#### Scenario: 执行 Circle Console proof
- **当** 服务端配置了 `CIRCLE_API_KEY`、`USAGE_RECEIPT_ADDRESS`
- **且** 服务端显式设置 `CIRCLE_CONSOLE_PROOF_ENABLED=true`
- **且** 操作者触发 Circle Console proof
- **则** 系统使用服务端 API key 调用 Circle API 验证 Wallets / Contracts 权限
- **且** 系统将 `UsageReceipt` 合约导入 Circle Contracts library，或在已有相同合约记录时跳过重复导入
- **且** 响应与 artifact 返回不含敏感值的合约 ID、合约地址、导入状态、时间戳与 artifact 路径

#### Scenario: Circle API 错误安全失败
- **当** Circle API 返回认证失败、网络错误或不支持当前链
- **则** 系统返回安全错误信息
- **且** 响应不得包含 `CIRCLE_API_KEY`、Authorization header 或其他敏感配置值

#### Scenario: live workbench 展示 Circle Console proof 入口
- **当** 操作者访问 `/arc/sd/live`
- **则** 页面展示 Circle Console proof 状态与触发按钮
- **且** 页面从 `/api/circle/console/status` 读取状态
- **且** 页面触发 proof 时调用 `/api/circle/console/proof`
