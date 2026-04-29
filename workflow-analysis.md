# AI 视频生成工作流深度分析报告

## 直接结论

当前目录里的两个优秀样本分别是：

1. `AIComicBuilder-main`：轻量、直接、适合快速跑通“剧本到动画视频”的端到端流水线。它的优势是路径短、概念清晰、资产版本化做得好，适合作为我们项目的 MVP 工作流参考。
2. `waoowaoo-main`：更接近生产级 AI 影视 Studio。它的优势是任务系统、工作流运行时、资产中心、图式步骤、SSE 进度、计费、模型能力配置都更完整，适合作为我们项目的长期架构参考。

最佳取法不是二选一，而是组合：

- 用 `AIComicBuilder` 的“简单生成链路 + ShotAsset 版本化 + 首尾帧/参考图双模式”作为核心创作流程原型。
- 用 `waoowaoo` 的“任务队列 + GraphRun 工作流 + 多资产中心 + 文本/图像/视频/语音分队列 + 可恢复外部任务轮询”作为生产工程底座。

推荐我们自己的项目定位为：以“小说/剧本 → 角色/场景/道具资产 → 分段剧本 → 分镜面板 → 分镜图候选 → 单镜视频 → 配音/口型 → 时间线合成”为主线的 AI 视频生产平台。

---

## 一、AIComicBuilder 工作流分析

### 1. 项目定位

`AIComicBuilder-main` 是一个“AI 驱动的漫剧生成器”，核心目标是从剧本自动生成动画视频。README 给出的官方流水线是：

```text
剧本输入 → 剧本解析 → 角色提取 → 角色四视图
                                      ↓
                                   智能分镜
                                      ↓
                         参考帧生成 / 首尾帧生成
                                      ↓
                              视频提示词生成
                                      ↓
                              视频生成
                                      ↓
                                 视频合成 + 字幕
```

技术栈：

- Next.js 16 + React 19
- SQLite + Drizzle ORM
- Zustand 状态管理
- OpenAI / Gemini / Kling / Seedance / Veo 等模型供应商
- fluent-ffmpeg 做视频拼接与字幕
- 自研轻量任务队列，基于数据库轮询

核心文件：

- `AIComicBuilder-main/src/lib/db/schema.ts`
- `AIComicBuilder-main/src/lib/pipeline/index.ts`
- `AIComicBuilder-main/src/app/api/projects/[id]/generate/route.ts`
- `AIComicBuilder-main/src/lib/ai/prompts/registry.ts`
- `AIComicBuilder-main/src/lib/shot-asset-utils.ts`
- `AIComicBuilder-main/src/lib/task-queue/queue.ts`

### 2. 数据模型设计

核心实体如下：

- `projects`：项目级信息，包含标题、剧本、世界观、目标时长、生成模式、最终视频地址。
- `episodes`：分集，支持多集长内容。
- `characters`：角色，包含描述、视觉提示、参考图、身高体型、表演风格。
- `characterRelations`：角色关系，用于影响站位、眼神、对抗、亲密关系等构图。
- `storyboardVersions`：分镜版本，支持多版本比较与迭代。
- `shots`：镜头元数据，包含 sequence、prompt、motionScript、cameraDirection、duration、videoScript、transition、compositionGuide 等。
- `shotAssets`：统一的镜头资产表，这是这个项目最值得学习的设计之一。
- `dialogues`：按镜头绑定对白。
- `tasks`：任务队列表。
- `agents` 与 `agentBindings`：允许项目绑定外部 Bailian / Dify / Coze 工作流。

最关键的是 `shotAssets`：

```text
shot_assets
├── shotId
├── type: first_frame / last_frame / reference / keyframe_video / reference_video
├── sequenceInType
├── assetVersion
├── isActive
├── prompt
├── fileUrl
├── status
├── characters
├── modelProvider / modelId
└── meta
```

这个设计把“镜头文本”与“生成资产”彻底拆开。一个 Shot 是稳定的创作单元，首帧、尾帧、参考图、视频都是它下面的可版本化产物。后续做重生成、历史回滚、A/B 对比、候选图选择时，都会轻很多。

### 3. 核心生成链路

#### 3.1 剧本生成与解析

相关文件：

- `src/lib/pipeline/script-outline.ts`
- `src/lib/pipeline/script-parse.ts`
- `src/lib/ai/prompts/registry.ts`
- `src/app/api/projects/[id]/generate/route.ts`

剧本阶段有两个入口：

- `script_outline`：从创意生成大纲。
- `script_generate`：从创意生成完整剧本。
- `script_parse`：把非结构文本解析成结构化剧本 JSON。

提示词中有一个非常强的设计点：剧本生成阶段要求输出机器可读的视觉风格块：

```text
视觉风格：
色彩基调：
时代美学：
氛围情绪：
画幅比例：
参考导演：
```

