# 执行记录

## 2026-04-29（M0~M5 实施）

### 完成的里程碑（全部 P0）

| 里程碑 | 分支 | PR | merge commit | 测试 |
|-------|------|-----|--------------|------|
| M0 基础设施 | feature/m0-infra | #1 | c8ec942 | 8 passed |
| M1 编排引擎 + SSE | feature/m1-pipeline | #2 | a4def45 | 11 passed |
| M2 4 个 Agent | feature/m2-agents | #3 | 5f65a71 | 14 passed |
| M3 前端可视化 | feature/m3-ui | #4 | 214ed0f | 19 passed + npm build |
| M4 即梦桥 + 资产 | feature/m4-jimeng | #5 | 4703b1f | 28 passed + npm build |
| M5 Pilot 数据 + e2e | feature/m5-pilot | #6 | 7316e68 | 29 passed (含 3 主题 e2e) |

### 工程亮点

- 每个里程碑都派独立子 agent 做冷启动审核，记录 ❌ 阻塞项，修复后再合并。
- M1 子 agent 发现 broadcaster 跨线程访问 asyncio.Queue 是真实 bug，改用 queue.Queue + asyncio.to_thread。
- M2 子 agent 发现 rl_wrong_craft 红线 trigger 是死代码，改写成语义检查。
- M3 子 agent 发现 hidden 档过滤错了 + offset 分页竞争，已修复。
- M4 子 agent 发现即梦提示词把 markdown 元说明也注入了，改为只取 ```text 围栏内容；同时补 F8.6 命名规范、F8.2 候选上限、500MB size limit。

### 端到端 Pilot 跑通

3 主题 × 15 镜：景德镇制瓷 / 苏绣 / 川剧变脸 全部 success，各 15 即梦提示词。

### 待人工验收

- 用户复制 45 条即梦提示词到即梦官网，人工生成视频。
- 视频回传到 /projects/{id}/shots 页面，填入 5 分制评分 + 失败标签。
- 按 docs/pilot-result.md 表格汇总，判定方向是否进入 P1。

## 2026-04-30

### 已完成

- 明确三方协作方式：GitHub 作为唯一代码交换入口，Claude 在 VPS 编码，本地助手做架构把关和 PR 审核。
- 新增 `docs/collaboration.md`，记录分支命名、Claude 交付包、本地审核重点和首个 M0 任务指令。
- 新增 `.github/pull_request_template.md`，统一 PR 范围、验证输出和 P0 边界自检。
- 更新 README 文档入口，补充协作文档。

## 2026-04-29

### 已完成

- 初始化 git。
- 明确项目定位：通用型 AI 视频生成平台，非遗纪录片为首个深调方向。
- 明确视频执行：方案 A，即梦官网手动生成并回传。
- 明确 P0：先做非遗纪录片 15 镜 pilot。
- 明确 MVP 智能体：研究、编剧、分镜、质检（按工作流阶段划分，不设执行智能体）。
- 明确模型分工：GPT-5.5 负责逻辑与真实性，Claude Opus 4.7 负责语言与文化语气，GPT Image 2 负责视觉。
- 明确检索：不用向量库和 reranker，采用结构化事实库、知识图谱、全文检索、层级摘要、Agentic 查询规划。
- 明确暂不接：ASR、独立 OCR、视频理解模型、自动视频质检。
- 完成文档瘦身：10 份拆散文档压缩为 4 个审核入口。

### 已细化（架构层）

- 智能体重新按工作流阶段划分，与模型策略对齐。
- 检索补充查询规划路由、SourceSpan 格式、知识图谱构建流程。
- 资产去掉 pin 机制，改为 draft/accepted/rejected 版本状态，每阶段最多 3 候选。
- 存储分层：元数据入库，资产文件 P0 用本地目录，P1 迁对象存储。
- 版权字段按来源类型（AI 生成 / 用户上传 / 第三方授权）分别定义填充规则。
- 执行可视化补充失败处理（自动重试策略、红线直拒、即梦失败人工标记）和重跑追溯（parent_step_id）。

### 已细化（pilot 层）

- 评分从 7 维改为单一 5 分制 + 失败标签（多选），降低主观性。
- 失败处理：每镜头最多 3 次生成，按失败标签触发对应的提示词调整规则。
- 成功标准补充阈值依据（60% 可用率、三类镜头各 ≥ 2 个）。

### 新增三份核心文档

- `docs/design.md`：分层架构、统一 Agent 协议、可见性三档设计、通用底座与纪录片微调层划分、关键架构决策记录。
- `docs/architecture.md`：实现层细节，避免和 design 重复。
- `docs/task-plan.md`：M0~M6 里程碑分解，每个里程碑有具体任务、产出、验收标准、依赖关系。
- `docs/requirements.md`：F1~F12 共 12 类功能需求，每条标注 P0/P1/P2 优先级，含非功能需求和 P0 整体验收清单。

### 本轮自检修正

- 将原“思维过程”表述统一改为 `progress_note`，只保存可公开推理摘要和决策依据，不保存模型原始思维链。
- 将视频阶段评分改为“人工评分为主”，质检 agent 只基于人工失败标签、备注和可选截图生成归因与重跑建议。
- 重新划分 `design.md` 与 `architecture.md` 职责：前者写设计原则和决策，后者写实现细节，减少重复。

明确了三条核心原则：能跑通优先、过程全透明、可见性可折叠。

### 当前文档

- `docs/README.md`
- `docs/design.md`
- `docs/task-plan.md`
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/documentary-pilot.md`
- `docs/task-log.md`

### Git 记录

- `8a73935`：建立非遗纪录片 pilot 策略。
- `d2d5aca`：建立模型策略。
- `6718107`：修正检索和平台范围。
- `6b8b4d0`：合并审核材料。

### 下一步

- M0 基础设施搭建：确定技术栈，初始化项目骨架（前后端 + 数据库）。
- 实现 ModelRouter，连通 GPT-5.5 和 Claude Opus 4.7。
- 创建 `configs/documentary/` 目录结构，编写各 agent 的 prompt 模板。
- 定义 FactCard / Entity / Relation / ShotAsset / Step / StepEvent 的字段 schema。
