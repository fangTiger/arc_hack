## 1. 实现任务
- [x] 1.1 新增 Circle Console proof domain：环境解析、Circle API client、artifact writer、错误脱敏、UsageReceipt 导入前查重。
- [x] 1.2 新增 `scripts/circle-console-proof-runner.ts`，支持 CLI 生成 proof artifact。
- [x] 1.3 新增 `/api/circle/console/status` 与 `/api/circle/console/proof`，默认由 `CIRCLE_CONSOLE_PROOF_ENABLED=false` 禁止执行。
- [x] 1.4 将 Circle Console proof 卡片接入 `/arc/sd/live`，支持读取状态与从 UI 触发 proof。
- [x] 1.5 更新 `.env.example`、README、runbook，说明 Console key、Entity Secret、Kit Key 的边界与下一步。
- [x] 1.6 补充单元 / 路由 / 页面测试，覆盖不泄密、未启用拒绝、启用成功、import skip/create 分支。
- [x] 1.7 运行 targeted tests、全量测试、build、OpenSpec strict validate。