后续分镜、参考图、首尾帧会用正则解析这些字段，把画风一致性往下游传递。

#### 3.2 角色提取与角色关系

相关文件：

- `src/lib/pipeline/character-extract.ts`
- `src/lib/ai/prompts/character-extract.ts`
- `src/app/api/projects/[id]/generate/route.ts`

角色提取不只是提取名称和描述，还会处理：

- `visualHint`：角色被引用时可追加的短视觉标识。
- `heightCm` 与 `bodyType`：解决多人镜头中身高比例错误。
- `performanceStyle`：表演风格，用于分镜和帧图提示。
- `relationships`：角色关系，用于构图、眼神、肢体对抗。

它还有一个很实用的按集去重逻辑：如果是 episode 级角色抽取，会拿已有主角名和新角色名让 AI 判断哪些是真正新增角色，避免“老张/张总/张先生”被重复建成多个角色。

#### 3.3 智能分镜

相关文件：

- `src/lib/pipeline/shot-split.ts`
- `src/lib/ai/prompts/shot-split.ts`
- `src/lib/ai/prompts/registry.ts`

分镜输出两类数据：

1. 镜头元数据：sceneDescription、motionScript、videoScript、duration、cameraDirection、dialogues、characters。
2. 画面生成所需信息：compositionGuide、focalPoint、depthOfField、soundDesign、musicCue。

值得学习的提示词策略：

- 强制剧本保真，要求每句对白、每个动作、每个物件都有镜头落点。
- 将 motionScript 拆成时间段，要求每段不超过 3 秒。
- 让 videoScript 专门面向 Seedance 风格，避免结构化标签和权重语法。
- 在角色关系存在时，额外注入“关系驱动构图规则”，例如敌对双方必须真实同屏对峙，不能画成背景雕像或虚影。
- 根据视频模型最大时长动态调整分镜 duration 上限。

#### 3.4 两种视觉生成模式

AIComicBuilder 最有价值的产品设计之一是支持两条视觉路线：

##### A. Keyframe 模式

```text
Shot 元数据
  ↓
生成 first_frame / last_frame 提示词
  ↓
生成首帧图
  ↓
基于首帧 + 角色参考图生成尾帧图
  ↓
用首帧 + 尾帧 + videoPrompt 生成视频
```

相关文件：

- `src/lib/pipeline/frame-generate.ts`
- `src/lib/pipeline/video-generate.ts`
- `src/lib/ai/prompts/keyframe-prompts.ts`
- `src/lib/ai/prompts/frame-generate.ts`

关键点：

- 首尾帧提示词先进入 `shot_assets`，状态为 `pending`。
- 真实图片生成后再把 `fileUrl` 写回资产。
- 尾帧生成时会引用首帧图和角色参考图，强化同镜头内部一致性。
- 下一镜头首帧会参考上一镜头尾帧，强化跨镜头连续性。

##### B. Reference 模式

```text
Shot 元数据
  ↓
生成 1-4 张无人场景参考图提示词
  ↓
生成参考场景帧
  ↓
组合角色参考图 + 场景参考图
  ↓
生成 reference video prompt
  ↓
用多参考图生成视频
```

相关文件：

- `src/lib/ai/prompts/ref-image-prompts.ts`
- `src/app/api/projects/[id]/generate/route.ts` 中 `handleGenerateRefPrompts`
- `src/app/api/projects/[id]/generate/route.ts` 中 `handleSingleVideoPrompt`
- `src/lib/ai/prompts/ref-video-prompt-generate.ts`

这个模式的核心思想是：场景参考图必须是纯环境，不能有人。角色一致性交给角色参考图，空间一致性交给场景参考图。这样可以减少图像模型把角色画进环境参考图造成的污染。

#### 3.5 视频生成与合成

相关文件：

- `src/lib/pipeline/video-generate.ts`
- `src/lib/pipeline/video-assemble.ts`
- `src/lib/video/ffmpeg.ts`

单镜视频生成：

- 从 `shot_assets` 找 `first_frame` 和 `last_frame`。
- 生成 videoPrompt。
- 调用 Seedance / Kling / Veo / Wan 等 video provider。
- 将输出作为 `keyframe_video` 或 `reference_video` 写入 `shot_assets`。

视频合成：

- 按 shot.sequence 排序。
- 读取每个镜头的 active video asset。
- 根据 transitionIn / transitionOut 生成转场。
- 读取 dialogues 生成字幕。
- 可加 title card、credits card、BGM。
- 用 ffmpeg 合成最终视频。

### 4. 任务系统

相关文件：

- `src/lib/task-queue/queue.ts`
- `src/lib/task-queue/worker.ts`
- `src/lib/pipeline/index.ts`

AIComicBuilder 的任务系统比较轻量：

