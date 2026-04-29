# 任务规划

## 里程碑总览

```text
M0  基础设施搭建            ── 项目骨架、数据库、依赖
M1  Agent Pipeline 框架     ── 编排引擎 + StepEmitter + 可见性
M2  四个 Agent 实现          ── 研究 / 编剧 / 分镜 / 质检
M3  前端 Pipeline 可视化     ── 流程图 + 步骤详情 + 产物预览
M4  即梦手动桥 + 资产管理    ── 复制提示词 + 上传回传 + ShotAsset
M5  端到端验证（纪录片 pilot）── 15 镜头跑通全流程
M6  通用平台完善             ── 多项目 + 多方向 + 配置切换
```

P0 = M0 ~ M5。P0 结束的标志：用非遗纪录片 pilot 完整跑通一遍全流程，每步可见，产出 15 条可复制到即梦的提示词。

---

## M0：基础设施搭建

### 目标

项目跑起来，能连数据库，能调 LLM API。

### 任务

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 0.1 | 确定技术栈 | 技术选型文档 | 团队确认 |
| 0.2 | 初始化项目结构 | 前后端项目骨架 | `npm run dev` / `python main.py` 能跑 |
| 0.3 | 创建数据库 schema | 建表脚本（Project, GraphRun, Step, StepEvent, ShotAsset, FactCard, Entity, Relation） | migrate 成功 |
| 0.4 | 实现 ModelRouter | `ModelRouter.call(task_type, prompt)` 能调通 GPT-5.5 和 Claude Opus 4.7 | 两个模型各返回一条测试响应 |
| 0.5 | 创建本地资产目录 | `assets/` + `.gitignore` | 文件可写入和读取 |
| 0.6 | 创建纪录片微调配置 | `configs/documentary/` 目录结构 | 配置文件可加载 |

### 技术栈建议

```text
后端：Python（FastAPI）
  理由：LLM SDK 生态最成熟，Agent 逻辑易写
  备选：Node.js（如果前端团队主导）

前端：Next.js + React
  理由：SSR + API routes，不需要分开部署
  备选：Vite + React（纯 SPA）

数据库：SQLite（P0）→ PostgreSQL（P1）
  理由：P0 单人使用，零运维。schema 与 Postgres 兼容，P1 直接切

ORM：SQLAlchemy（Python）或 Drizzle（Node.js）
  理由：类型安全 + migration 支持

实时通信：SSE（Server-Sent Events）
  理由：agent 事件流是单向推送，SSE 比 WebSocket 简单。P0 够用
```

### 项目目录结构

```text
aivedio/
├── docs/                    # 文档（已有）
├── configs/
│   └── documentary/
│       ├── prompts/         # 各 agent 的 prompt 模板
│       ├── rules/           # 红线、美学、镜头类型
│       └── scoring/         # 评分维度、失败标签
├── server/
│   ├── agents/              # 四个 agent 实现
│   │   ├── base.py          # Agent 基类 + StepEmitter
│   │   ├── research.py
│   │   ├── writer.py
│   │   ├── storyboard.py
│   │   └── review.py
│   ├── engine/              # 编排引擎
│   │   ├── graph_run.py     # 工作流执行
│   │   ├── step.py          # Step 状态管理
│   │   └── router.py        # ModelRouter
│   ├── data/                # 数据层
│   │   ├── models.py        # ORM 模型
│   │   ├── fact_store.py    # FactCard / Entity / Relation
│   │   └── asset_store.py   # ShotAsset
│   ├── bridges/             # 外部对接
│   │   └── jimeng_manual.py # 即梦手动桥
│   └── main.py              # FastAPI 入口
├── web/                     # 前端
│   ├── app/
│   │   ├── projects/        # 项目页面
│   │   ├── pipeline/        # Pipeline 流程图
│   │   └── assets/          # 资产管理
│   └── components/
│       ├── StepCard.tsx      # 单步可视化组件
│       ├── PipelineView.tsx  # 流程图
│       └── VisibilityToggle.tsx
├── assets/                  # 本地资产存储（git ignored）
└── tests/
```

---

## M1：Agent Pipeline 框架

### 目标

编排引擎能调度一个 mock agent 跑完全流程，前端能看到事件流。

### 任务

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 1.1 | 实现 Agent 基类 | `Agent.plan()` + `Agent.run()` + `StepEmitter` | mock agent 能 emit 事件 |
| 1.2 | 实现 GraphRun 引擎 | 工作流定义 + 顺序执行 + 状态流转 | 4 个 mock agent 串联跑完，Step 状态正确 |
| 1.3 | 实现 StepEvent 落库 | 每个 emit 的事件存入 StepEvent 表 | 跑完后数据库有完整事件记录 |
| 1.4 | 实现 SSE 推送 | 后端实时推送事件到前端 | 浏览器 EventSource 能接到事件流 |
| 1.5 | 实现 Step 重跑 | 指定 step_id 重跑，生成新 step + parent_step_id | 重跑后数据正确，原记录不丢 |
| 1.6 | 实现暂停/继续 | 每个 agent 输出后暂停等待确认，用户确认后继续下一步 | 能在任意节点暂停和继续 |

