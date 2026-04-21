# 项目级 Codex 指令模板

> 本文件是 `codex-codex-dev` 模式下发到目标项目的 `.codex/instructions.md` 模板。
> 目标：让 Codex 进入任意项目后，优先遵循项目根 `AGENTS.md` 与项目 docs，而不是只依赖全局默认行为。

---

## 1. 入口规则（强制）

开始任何非平凡任务前，必须按以下顺序阅读：
1. 项目根 `AGENTS.md`
2. 项目背景文档（如 `CODE_WIKI.md` / `README.md`，以项目实际存在为准）
3. 如涉及 proposal / spec / plan / change，再检查 `openspec/config.yaml`、`openspec/changes/` 与 `openspec/specs/`
4. 按任务类型补读 `docs/` 下对应细粒度文档
5. 读取文档的目的，是为交付代码与验证结果服务，而不是停留在无限分析阶段

---

## 2. 工作方式（强制）

1. 先分析，再编码
2. 不跳过项目已有的分层、异常、HTTP、日志、验证规范
3. 不重复造轮子，优先检查已有 utils / enums / patterns
4. 完成改动后必须给出验证证据
5. 无法验证时必须明确说明原因与补验证建议
6. 若仓库存在并行任务，优先使用独立 git worktree，不在同一 worktree 复用 `.codex/session-state.md`

---

## 2.5 小任务执行偏好（强烈建议）

对于以下任务，默认优先按“小任务轻量路径”处理：
- bug 修复
- 明确目标文件的局部改动
- 小型接口/DTO/Service 增量
- 文档已明确约束、无需架构决策的实现任务

如果同时满足：
- 目标明确
- 影响范围有限
- 不需要 OpenSpec
- 没有真实阻塞

则应优先尝试完成最小交付，而不是无理由停留在泛泛分析阶段。

如果暂时不交付代码，必须明确说明：
1. 当前阻塞点是什么
2. 哪些信息仍待确认
3. 为什么当前不宜直接落代码

推荐在完成后输出：
1. 读取了哪些文档
2. 修改了哪些文件
3. 做了哪些验证
4. 哪些内容未验证及原因

## 3. 文档加载原则

如果项目已有细粒度 docs，应按任务类型选择加载：
- 枚举 / 常量 → `docs/reference/*`
- API / Controller / Service → `docs/guide/*`
- 领域理解 → `docs/domain/*`

如果项目尚未建立完整 docs 体系，则至少应遵循：
- `AGENTS.md`
- 项目背景文档
- 相关模块现有实现

## 3.5 并行任务规则（强制）

若发现当前仓库已有其他活跃任务或 `.codex/session-state.md` 明显属于其他任务：

1. 默认将新任务放入独立 worktree
2. 使用 `superpowers:using-git-worktrees` 创建隔离工作目录
3. 只在该 worktree 内维护自己的 `.codex/session-state.md`
4. 不直接覆盖其他任务的状态文件

---

## 4. 禁止事项

- 禁止跳过项目根 `AGENTS.md`
- 禁止不看现有规范就新增平行实现
- 禁止只凭个人习惯覆盖项目既有风格
- 禁止在未说明验证情况时声称“已完成”