- 任务存 DB。
- worker 每 2 秒轮询一次。
- `dequeueTask` 用数据库 UPDATE 原子抢占 pending 任务。
- `failTask` 支持重试，达到 maxRetries 后 failed。
- `registerPipelineHandlers` 把任务类型映射到处理函数。

优点是简单易懂，适合个人项目和本地部署。缺点是并发、心跳、任务恢复、外部异步 API 续接、SSE 进度、跨队列调度都比较弱。

### 5. Agent 外挂机制

AIComicBuilder 允许项目绑定外部智能体：

- Bailian
- Dify
- Coze

相关文件：

- `src/lib/ai/agent-caller.ts`
- `agents/dify/*.dify.yml`
- `agents/bailian/*.zip`
- `agents/coze/*.zip`

可绑定的 Agent 类型：

- script_outline
- script_generate
- script_parse
- character_extract
- shot_split
- keyframe_prompts
- video_prompts
- ref_image_prompts
- ref_video_prompts

这个设计的价值是把 prompt 和流程开放给低代码平台，主项目只负责收敛输出格式与落库。

### 6. AIComicBuilder 的优点

1. 生成链路清晰，适合作为 MVP。
2. `shotAssets` 统一版本化设计非常优秀。
3. 首尾帧模式和参考图模式可以覆盖不同视频模型。
4. 角色关系、身高、视觉标识对画面一致性很有帮助。
5. Prompt Registry 插槽化，允许用户按项目覆盖提示词。
6. 外部 Agent 绑定增加了灵活性。
7. ffmpeg 合成链路完整，支持字幕和 BGM。

### 7. AIComicBuilder 的不足

1. 任务系统偏轻，生产级稳定性不足。
2. 图片、视频、文本、语音没有分队列，资源调度能力弱。
3. 没有完整的 GraphRun / Step / Artifact 工作流运行时。
4. 多用户、计费、权限、资产中心能力较弱。
5. 进度可观测性有限，长任务失败后的恢复能力不足。
6. 分镜和视频生产偏“镜头列表”，不是更精细的“Clip → Panel → VoiceLine”。

---

## 二、waoowaoo 工作流分析

### 1. 项目定位

`waoowaoo-main` 是一个 AI 影视 Studio，支持从小说文本自动生成分镜、角色、场景，并制作成完整视频。它比 AIComicBuilder 更复杂，更像一个真实可运营的 SaaS 产品。

技术栈：

- Next.js 15 + React 19
- MySQL + Prisma ORM
- Redis + BullMQ
- MinIO / COS / local storage
- NextAuth.js
- TanStack Query
- 多队列 worker：text / image / video / voice
- GraphRun 工作流运行时
- 模型能力目录、价格目录、计费账本

核心文件：

- `waoowaoo-main/prisma/schema.prisma`
- `waoowaoo-main/src/lib/task/types.ts`
- `waoowaoo-main/src/lib/task/submitter.ts`
- `waoowaoo-main/src/lib/workers/index.ts`
- `waoowaoo-main/src/lib/workflow-engine/registry.ts`
- `waoowaoo-main/src/lib/run-runtime/service.ts`
- `waoowaoo-main/src/lib/novel-promotion/story-to-script/orchestrator.ts`
- `waoowaoo-main/src/lib/novel-promotion/script-to-storyboard/orchestrator.ts`

### 2. 数据模型设计

waoowaoo 的核心模型更细：

- `Project`：通用项目。
- `NovelPromotionProject`：小说推广/漫剧项目配置，包含分析模型、图片模型、视频模型、语音模型、口型模型、画幅、画风、能力覆盖。
- `NovelPromotionEpisode`：分集，保存小说文本、音频、SRT、speakerVoices。
- `NovelPromotionClip`：从小说切出的剧情片段。
- `NovelPromotionStoryboard`：每个 Clip 对应一个分镜组。
- `NovelPromotionPanel`：分镜面板，是图片、视频、口型同步的核心绑定点。
- `NovelPromotionCharacter`：项目角色。
- `CharacterAppearance`：角色不同形象，支持多候选图和 selectedIndex。
- `NovelPromotionLocation` 与 `LocationImage`：场景/道具资产与多候选图。
- `NovelPromotionVoiceLine`：可配音台词，并可匹配到某个 Panel。
- `Task` 与 `TaskEvent`：异步任务和事件。
- `GraphRun` / `GraphStep` / `GraphEvent` / `GraphArtifact` / `GraphCheckpoint`：图式工作流运行时。
- `UserPreference` / `UsageCost` / `UserBalance` / `BalanceFreeze`：用户模型配置与计费体系。

这套模型说明它的产品思路不是“只生成视频”，而是“围绕视频生产过程沉淀可编辑资产”。

### 3. 任务系统与队列设计

相关文件：

- `src/lib/task/types.ts`
- `src/lib/task/queues.ts`
- `src/lib/task/submitter.ts`
- `src/lib/workers/index.ts`

