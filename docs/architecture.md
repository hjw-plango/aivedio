# 架构设计

## 文档职责

本文件只记录实现层架构细节：数据结构、状态机、存储、错误处理、模型路由与检索接口。

设计原则、系统分层、Agent 协议、工作流和关键决策记录见 `docs/design.md`。

## 智能体实现边界

按工作流阶段划分，每个智能体对应一个明确的输入→输出边界：

```text
研究智能体
  输入：原始资料（文本、图片、扫描件）
  输出：FactCard、Entity、Relation
  模型：GPT-5.5（事实抽取）+ Claude Opus 4.7（文化敏感度复核）

编剧智能体
  输入：FactCard + 项目 brief
  输出：策划方案、剧本、旁白、采访提纲
  模型：Claude Opus 4.7

分镜智能体
  输入：剧本 + FactCard + 美学边界规则
  输出：分镜表、镜头描述、分镜图提示词、即梦视频提示词
  模型：GPT-5.5（结构与逻辑）→ Claude Opus 4.7（语气复核）→ GPT Image 2（分镜图）

质检智能体
  输入：任意阶段产物 + FactCard + 红线规则
  输出：文本阶段的事实偏差报告、红线报告、重跑建议；视频阶段只基于人工评分与失败标签生成归因建议
  模型：GPT-5.5
  触发：每个阶段产物提交时自动触发，红线判定需双模型一致
```

不设"执行智能体"。文件命名、ShotAsset 绑定、状态流转是数据管理逻辑，由后端服务层处理，不需要 LLM 推理。

暂不拆摄影指导、美术指导等更细粒度智能体。当前 4 个智能体已按输入输出类型隔离，如果某个智能体内部 prompt 冲突，再拆分。

## 模型策略

不按成本优化，优先使用中转站最强模型。分工原则：

- **逻辑深度、事实真实性、结构化输出** → 优先 GPT-5.5
- **内容生成、文化语气、长文本叙事** → 优先 Claude Opus 4.7
- **视觉生成** → GPT Image 2
- **轻量工具调用** → GPT-5.4-mini 或 DeepSeek V4 Flash

具体分配：

```text
研究与事实抽取：GPT-5.5
分镜结构与镜头逻辑：GPT-5.5
即梦视频提示词工程：GPT-5.5
质检（事实对齐、AI 味归因）：GPT-5.5
结构化输出（JSON、字段填充）：GPT-5.5

策划与剧本：Claude Opus 4.7
旁白与解说词：Claude Opus 4.7
采访提纲：Claude Opus 4.7
文化语气复核：Claude Opus 4.7

分镜图 / 首帧 / 尾帧 / 参考图：GPT Image 2
轻量工具操作（文件命名、状态流转、元数据填充）：GPT-5.4-mini / DeepSeek V4 Flash
视频生成：manual_jimeng（即梦官网手动）
```

统一通过 `ModelRouter` 调用，agent 不直接绑定具体模型。

```python
ModelRouter.call(
  task_type,        # research / writing / structure / vision / lightweight
  prompt,
  context,
  cross_check=False
)
```

关键决策点采用交叉复核：

- 事实卡片落库前：GPT-5.5 抽取，Claude Opus 4.7 复核语境与文化敏感度。
- 镜头提示词定稿前：GPT-5.5 生成，Claude Opus 4.7 检查纪录片语气是否被广告化。
- 红线判定（是否伪造真实传承人身份、是否冒充真实历史影像）：双模型一致才放行。

P0/P1 不增加更多文本生成模型。模型越多，风格漂移和责任归因越难。

暂不接入：

- ASR。
- 独立 OCR 引擎。
- 视频理解模型。
- 自动视频质检。

图片、展板、扫描件、说明牌等资料先用多模态 AI 读取，再落成结构化事实。

## 检索策略

不使用向量库和 reranker 作为核心检索方案。

采用：

```text
结构化事实库
+ 知识图谱
+ 上下文全文检索
+ 层级摘要
+ Agentic 查询规划
+ SourceSpan 引用锚点
```

原因：

- 非遗事实、剧情状态、版权来源需要精确可追踪。
- 角色、场景、道具、工艺步骤是关系网络，不是孤立文本块。
- 分镜生成需要顺序、状态、空间关系和素材授权约束。
- 全文检索和图谱路径比黑盒相似度更容易调试。

核心数据：

```text
FactCard：事实、工艺步骤、人物状态、版权来源
Entity：人物、角色、场景、道具、工艺、镜头、资产
Relation：appears_in / uses / before / after / derived_from / requires_real_footage
SourceSpan：事实对应原文位置
EvidencePack：每次生成前的证据包
```

### 查询规划

按问题类型路由到不同检索路径：

```text
事实型问题（"这个工艺有几道工序"）
  → 结构化事实库精确查询

关系型问题（"这个道具在哪些镜头出现"）
  → 知识图谱路径查询

语境型问题（"这段描述的语气"）
  → 上下文全文检索 + 层级摘要

复合问题
  → Agentic 查询规划：拆分子问题，逐个路由，再合并 EvidencePack
```

由 GPT-5.5 做查询规划，输出结构化的子查询计划，不让 LLM 直接执行检索。

