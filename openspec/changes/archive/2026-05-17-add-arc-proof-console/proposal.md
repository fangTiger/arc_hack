# 变更：添加 Arc Proof Console

## 为什么
当前 ERC-8004 / ERC-8183 proof runner 只能通过 CLI 运行，演示者不能在现有 `/arc/sd/live` 界面里直接触发 Arc 官方标准证据创建。为了增强 builder 证明包的产品完整度，需要把已验证的链上 proof 能力接到服务端 API 与工作台界面。

## 变更内容
- 新增服务器端 Arc proof API，用于读取 `.env` 中的 Arc 测试网配置并触发 ERC-8004 / ERC-8183 runner。
- 在 `/arc/sd/live` 新增 proof console 面板，展示配置状态、执行状态、artifact 摘要与 ArcScan 链接。
- 保持私钥只在服务端环境变量中读取，浏览器请求不得提交或回显私钥。
- 更新 README / runbook，说明 UI 与 CLI 两种 proof 创建路径。

## 非目标
- 不做 Arc House 发帖、社区积分、Grant 申请提交。
- 不在浏览器表单中收集或保存私钥。
- 不引入新外部依赖。

## 影响范围
- 受影响的规范：`paid-knowledge-extraction-api`
- 受影响的代码：`src/app.ts`、`src/routes/*`、`src/domain/arc-standards/*`、`tests/*`
- 受影响的文档：`README.md`、`docs/runbooks/arc-circle-demo.md`