任务被分成四类队列：

- `text`：分析、分镜、剧本、资产描述、提示词任务。
- `image`：角色图、场景图、分镜图、改图、候选图。
- `video`：面板视频、口型同步。
- `voice`：台词配音、声音设计。

任务类型包括：

- `story_to_script_run`
- `script_to_storyboard_run`
- `image_panel`
- `image_character`
- `image_location`
- `video_panel`
- `lip_sync`
- `voice_line`
- `voice_design`
- `panel_variant`
- `modify_asset_image`
- `analyze_global`
- `reference_to_character`

`submitTask` 是核心入口，它做了很多生产化工作：

- normalize payload。
- 注入 locale。
- 计算 flow metadata。
- 创建 Task。
- 对 run-centric 任务创建或复用 GraphRun。
- 处理 dedupe。
- 准备计费冻结。
- 发布 task.created 事件。
- 将 job 加入 BullMQ。
- enqueue 失败时做计费回滚。

这是我们后续项目很值得复用的工程模式。

### 4. GraphRun 工作流运行时

相关文件：

- `src/lib/run-runtime/service.ts`
- `src/lib/workflow-engine/registry.ts`
- `src/lib/run-runtime/workflow-lease.ts`

GraphRun 把长链路 AI 任务拆成可观察、可恢复、可重试的步骤：

```text
GraphRun
├── GraphStep
├── GraphStepAttempt
├── GraphEvent
├── GraphCheckpoint
└── GraphArtifact
```

工作流定义中有两条核心链：

#### A. story_to_script_run

```text
analyze_characters
analyze_locations
analyze_props
  ↓
split_clips
  ↓
screenplay_convert
  ↓
persist_script_artifacts
```

前三步并行，片段拆分依赖资产分析结果，每个片段再并行转换为 screenplay。

#### B. script_to_storyboard_run

```text
plan_panels
  ↓
detail_panels
  ↓
voice_analyze
  ↓
persist_storyboard_artifacts
```

真实执行时，`detail_panels` 又拆为每个 clip 的多阶段：

```text
clip_x_phase1                 分镜规划
  ↓
clip_x_phase2_cinematography  摄影规则
clip_x_phase2_acting          表演指导
  ↓
clip_x_phase3_detail          分镜细化与视频提示词
```

这个工作流设计比 AIComicBuilder 更专业，原因是它把“导演、摄影、表演、分镜细化”拆成多个专家阶段，而不是一次 LLM 调用包办所有内容。

### 5. Story → Script 工作流

相关文件：

- `src/lib/novel-promotion/story-to-script/orchestrator.ts`
- `src/lib/workers/handlers/story-to-script.ts`
- `lib/prompts/novel-promotion/agent_character_profile.zh.txt`
- `lib/prompts/novel-promotion/select_location.zh.txt`
- `lib/prompts/novel-promotion/select_prop.zh.txt`
- `lib/prompts/novel-promotion/agent_clip.zh.txt`
- `lib/prompts/novel-promotion/screenplay_conversion.zh.txt`

流程：

1. 分析角色、场景、道具，三路并行。
2. 合并已有资产库和新发现资产，避免覆盖旧角色。
3. 用 `agent_clip` 对原文做片段切分。
4. 对切分边界做本地校验，确保 start/end 能在原文中定位。
5. 对每个 clip 并行做 screenplay conversion。
6. 将分析结果写入 GraphArtifact。
7. 事务性落库角色、场景、道具、Clip、Screenplay。

最值得学习的设计是“边界匹配”：

- AI 负责给出 start/end 文本。
- 本地 matcher 验证 start/end 是否能在原文里定位。
- 如果无法定位，就重试或失败。

这能显著减少长文本被 LLM 切丢、切重、改写锚点导致后续不可追溯的问题。

### 6. Script → Storyboard 工作流

相关文件：

- `src/lib/novel-promotion/script-to-storyboard/orchestrator.ts`
- `src/lib/workers/handlers/script-to-storyboard.ts`
- `lib/prompts/novel-promotion/agent_storyboard_plan.zh.txt`
- `lib/prompts/novel-promotion/agent_cinematographer.zh.txt`
- `lib/prompts/novel-promotion/agent_acting_direction.zh.txt`
- `lib/prompts/novel-promotion/agent_storyboard_detail.zh.txt`
- `lib/prompts/novel-promotion/voice_analysis.zh.txt`

每个 Clip 的处理步骤：

1. Phase 1：基础分镜规划。
2. Phase 2A：摄影指导，生成灯光、站位、景深、色调。
3. Phase 2B：表演指导，生成每个角色的微表情、肢体、视线。
4. Phase 3：分镜细化，生成 shot_type、camera_move、description、video_prompt。
5. 合并摄影规则和表演指导到最终 Panel。
6. 全集做 voice_analyze，提取台词并匹配 Panel。
7. 持久化 Storyboard、Panel、VoiceLine。

