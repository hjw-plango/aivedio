# 协作流程

## 结论

GitHub 作为唯一代码交换入口。

Claude 在远程 VPS 上负责编码、运行命令、提交分支、发起 PR。

本地助手负责架构判断、需求边界、PR/diff/code review、阶段验收意见。

SSH 只用于 Claude 连接 VPS 开发和跑服务，不用于多人直接编辑同一份代码文件。

## 仓库与分支

```text
main                 稳定主线，只合并通过审核的代码
feature/m0-infra    M0 基础设施
feature/m1-pipeline M1 工作流编排
feature/m2-agents   M2 智能体与提示词
feature/m3-ui       M3 可视化前端
feature/m4-jimeng   M4 即梦手动桥
feature/m5-pilot    M5 非遗纪录片 15 镜 pilot
```

每个分支只做一个里程碑或一个明确子任务。跨里程碑需求进入下一条分支。

## 本地首次推送 GitHub

在 GitHub 新建空仓库后，本地执行：

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
git branch -M main
git push -u origin main
```

当前仓库尚未配置 remote，配置后用 `git remote -v` 校验。

## Claude 在 VPS 的工作方式

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
git checkout -b feature/m0-infra
```

Claude 每次交付必须 push 分支，不直接改 `main`。

Claude 的交付包固定包含：

```text
branch
commit hash
diff stat
changed files
implementation summary
commands run
test output
known issues
```

## 给 Claude 的首个任务

```text
请按 docs/task-plan.md 的 M0 实现基础设施骨架，只做 M0，不实现真实 Agent。

边界：
- 不修改 AIComicBuilder-main/ 和 waoowaoo-main/。
- 不实现即梦自动化，只保留方案 A 的手动桥设计。
- 不接 ASR、独立 OCR、视频理解模型、自动视频质检。
- 不保存模型原始思维链，只保存 progress_note。
- 不扩大 P0 范围，P0 只服务非遗纪录片 15 镜 pilot。

交付：
- 建立项目骨架。
- 补齐最小配置样例。
- 提供可运行命令。
- 提供测试或最小 smoke check。
- push 到 feature/m0-infra 并提交 PR。
```

## 本地助手审核方式

把 Claude 的 PR 链接、commit hash、diff 摘要和测试输出发给本地助手。审核重点固定为：

```text
是否符合 P0 边界
是否破坏方案 A
是否误改参考项目
是否出现重复文档或过度工程
是否保存了不该保存的模型原始思维链
是否能按 README / task-plan 描述跑通
```

通过审核后再合并到 `main`。合并后在 `docs/task-log.md` 记录 commit 与阶段结果。

