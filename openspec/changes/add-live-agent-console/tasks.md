## 1. 实现任务

- [x] 1.1 建立 live session 状态模型与 store
  Executor: Inner Codex
  目标：定义 live session 的状态结构、步骤结构和文件存储接口，支持创建、更新、读取、读取最近一次 session 和识别当前 active（queued/running）session。

- [x] 1.2 建立 live session API 与进度驱动执行
  Executor: Inner Codex
  目标：抽出 `src` 层可复用 runner service，新增创建、latest、轮询 API；扩展 `mock` 路径支持 progress callback，并把步骤状态实时写入 store。

- [x] 1.3 建立 `/demo/live` 录屏友好演示页面
  Executor: Inner Codex
  目标：提供输入区、sample 填充、阶段卡片、证据摘要和图谱预览，采用轮询驱动的伪实时展示；`gateway` 路径至少能展示整体运行态和最终结果。

- [x] 1.4 补充测试与录屏文档
  Executor: Inner Codex
  目标：覆盖 store、API、页面与 runner 进度回调，补充错误输入/缺失 session/重复创建测试，并补充 README/runbook 中的录屏建议与使用步骤。

- [x] 1.5 完成验证并提交原子变更
  Executor: Outer Codex + Inner Codex
  目标：运行针对性测试、全量测试、构建、OpenSpec 校验、至少一轮 mock live 页面 smoke，以及一轮 gateway 最终完成 smoke，由主控审查后形成原子提交。