这个工作流的价值是：

- 分镜图生成前已经有摄影规则和表演规则，图片生成质量会更稳定。
- 对话镜头强制“说话者独立镜头 + 浅景深”，为后续口型同步服务。
- Panel 绑定 `source_text`，可追溯回原文。
- VoiceLine 绑定 matchedPanel，后续可以单独生成语音与口型。

### 7. 分镜图生成

相关文件：

- `src/lib/workers/handlers/panel-image-task-handler.ts`
- `src/lib/workers/handlers/image-task-handler-shared.ts`
- `lib/prompts/novel-promotion/single_panel_image.zh.txt`

Panel 图生成的输入不是简单 prompt，而是一个上下文 JSON：

```text
panel
├── shot_type
├── camera_move
├── description
├── image_prompt
├── video_prompt
├── location
├── characters
├── source_text
├── photography_rules
└── acting_notes

context
├── character_appearances
└── location_reference
```

它会收集：

- Panel 自身描述。
- 角色当前 appearance 描述和参考图。
- 场景 selected image 和 available slots。
- 摄影规则。
- 表演指导。
- 原文 source_text。
- 项目画风和画幅。

然后传入图像模型生成候选图，支持 `candidateCount` 1 到 4。首次生成直接设置 `imageUrl`，再次生成进入 `candidateImages`，保留 previousImageUrl。

这比“一次生成直接覆盖”更适合人工挑选和可控迭代。

### 8. 视频生成与首尾帧模式

相关文件：

- `src/lib/workers/video.worker.ts`
- `src/lib/workers/utils.ts`
- `src/lib/generator-api.ts`
- `src/lib/generators/factory.ts`
- `standards/capabilities/image-video.catalog.json`

`VIDEO_PANEL` 任务：

- 找到目标 Panel。
- 读取 panel.imageUrl 作为首帧。
- prompt 来源优先级：
  1. firstLastFrame.customPrompt
  2. panel.firstLastFramePrompt
  3. payload.customPrompt
  4. panel.videoPrompt
  5. panel.description
- 若启用 firstlastframe，会额外读取下一个 Panel 或指定 Panel 的 imageUrl 作为 lastFrame。
- 检查模型能力 `firstlastframe` 是否支持。
- 调用统一 `generateVideo`。
- 生成结果上传到对象存储。
- 写回 `panel.videoUrl` 和 `videoGenerationMode`。

值得学习的点：

- 模型能力不是硬编码在 UI 或 worker 中，而是从 capability catalog 和项目配置解析。
- 外部异步任务会保存 `externalId`，服务重启后能恢复轮询，避免重复提交导致重复扣费。
- 视频任务有独立队列和较低并发，适合成本控制。

### 9. 语音与口型同步

相关文件：

- `src/lib/workers/voice.worker.ts`
- `src/lib/voice/generate-voice-line.ts`
- `src/lib/lipsync/index.ts`
- `src/lib/workers/video.worker.ts`

语音流程：

```text
voice_analyze 生成 VoiceLine
  ↓
VOICE_LINE 生成单条音频
  ↓
LIP_SYNC 使用 panel.videoUrl + voiceLine.audioUrl
  ↓
写回 panel.lipSyncVideoUrl
```

语音供应商：

- FAL IndexTTS2，依赖参考音频。
- Bailian QwenTTS，依赖设计出的 voiceId。

口型同步供应商：

- FAL
- Vidu
- Bailian

这个拆法非常适合我们后续做“先生成无声视频，再按台词局部口型同步”的模式。

### 10. 模型网关与能力配置

相关文件：

- `src/lib/generator-api.ts`
- `src/lib/generators/factory.ts`
- `src/lib/model-gateway/router.ts`
- `src/lib/model-capabilities/*`
- `standards/capabilities/image-video.catalog.json`
- `standards/pricing/image-video.pricing.json`

waoowaoo 的模型调用入口是统一的：

```text
generateImage(userId, modelKey, prompt, options)
generateVideo(userId, modelKey, imageUrl, options)
generateAudio(userId, modelKey, text, options)
```

模型 key 以 `provider::modelId` 形式存在。系统会解析：

- provider
- modelId
- gatewayRoute
- official / openai-compatible / template
- capability options
- pricing

这套结构对我们很重要，因为 AI 视频产品不可能只接一个模型。后续需要同时支持 Seedance、Veo、Kling、Vidu、Runway、Pika、Minimax、Wan、OpenAI-compatible 等接口，统一网关是必须项。

### 11. waoowaoo 的优点