### 关键设计

编排引擎核心循环：

```text
for agent in workflow.agents:
    step = create_step(agent)
    plan = agent.plan(input)
    emit(step, plan)

    output = agent.run(input, emitter)

    if auto_pause:
        step.status = paused
        wait_for_user_confirmation()

    if review_agent.should_check(output):
        review_output = review_agent.run(output, emitter)
        if review_output.has_red_line:
            step.status = rejected
            continue

    step.status = success
    next_input = output
```

---

## M2：四个 Agent 实现

### 目标

四个 agent 各自能独立运行，接真实 LLM 调用，产出格式正确。

### M2.1 研究 Agent

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 2.1.1 | 编写非遗事实抽取 prompt | `configs/documentary/prompts/research.md` | prompt 完整可用 |
| 2.1.2 | 实现资料输入（文本粘贴 / 文件上传） | 输入接口 | 能接受文本和文件 |
| 2.1.3 | 实现 FactCard 抽取 | GPT-5.5 调用 → 结构化 FactCard | 输入一段非遗资料，输出 FactCard 列表 |
| 2.1.4 | 实现 Entity/Relation 抽取 | GPT-5.5 调用 → Entity + Relation | 输出知识图谱节点 |
| 2.1.5 | 实现文化敏感度复核 | Claude Opus 4.7 二次审核 | 复核结果 append 到 FactCard |
| 2.1.6 | emit 全过程事件 | progress_note / tool_call / artifact 事件 | 前端能看到抽取过程 |

### M2.2 编剧 Agent

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 2.2.1 | 编写剧本生成 prompt | `configs/documentary/prompts/writing.md` | prompt 完整可用 |
| 2.2.2 | 实现策划方案生成 | Claude Opus 4.7 → 策划 JSON | 输入 FactCard + brief，输出策划 |
| 2.2.3 | 实现剧本生成 | Claude Opus 4.7 → 剧本文本 | 输出带场次和镜头描述的剧本 |
| 2.2.4 | 实现旁白生成 | Claude Opus 4.7 → 分镜旁白 | 每个镜头有对应旁白 |
| 2.2.5 | emit 全过程事件 | 事件流 | 可见策划→剧本→旁白的生成过程 |

### M2.3 分镜 Agent

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 2.3.1 | 编写分镜生成 prompt | `configs/documentary/prompts/storyboard.md` | prompt 完整可用 |
| 2.3.2 | 编写即梦提示词模板 | `configs/documentary/prompts/shot_prompt.md` | 模板完整可用 |
| 2.3.3 | 实现分镜表生成 | GPT-5.5 → 分镜 JSON（镜号、景别、运镜、主体） | 结构化分镜表可解析 |
| 2.3.4 | 实现即梦提示词生成 | GPT-5.5 → 每个镜头的即梦提示词 | 提示词可直接复制到即梦 |
| 2.3.5 | 实现语气复核 | Claude Opus 4.7 检查广告化倾向 | 复核结果附在提示词旁 |
| 2.3.6 | 实现分镜图生成 | GPT Image 2 → 分镜参考图 | 每个镜头有对应参考图 |
| 2.3.7 | emit 全过程事件 | 事件流 | 可见分镜→提示词→复核→分镜图 |

### M2.4 质检 Agent

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 2.4.1 | 编写质检 prompt | 质检规则配置 | 配置可加载 |
| 2.4.2 | 实现事实对齐检查 | GPT-5.5 比对产物与 FactCard | 输出偏差报告 |
| 2.4.3 | 实现红线检测 | 双模型检查红线规则 | 命中红线时 rejected |
| 2.4.4 | 实现评分建议 | 按评分标准给出 1-5 分 + 失败标签 | 评分可辅助人工决策 |
| 2.4.5 | 实现重跑建议 | 根据失败标签推荐提示词调整 | 建议可直接应用 |
| 2.4.6 | emit 全过程事件 | 事件流 | 可见检查过程 |

---

## M3：前端 Pipeline 可视化

### 目标

用户能在浏览器中看到 pipeline 运行全过程，查看每步产物，控制可见性。

### 任务

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 3.1 | 实现 PipelineView 组件 | 流程图视图，节点表示 agent | 能渲染 4 个 agent 节点 + 连线 |
| 3.2 | 实现 StepCard 组件 | 单步详情卡片 | 显示 input/output 摘要、事件列表、产物 |
| 3.3 | 实现实时事件流 | SSE 接入 | agent 运行时前端实时更新 |
| 3.4 | 实现产物预览 | 文本/JSON/图片/视频内联预览 | 点击产物可查看 |
| 3.5 | 实现可见性三档切换 | 全局 + 单 agent 开关 | detail / summary / hidden 正确工作 |
| 3.6 | 实现暂停/确认/重跑 UI | 按钮 + 确认弹窗 | 用户能暂停、确认继续、触发重跑 |
| 3.7 | 实现进度摘要展示 | 可折叠的 progress_note 区域 | 可公开推理摘要和决策依据可展开查看 |

