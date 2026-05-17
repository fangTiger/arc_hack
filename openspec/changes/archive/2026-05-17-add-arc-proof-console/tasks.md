## 1. 实现任务
- [x] 1.1 新增 Arc proof service / router，提供 status、ERC-8004 run、ERC-8183 run API，并默认关闭链上广播直到显式设置 `ARC_PROOF_CONSOLE_ENABLED=true`。
- [x] 1.2 将 proof router 接入 `createApp`，并为测试提供依赖注入。
- [x] 1.3 在 live workbench 页面新增 proof console 面板与前端交互，并根据 `runEnabled` 禁用按钮与提示开启方式。
- [x] 1.4 更新 `.env.example`、README 与 Arc/Circle runbook，说明 UI 创建路径、默认关闭的运行期开关和私钥边界。
- [x] 1.5 补充 API / UI 测试，覆盖敏感字段拒绝、未启用时 `403`、启用后成功路径、`runEnabled` 状态展示，并运行 build、全量测试、OpenSpec 校验。