1. 生产级任务系统完整，支持多队列、重试、dedupe、计费回滚。
2. GraphRun / GraphStep / GraphArtifact 让长工作流可观察、可恢复、可重试。
3. Story → Script 与 Script → Storyboard 拆分专业，适合长文本。
4. 资产中心完整，角色、形象、场景、道具、语音都可复用。
5. 分镜图生成有摄影规则、表演指导、source_text、参考图上下文。
6. 支持候选图，不会粗暴覆盖结果。
7. 视频、语音、口型拆分合理，后续可局部重跑。
8. 模型能力、价格、配置中心做得系统化。
9. 外部异步任务可以用 externalId 恢复轮询，降低重复扣费风险。
10. 测试覆盖比 AIComicBuilder 更成熟。

### 12. waoowaoo 的不足

1. 架构复杂，MVP 直接照搬成本高。
2. 表结构多，初期开发和调试负担大。
3. 强依赖 MySQL、Redis、MinIO、worker，部署门槛高。
4. 业务命名高度绑定 novel-promotion，抽象成通用视频项目需要重构。
5. Prompt 很长，维护成本高，需要做版本化、回归测试和输出协议收敛。
6. Panel 与 Shot 概念偏混合，后续若做专业时间线编辑，需要再抽象 Timeline / Track / Clip。

---

## 三、两个工作流的核心差异

| 维度 | AIComicBuilder | waoowaoo | 我们的取舍 |
|---|---|---|---|
| 产品形态 | 漫剧生成器 | AI 影视 Studio | 用 Studio 架构承载漫剧/短剧生成 |
| 技术底座 | SQLite + DB 轮询任务 | MySQL + Redis + BullMQ | MVP 可轻量，正式版用 BullMQ |
| 核心单位 | Shot | Clip / Storyboard / Panel / VoiceLine | 用 Clip + Shot/Panel 双层结构 |
| 资产版本 | ShotAsset 做得好 | Candidate / previous 字段较多 | 统一 MediaAsset / Variant |
| 工作流运行时 | 简单任务 handler | GraphRun/Step/Event/Artifact | 必须采用 GraphRun 思路 |
| 分镜生成 | 单次或分块 LLM 输出 Shot | 多专家阶段生成 Panel | 采用多专家阶段，但保留 ShotAsset |
| 图片一致性 | 角色四视图 + 首尾帧/参考图 | 角色 appearance + 场景图 + 摄影规则 | 两者结合 |
| 视频生成 | 首尾帧插值 / 参考图视频 | Panel image → video，支持首尾帧 | 两种都保留 |
| 语音口型 | Dialogue 字段，语音能力较弱 | VoiceLine + TTS + LipSync 完整 | 采用 waoowaoo 模式 |
| 可观测性 | 基础任务状态 | SSE + TaskEvent + GraphEvent | 采用事件流 |
| 模型接入 | Provider factory | Model gateway + capability catalog | 采用 gateway + capability |

---

## 四、最值得学习的设计原则

### 1. 资产优先，而不是提示词优先

AI 视频的稳定性来自资产：

- 角色资产：固定姓名、形象描述、参考图、声音。
- 场景资产：固定名称、空间描述、参考图、可用位置。
- 道具资产：固定名称、材质、参考图。

提示词应引用资产，而不是每次重新描述角色。否则同一角色会在不同镜头漂移。

### 2. 文本锚点与视觉参考双轨制

要同时做到：

- 文本层：角色名、场景名、道具名必须精确匹配资产库。
- 视觉层：生成图像和视频时注入对应参考图。

这也是 `docs/toonflow-consistency-analysis.md` 里总结的核心：文字锚定 + 视觉参考双轨制。

### 3. 长链路必须拆成可恢复步骤

一次性“生成全片”在真实产品里不可控。正确做法是：

```text
Run
  Step
    Attempt
      Artifact
      Event
```

每一步都能看到输入、输出、错误、重试次数、依赖关系。失败时重跑局部，不重跑全片。

### 4. Shot/Panel 不要直接存最终唯一结果

应该保存候选、版本、active 指针：

```text
Shot
  ├── first_frame variants
  ├── last_frame variants
  ├── reference image variants
  ├── video variants
  └── prompt versions
```

用户做视频一定会反复改。没有版本和候选，项目会很快变成不可控状态。

### 5. 文本生成必须输出稳定 JSON 协议

两个项目都大量依赖 JSON 输出。我们的项目必须定义严格协议：

- `CharacterProfileOutput`
- `LocationProfileOutput`
- `ClipSplitOutput`
- `ScreenplayOutput`
- `StoryboardPlanOutput`
- `CinematographyOutput`
- `ActingOutput`
- `PanelDetailOutput`
- `VoiceLineOutput`

每个协议都要配 JSON schema、repair、canary 测试和样例。

### 6. 图像生成前要先做导演层信息

不要直接拿“画面描述”生成图。更好的输入是：

- 分镜描述
- 原文 source_text
- 摄影规则
- 表演指导
- 角色参考图
- 场景参考图
- 道具参考图
- 画风
- 画幅