### SourceSpan 格式

```text
{
  source_id: 资料唯一 ID
  source_version: 资料版本号
  start: 字符级 offset
  end: 字符级 offset
  hash: 引用片段的内容哈希
}
```

资料更新时，按 hash 比对：

- hash 匹配 → SourceSpan 仍有效。
- hash 不匹配但片段仍可定位 → 自动更新 offset。
- 片段被删除 → 标记 SourceSpan 失效，触发依赖该 span 的 FactCard 复核。

### 知识图谱构建

不做全自动抽取。流程：

```text
1. GPT-5.5 从原始资料抽取候选 Entity 和 Relation
2. 系统按既有图谱去重、合并、冲突检测
3. 冲突项进入人工审核队列
4. 通过审核后入库，附 confidence 和 reviewed_by
```

每个 Entity 和 Relation 都带 confidence 和 SourceSpan，分镜生成时只采用 confidence ≥ 阈值或人工审核通过的节点。

## 资产策略

继续采用 `ShotAsset` 版本化思想，限制候选数量。

### 版本管理

每个镜头的每个阶段最多保留 3 个候选版本。超出时必须淘汰最旧的未标记版本。

版本状态：

```text
draft      → 刚生成，待评估
accepted   → 通过评估，可用于下一阶段
rejected   → 明确不可用
```

进入下一阶段的条件：当前阶段至少有 1 个 accepted 版本。rejected 版本保留记录但不展示，用于分析失败模式。

### 存储

```text
元数据（提示词、评分、状态、版权）→ 数据库
分镜图、参考图（< 10MB）→ 对象存储（P0 阶段用本地 assets/ 目录）
视频文件（> 10MB）→ 对象存储（P0 阶段用本地 assets/ 目录）
```

数据库只存 `file_path` + `file_hash`。每次读取时校验 hash，不匹配则标记资产损坏。

P0 阶段不引入 S3 / OSS，直接用本地目录 + `.gitignore` 排除大文件。P1 迁移到对象存储时只改存储层，不改上层逻辑。

### 核心类型

```text
storyboard_prompt
storyboard_image
jimeng_video_prompt
manual_jimeng_video
reference_image
first_frame
last_frame
real_footage
archive_footage
voice
subtitle
```

### 版权字段

每个资产必须携带版权信息，按来源类型分别填充：

```text
AI 生成资产（分镜图、视频）：
  source_type = ai_generated
  source_platform = jimeng / gpt_image
  license = platform_tos
  creator = system
  review_status = pending → 人工确认后改为 reviewed

用户上传素材（真实拍摄、档案）：
  上传时必填：source_type, license, rights_holder
  系统自动填充：source_platform = user_upload, review_status = pending
  缺少必填字段时拒绝入库

第三方授权素材：
  全部字段人工填写
  review_status 必须由有权限的人改为 cleared 才能进入成片
```

## 执行可视化

每一步都记录到 `Step` 表：

```text
step_id
graph_run_id          # 关联到一次完整执行
agent_name
step_name
status                # pending / running / success / failed / skipped
input_summary
output_summary
artifact_refs         # 关联的 ShotAsset id 列表
warnings
error                 # 失败时的错误信息
retry_count
parent_step_id        # 用于重跑追溯
created_at
finished_at
```

`StepEvent` 表：

```text
event_id
step_id
event_type        # progress_note / tool_call / tool_result / artifact / warning / error / finish
visibility        # detail / summary / hidden
payload
created_at
```

`progress_note` 只能保存可公开的推理摘要、进度说明或决策依据，不保存模型原始思维链。

存储：

- 步骤记录入数据库主表，长期保留。
- input/output 完整内容存对象存储（或本地 `runs/{graph_run_id}/`），数据库只存摘要和引用。

失败处理：

```text
LLM 调用失败 → 自动重试最多 3 次，指数退避
LLM 输出格式错误 → 自动重试 1 次，仍失败则标记 failed 进入人工队列
红线检测不通过 → 直接标记 rejected，不重试，进入人工审核
即梦手动生成失败 → 用户标记 failed_notes，系统记录但不自动重跑
```

重跑机制：

- 任何 failed 或 rejected 步骤可手动触发重跑。
- 重跑生成新 step，`parent_step_id` 指向原步骤，便于追溯。
- 不覆盖原记录。

前端展示：

- 流程图视图，节点对应 step，颜色标识状态。
- 点击节点查看 input/output、artifacts、warnings。
- 不展示单一 loading，让用户看到每个智能体在做什么。

## 即梦手动桥

```text
分镜 Agent 产出 jimeng_video_prompt
→ 系统生成可复制片段（含比例、时长建议、参考图链接）
→ 前端“复制到即梦”按钮
→ 用户在即梦官网生成
→ 前端“上传回传”按钮
→ 系统校验、落 ShotAsset、绑定 shot_id
→ 进入人工评分面板
→ 用户填写评分、失败标签、备注
→ 质检 Agent 生成归因与重跑建议
```

未来若引入网页自动化或第三方 API，只新增 `JimengAutoBridge` 或对应 bridge，工作流的上层数据结构不变。