### UI 线框

```text
┌──────────────────────────────────────────────────────────────────┐
│  项目名称    [可见性：● 详细 ○ 摘要 ○ 黑盒]    [重新执行]       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [研究 ✓] ──→ [编剧 ✓] ──→ [分镜 ▶] ──→ [质检 ○] ──→ [即梦 ○]  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ 分镜 Agent（运行中）                          [暂停] [跳过] ││
│  │                                                              ││
│  │ ▶ progress_note: 根据剧本第 3 场，需要 5 个镜头...           ││
│  │ ✓ tool_call: 查询 FactCard "景德镇拉坯"                    ││
│  │ ✓ artifact: 镜头 1 分镜 — 老作坊外景空镜                    ││
│  │ ▶ progress_note: 生成即梦提示词...                           ││
│  │                                                              ││
│  │ 产物：                                                       ││
│  │ [分镜表 JSON] [即梦提示词 ×5] [分镜图 ×2/5]                 ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## M4：即梦手动桥 + 资产管理

### 目标

用户能复制提示词、上传视频、系统自动绑定。

### 任务

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 4.1 | 实现提示词复制面板 | 每个镜头一个复制卡片 | 一键复制到剪贴板 |
| 4.2 | 实现视频上传 | 拖拽上传 + 选择关联 shot_id | 文件存入 assets/，元数据入库 |
| 4.3 | 实现 ShotAsset 绑定 | 上传后自动创建 ShotAsset | asset 与 shot 正确关联 |
| 4.4 | 实现版本管理 UI | 每个 shot 的候选列表 | draft / accepted / rejected 切换 |
| 4.5 | 实现版权字段填充 | AI 生成自动填充，上传需人工填 | 版权字段完整 |
| 4.6 | 上传后进入人工评分 | 视频上传完成 → 人工评分面板 | 用户填写评分和失败标签后可触发质检建议 |

---

## M5：端到端验证（纪录片 Pilot）

### 目标

用非遗纪录片 15 镜头跑通完整流程。

### 任务

| # | 任务 | 产出 | 验收 |
|---|------|------|------|
| 5.1 | 准备 3 个主题的原始资料 | 景德镇制瓷、苏绣、川剧变脸的文本资料 | 每个主题至少 2000 字 |
| 5.2 | 跑通研究 Agent | 3 组 FactCard + Entity | 事实准确，图谱合理 |
| 5.3 | 跑通编剧 Agent | 3 个策划 + 剧本 | 内容完整，旁白到位 |
| 5.4 | 跑通分镜 Agent | 15 个镜头分镜 + 15 条即梦提示词 | 提示词可直接复制 |
| 5.5 | 即梦手动生成 | 15 个镜头各 1-3 版本 | 视频回传成功 |
| 5.6 | 跑通人工评分与质检建议 | 15 个人工评分 + 失败标签 + 重跑建议 | 评分记录完整，建议合理 |
| 5.7 | 统计成功率 | 汇总表 | 按成功标准判定是否进入 P1 |
| 5.8 | 复盘文档 | 问题清单 + 调整计划 | 记录所有发现的问题 |

### 端到端验收标准

```text
1. 从"输入主题"到"产出评分"全流程能走通，无手动代码干预
2. 前端每一步可见：progress_note、tool_call、artifact 均有展示
3. 可见性切换正常：detail ↔ summary ↔ hidden
4. 暂停/继续/重跑正常工作
5. 15 条即梦提示词格式正确，可直接复制使用
6. 视频回传和评分流程跑通
7. 所有 Step 和 StepEvent 完整入库
```

---

## M6：通用平台完善（P1）

### 目标

支持多项目、多方向，为短剧/漫剧预留入口。

### 任务

| # | 任务 |
|---|------|
| 6.1 | 多项目管理（创建、切换、归档） |
| 6.2 | 方向选择器（documentary / drama / comic） |
| 6.3 | 配置热加载（切换方向时自动加载对应 configs/） |
| 6.4 | 工作流自定义（可跳过某些 agent、可增加自定义步骤） |
| 6.5 | 资产检索与复用（跨项目搜索已有素材） |
| 6.6 | 对象存储迁移（本地 → S3 / OSS） |
| 6.7 | PostgreSQL 迁移 |

---

## 后续里程碑（P2+）

```text
M7  短剧 / 漫剧 pilot
M8  AI + 真素材混合剪辑
M9  即梦自动化探索（网页自动化 / 第三方 API）
M10 多用户 / 权限 / 协作
M11 成本监控 / 用量分析
```

---

## 依赖关系

```text
M0 ─→ M1 ─→ M2 ─→ M3 ─→ M4 ─→ M5
                   ↑         ↑
                   └─────────┘
                  （M3 和 M4 可部分并行）
```

M3（前端）和 M4（即梦桥）在 M2（agent 实现）完成后可并行开发。

M5 依赖所有前置里程碑完成。