waoowaoo 的 `single_panel_image` 就是这个思路。

### 7. 口型同步要反向影响分镜规划

如果后续要做口型同步，前期分镜就必须服务它：

- 对话要有独立说话者镜头。
- 说话者脸部清晰。
- 多人同框说话时其他人要虚化。
- VoiceLine 要匹配 Panel。

waoowaoo 在 storyboard plan、cinematographer、voice_analysis 三处都对这点做了约束。

### 8. 模型能力必须配置化

不同视频模型能力差异巨大：

- 是否支持首尾帧。
- 是否支持参考图。
- 支持时长范围。
- 支持分辨率。
- 是否支持音频。
- 是否异步。
- 是否需要轮询。
- 是否 OpenAI-compatible。

这些不能写死在业务逻辑里，必须放入 capability catalog。

---

## 五、我们自己的 AI 视频生成项目推荐蓝图

### 1. 推荐产品主线

```text
项目创建
  ↓
导入小说/剧本/创意
  ↓
全局分析：角色 / 场景 / 道具 / 世界观 / 画风
  ↓
生成或确认资产：角色形象 / 场景图 / 道具图 / 声音
  ↓
按集或片段拆分
  ↓
片段转剧本
  ↓
分镜规划
  ↓
摄影规则 + 表演指导
  ↓
分镜图候选生成
  ↓
视频提示词生成
  ↓
单镜视频生成
  ↓
台词配音
  ↓
口型同步
  ↓
时间线编辑与合成导出
```

### 2. 推荐技术架构

正式版：

- Next.js + React 前端
- NestJS 或 Next.js API 作为后端入口
- PostgreSQL 或 MySQL + Prisma
- Redis + BullMQ
- MinIO/S3/COS 对象存储
- SSE 或 WebSocket 做任务进度
- FFmpeg / Remotion 做时间线合成
- Model Gateway 做模型统一适配

MVP 可简化为：

- Next.js 全栈
- SQLite/PostgreSQL
- BullMQ 仍建议保留
- 本地文件存储可先替代 S3

### 3. 推荐核心表结构

```text
Project
Episode
SourceDocument

Asset
├── type: character / location / prop / voice
├── name
├── description
├── prompt
└── metadata

AssetVariant
├── assetId
├── kind: image / audio / description
├── url
├── prompt
├── selected
└── version

Clip
├── episodeId
├── startText
├── endText
├── content
├── summary
└── screenplayJson

Shot
├── clipId
├── sequence
├── sourceText
├── description
├── motionScript
├── cameraDirection
├── duration
└── status

ShotAsset
├── shotId
├── type: panel_image / first_frame / last_frame / reference / video / lipsync_video
├── prompt
├── url
├── version
├── selected
└── metadata

VoiceLine
├── episodeId
├── shotId
├── speaker
├── text
├── emotion
├── audioUrl
└── matchedShotId

WorkflowRun
WorkflowStep
WorkflowArtifact
WorkflowEvent
Task
TaskEvent
ModelProvider
ModelCapability
CostLedger
```

这里建议把 `ShotAsset` 从 AIComicBuilder 继承下来，同时把 `WorkflowRun` 从 waoowaoo 继承下来。

### 4. 推荐任务队列

```text
text queue
├── analyze_global
├── split_clips
├── convert_screenplay
├── storyboard_plan
├── cinematography
├── acting_direction
├── storyboard_detail
└── voice_analyze

image queue
├── character_image
├── location_image
├── prop_image
├── panel_image
├── first_frame
├── last_frame
└── image_modify

video queue
├── panel_video
├── first_last_frame_video
├── reference_video
└── lip_sync

voice queue
├── voice_design
└── voice_line
```

### 5. 推荐 MVP 版本范围

第一版不要把所有能力一次做完。推荐最小闭环：

1. 项目创建与剧本文本导入。
2. 角色/场景/道具分析。
3. 手动确认资产名称。
4. 角色图和场景图生成。
5. Clip 切分。
6. 分镜 Panel 生成。
7. 分镜图候选生成。
8. 单镜视频生成。
9. 视频片段列表导出或简单拼接。

暂缓到第二版：

- 配音。
- 口型同步。
- 多版本分镜对比。
- 复杂计费。
- 多租户资产中心。
- Remotion 时间线编辑器。

### 6. 推荐 Prompt 分层

直接采用五层专家体系：

```text
Producer / Story Analyst
  ↓
Screenwriter
  ↓
Storyboard Director
  ↓
Cinematographer + Acting Director
  ↓
Prompt Engineer for Image / Video / Voice
```

对应输出：

- 角色、场景、道具资产 JSON。
- Clip 切分 JSON。
- Screenplay JSON。
- Panel Plan JSON。
- Cinematography JSON。
- Acting JSON。
- Panel Detail JSON。
- Image Prompt / Video Prompt / VoiceLine JSON。

### 7. 推荐一致性策略

必须同时做 7 件事：

1. 每个角色固定资产名，禁止别名直接进入分镜。
2. 每个角色支持多个 appearance，分镜引用 `{ name, appearance, slot }`。
3. 每张角色图生成时加可裁剪标签，方便人工识别，生成正式图时裁掉标签。
4. 分镜图生成时显式注入 `角色名 = 图片 N` 映射。
5. 场景图必须无人，角色由角色参考图负责。
6. ShotAsset 版本化，保留候选与历史。
7. 每个 Panel 绑定原文 source_text，便于定位错误和局部重跑。

### 8. 推荐视频生成策略

同时支持三种视频模式：

```text
模式 A：单图生视频
panel_image → video

模式 B：首尾帧生视频
first_frame + last_frame → video

模式 C：多参考图生视频
character refs + scene refs + prompt → video
```

默认推荐：

- 短剧口播和普通剧情用模式 A。
- 动作变化较明确的镜头用模式 B。
- 对角色/场景一致性要求极高的镜头用模式 C。

### 9. 推荐可观测性

每个长任务必须可视化：

```text
步骤名
状态
当前 attempt
输入摘要
输出摘要
原始模型输出
错误信息
可重试按钮
生成产物
```

前端上应该显示成“制作流水线”，而不是一个单独 loading。

### 10. 需要避免的坑

1. 不要让一个 LLM 调用同时完成剧本、分镜、图像提示词、视频提示词。
2. 不要用角色描述文本替代角色参考图。
3. 不要让场景参考图里出现人物。
4. 不要把 AI 输出直接信任落库，必须 schema 校验。
5. 不要失败后重跑全流程，必须局部重试。
6. 不要把模型参数写死在代码里。
7. 不要只存最终 URL，必须存 prompt、模型、参数、版本、来源。
8. 不要把台词分析放到视频生成后才考虑，分镜阶段就要服务口型。
9. 不要让 UI 只显示“生成中”，要显示哪一步、哪个镜头、哪个外部任务。
10. 不要忽略源文本锚点，长文本切分必须能回到原文。

---

## 六、建议采用的最终架构

最终架构建议如下：

```text
Frontend Studio
├── Project Dashboard
├── Asset Center
├── Script / Clip Workspace
├── Storyboard Board
├── Shot Detail Drawer
├── Voice & LipSync Workspace
└── Timeline Export

API Layer
├── Project API
├── Asset API
├── Workflow API
├── Task API
├── Media API
└── Model Config API

Workflow Runtime
├── WorkflowRun
├── WorkflowStep
├── WorkflowArtifact
├── WorkflowEvent
└── Retry / Resume / Cancel

Workers
├── text-worker
├── image-worker
├── video-worker
└── voice-worker

Model Gateway
├── LLM Gateway
├── Image Gateway
├── Video Gateway
├── Audio Gateway
└── LipSync Gateway

Storage
├── DB metadata
├── Object storage media
├── Prompt versions
└── Cost ledger
```

---

## 七、实施路线

### P0：核心底座

- 建项目骨架。
- 建 Project / Episode / Asset / Clip / Shot / ShotAsset / Task / WorkflowRun 表。
- 接入 BullMQ。
- 接入对象存储。
- 做模型配置和最小 ModelGateway。

### P1：文本到分镜

- 导入文本。
- 角色/场景/道具分析。
- Clip 切分 + 原文锚点校验。
- Screenplay 转换。
- Storyboard Plan。
- Cinematography + Acting。
- Panel Detail。

### P2：分镜图与视频

- 资产图生成。
- 分镜图候选生成。
- ShotAsset 版本化。
- 单镜视频生成。
- 首尾帧视频模式。
- 批量重跑与局部重试。

### P3：语音与成片

- VoiceLine 提取。
- TTS。
- LipSync。
- FFmpeg/Remotion 时间线合成。
- 字幕、BGM、片头片尾。

### P4：生产化

- 资产中心。
- 多项目复用。
- 成本统计。
- 模型能力目录。
- Prompt 版本管理。
- 工作流回归测试。
- 团队协作。

---

## 八、最终建议

我们的项目不要直接复制任何一个项目的完整结构，而应该吸收它们各自最强的部分：

- 从 `AIComicBuilder` 继承：清晰的创作链路、ShotAsset 资产版本化、首尾帧/参考图双模式、Prompt Registry 插槽化。
- 从 `waoowaoo` 继承：GraphRun 工作流、多队列任务系统、资产中心、候选图机制、语音口型链路、模型能力配置、外部任务恢复、计费与可观测性。

第一阶段最关键的工程目标是跑通“文本 → 分镜 → 分镜图 → 单镜视频”的稳定闭环。只要这个闭环的数据模型和任务系统设计正确，后续加配音、口型、时间线、模型扩展都会自然生长。

