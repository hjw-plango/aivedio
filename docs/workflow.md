# 当前端到端工作流

本文是当前版本的流程总控文档，口径以代码为准。当前 P0 目标是非遗纪录片 15 镜 pilot，验证即梦官网能否稳定生成可用的纪录片质感镜头。

## 直接结论

```text
输入资料 / brief
→ Research Agent 生成 FactCard / Entity / Relation
→ Writer Agent 生成策划案 / 分场剧本 / 旁白草稿
→ Storyboard Agent 生成 5 个核心镜头 / 分镜图提示词 / 即梦视频提示词
→ Review Agent 做事实对齐、红线、重跑建议
→ 用户复制提示词到即梦官网手动生成
→ 用户上传视频、评分、打失败标签
→ 根据人工评分决定重跑、保留或改成真拍素材
```

当前不把即梦官网当作 API Provider，不承诺全自动视频生成。即梦阶段采用方案 A：系统产出可复制提示词，用户在即梦官网生成并回传。

## 模型分工

| 阶段 | task_type | 主模型 | 作用 | 复核 |
|------|-----------|--------|------|------|
| 资料研究 | `research` | GPT-5.5 | 事实抽取、结构化、来源定位 | Claude Opus 4.7 做文化敏感度复核 |
| 编剧写作 | `writing` | Claude Opus 4.7 | 策划、剧本、旁白、纪录片语气 | GPT-5.5 检查广告化、虚构、不当类比 |
| 分镜结构 | `structure` | GPT-5.5 | 分镜表、镜头类型、事实引用 | Claude Opus 4.7 做语气和红线复核 |
| 分镜图 | `vision` | GPT Image 2 | 预留给分镜参考图生成 | 当前 P0 尚未实接 |
| 轻量操作 | `lightweight` | GPT-5.4-mini | 预留给格式修复、简单工具任务 | 当前主流程未依赖 |

配置位置：`.env.example`。

```text
MODEL_RESEARCH=gpt-5.5
MODEL_WRITING=claude-opus-4-7
MODEL_STRUCTURE=gpt-5.5
MODEL_VISION=gpt-image-2
MODEL_LIGHTWEIGHT=gpt-5.4-mini
```

路由入口：`server/engine/router.py`。Agent 不直接绑定模型，只传 `task_type`，由 `ModelRouter` 选择 provider 和模型。

## Step 0：项目与资料输入

用户创建项目时输入：

```text
title       项目标题，例如 景德镇制瓷
direction   当前为 documentary
brief       项目目标、题材、调性
materials   用户上传的文本资料
```

Pilot 脚本位置：`scripts/run_pilot.py`。

当前 pilot 固定三组资料：

```text
configs/documentary/pilot/jingdezhen.md
configs/documentary/pilot/suxiu.md
configs/documentary/pilot/chuanju_bianlian.md
```

## Step 1：Research Agent

代码位置：`server/agents/research.py`。

输入：

```text
payload.brief
upstream.materials 或 payload.materials
```

主模型：

```text
task_type = research
model = GPT-5.5
system = 你是结构化事实抽取助手
prompt = configs/documentary/prompts/research.md + 输入资料 + 项目 brief
```

研究 Prompt 的核心要求：

```text
你是非遗题材的纪录片研究员。从给定原文中抽取结构化事实。
输出 FactCard，每条包含 topic、category、content、source_span、confidence、needs_review。
并行输出 Entity / Relation 候选。
不编造资料中没有的事实，原文有歧义时降低 confidence 并标 needs_review。
只输出 JSON。
```

输出：

```text
fact_cards[]  后续编剧、分镜、质检的事实依据
entities[]    人、地点、材料、工具、工艺步骤等实体候选
relations[]   uses / before / after / appears_in 等关系候选
```

复核：

```text
task_type = writing
model = Claude Opus 4.7
system = 你是非遗内容文化审核员,语气克制,只标注问题
```

兜底逻辑：

无 API key 或模型没有返回结构化 JSON 时，进入本地抽取。当前版本已经清理 Markdown 标题、来源行、裸编号、横线、元说明，减少 `1.`、标题、来源说明混入 FactCard 的问题。

## Step 2：Writer Agent

代码位置：`server/agents/writer.py`。

输入：

```text
research.fact_cards
payload.brief
```

主模型：

```text
task_type = writing
model = Claude Opus 4.7
system = 你是非遗纪录片编剧,克制、观察式、不广告化
prompt = configs/documentary/prompts/writing.md + brief + FactCard
```

编剧 Prompt 的核心要求：

```text
输出 plan：主题、受众、语气、章节、叙事线。
输出 script：分场剧本，每场包含 scene_id、location、time、beats、narration_draft、fact_refs。
输出 narration：逐镜头旁白草稿，5 秒约 12-15 字。
所有事实陈述必须引用 fact_refs。
禁止广告词，禁止虚构传承人对白，禁止虚构未在 FactCard 中出现的事件。
只输出 JSON。
```

输出：

```text
plan        策划方案
script[]    分场剧本
narration[] 逐镜头旁白草稿
```

复核：

```text
task_type = research
model = GPT-5.5
用途 = 检查旁白与剧本是否广告化、虚构、不当类比
```

兜底逻辑：

模型未返回结构化剧本时，系统会根据 FactCard 自动生成三段式基础脚手架：环境、工艺、材质。它保证流程能跑通，但只适合 pilot 验证，不等同于最终可用文案。

## Step 3：Storyboard Agent

代码位置：`server/agents/storyboard.py`。

输入：

```text
writer.script
writer.narration
research.fact_cards
payload.brief
```

主模型：

```text
task_type = structure
model = GPT-5.5
system = 你是纪录片摄影指导,克制写实,严格 JSON 输出
prompt = configs/documentary/prompts/storyboard.md + 剧本 + 旁白 + 5 镜要求
```

分镜 Prompt 的核心要求：

```text
把剧本拆成可拍或可生成镜头。
每条包含 shot_id、scene_id、sequence、shot_type、subject、composition、camera_motion、lighting、duration_estimate、narration_ref、requires_real_footage、fact_refs。
传承人正脸、口述、真实仪式必须 requires_real_footage = true，不生成提示词。
空镜、工艺特写、材料特写、剪影、意象镜头可由 AI 生成。
只输出 JSON 数组。
```

当前 P0 的 5 镜契约：

```text
SHOT_COUNT = 5
establishing    空镜
craft_close     工艺特写
material_close  材料特写
silhouette      剪影 / 背影
imagery         意象镜头
```

主题感知兜底：

```text
porcelain    景德镇制瓷：作坊、陶轮、瓷土、釉料、窑火
embroidery   苏绣：绣坊、绷架、绣针、丝线、纹样
opera        川剧变脸：后台、脸谱、戏服、舞台剪影、面具意象
generic      通用非遗
```

真拍转换规则：

当 brief 或 FactCard 命中“传承人正脸 / 采访 / 口述史 / 现场演出 / 实录”等信号时，只把 `silhouette` 槽位转换为：

```text
shot_type = portrait_interview
requires_real_footage = true
subject = 传承人采访或现场演出实录(必须真拍,不生成 AI 视频)
```

这样既保留 5 镜结构，又不会让 AI 生成高风险真人采访或真实演出。

## Step 4：即梦提示词与分镜图提示词

即梦提示词不是单独模型生成，而是由模板拼装。

模板位置：`configs/documentary/prompts/shot_prompt.md`。

模板骨架：

```text
观察式非遗纪录片镜头,主题是【非遗项目】。
画面主体:【shot.subject】。
构图:【shot.composition】。
光线:【shot.lighting】。
镜头运动:【shot.camera_motion】。

材质与质感:自然光,真实老作坊环境,保留工具磨损、粉尘、杂物和材料纹理。
拍摄风格:手持摄影,有轻微微抖和焦点呼吸,不要丝滑广告片运镜。
色彩:低饱和、真实色彩、不过度美化。

【FactCard 引用的工艺细节,必须直接复述,不演绎】

禁止:
- 合成感人脸,不出现具体可识别真人正脸
- 塑料质感、过度干净的环境
- 商业广告风、奇幻特效
- 错误器具、错误工艺步骤
- 把 AI 镜头冒充真实历史影像
```

代码会额外追加镜头类型要点：

```text
establishing    去掉人/手部描述,强化环境氛围
craft_close     特写镜头,主体居中,景深浅,聚焦工具与手部局部
material_close  微距镜头,纹理清晰,自然光从侧面打入
silhouette      逆光剪影,人物只见轮廓,不展示面部
imagery         象征性意象,不声称真实记录
```

分镜图提示词由代码生成：

```text
纪录片分镜参考图,{shot_type}, 主体: {subject}; 构图: {composition}; 光线: {lighting}; 真实材质,低饱和,自然光,无 AI 合成感人脸。
```

当前只生成 `storyboard_prompt` 资产，还没有实接 GPT Image 2 生图。

输出资产：

```text
Shot
ShotAsset(asset_type = jimeng_video_prompt)
ShotAsset(asset_type = storyboard_prompt)
```

版权字段已经预留：

```text
rights.source_type
rights.source_platform
rights.license
rights.creator
rights.review_status
```

## Step 5：Review Agent

代码位置：`server/agents/review.py`。

输入：

```text
storyboard.shots
writer.narration
research.fact_cards
configs/documentary/rules/red_lines.yaml
configs/documentary/prompts/review.md
```

本地检查：

```text
固定红线词扫描
工艺步骤无 fact_refs 检查
AI 镜头是否误触真人正脸、真实档案、广告化等规则
```

主审模型：

```text
task_type = structure
model = GPT-5.5
system = 你是非遗纪录片质检员
```

交叉复核：

```text
task_type = writing
model = Claude Opus 4.7
system = 你是非遗内容文化语气复核员
```

质检 Prompt 的核心要求：

```text
输出 fact_alignment：事实对齐问题。
输出 red_lines：红线命中。
输出 rerun_suggestions：重跑建议。
红线结论必须双模型一致才放行；本地固定规则命中直接纳入。
只输出 JSON。
```

输出：

```text
review_report.fact_alignment[]
review_report.red_lines[]
review_report.rerun_suggestions[]
```

## Step 6：即梦官网手动桥

当前视频生成阶段的真实流程：

```text
用户进入 /projects/{id}/shots
→ 复制每个 Shot 的 jimeng_video_prompt
→ 打开即梦官网
→ 选择最新视频生成模型
→ 粘贴提示词
→ 设置 16:9、约 5s
→ 生成 1-3 个候选
→ 下载 mp4
→ 回到系统上传到对应 Shot
→ 填 1-5 分、failure_tags、备注
```

评分标准位置：`docs/documentary-pilot.md`。

失败标签位置：`configs/documentary/scoring/failure_tags.yaml`。

当前失败标签：

```text
ai_face
plastic_texture
wrong_craft
ad_style
motion_error
layout_error
irrelevant
```

当前 P0 支持记录上传、评分和失败标签。自动根据失败标签改写提示词尚未实现，下一轮由人工根据失败标签修改提示词或模板后重跑。

## 当前 pilot 口径

执行命令：

```powershell
.\.venv\Scripts\python.exe -m scripts.run_pilot
```

2026-04-30 最新验证结果：

```text
景德镇制瓷  facts=13 shots=5 jimeng=5 real_only=0
苏绣        facts=12 shots=5 jimeng=5 real_only=0
川剧变脸    facts=11 shots=5 jimeng=4 real_only=1
```

合计：

```text
15 个核心镜头
14 条即梦提示词
1 条真拍镜头
```

川剧变脸的真拍镜头来自 `portrait_interview` 转换，符合“采访、正脸、现场演出不用 AI 生成”的纪录片边界。

## 本次审查结论

生成效果方向：

```text
已明显优于上一版，可以进入即梦人工实测。
镜头主体更像真实可拍镜头，不再是标题、来源说明或编号残句。
5 镜结构稳定，三类 AI 友好镜头已经覆盖：空镜、工艺特写、材料特写。
川剧题材能自动识别真实演出/采访风险，并转成真拍镜头。
```

功能完成度：

```text
后端 Agent 链路已跑通。
GraphRun / Step / Event 可观察链路已存在。
前端可复制提示词、上传视频、记录评分。
即梦阶段为手动桥，不是 API 自动化。
GPT Image 2 分镜图生成还只是预留能力。
```

已知短板：

```text
1. 即梦真实视频尚未完成人工评分，最终成片质感仍以用户实测为准。
2. 少数 FactCard 引用偏泛化，例如历史介绍会进入剪影或意象镜头。
3. imagery 镜头光线模板偏通用，例如苏绣仍可能出现“微弱火光”。
4. 分镜图提示词已生成，但 GPT Image 2 还未接入实际生图。
5. 自动按失败标签改写提示词尚未实现，当前依赖人工调模板或重跑。
```

## 验证记录

2026-04-30 本地验证：

```text
.\.venv\Scripts\python.exe -m pytest -q
45 passed

cd web
npm run lint
No ESLint warnings or errors

cd web
npm run build
Compiled successfully

.\.venv\Scripts\python.exe -m scripts.run_pilot
3 主题全部 success
```

根目录没有 `package.json`，前端命令必须在 `web/` 目录执行。

2026-04-30 真实 API 验证：

```text
Computinger New API 网关：
  LLM_BASE_URL=https://www.computinger.com/v1
  LLM_API_KEY=本地 .env 配置，不提交

ModelRouter smoke：
  research    gpt-5.5          OK
  writing     claude-opus-4-7  OK
  structure   gpt-5.5          OK
  lightweight gpt-5.4-mini     OK

完整真实 pilot：
  景德镇制瓷  facts=25 shots=5 jimeng=3 real_only=2
  苏绣        facts=18 shots=5 jimeng=5 real_only=0
  川剧变脸    facts=12 shots=5 jimeng=5 real_only=0
```

真实模型耗时明显长于 mock，完整 pilot 建议：

```powershell
$env:PILOT_TIMEOUT_SECONDS='900'
.\.venv\Scripts\python.exe -m scripts.run_pilot
```

真实 API 接入后已补齐的兼容项：

```text
1. 模型输出 JSON 外包解释文字时，统一提取 JSON payload。
2. 只有一个 OpenAI-compatible 中转密钥时，writing 任务复用同一网关调用 Claude 模型。
3. 模型返回 shot_id="" 时，系统自动生成本地 shot_id。
4. 分镜引用“真实拍摄范畴 / 不能用 AI 合成替代”等 FactCard 时，自动转真拍镜头。
5. 红线扫描忽略“禁止:”段和“避开 / 不出现 / 不展示”等否定语境，避免把规避性描述误报为违规。
```

## Prompt 索引

```text
configs/documentary/prompts/research.md     研究 Agent 事实抽取
configs/documentary/prompts/writing.md      编剧 Agent 策划、剧本、旁白
configs/documentary/prompts/storyboard.md   分镜 Agent 分镜表
configs/documentary/prompts/shot_prompt.md  即梦视频提示词模板
configs/documentary/prompts/review.md       质检 Agent 审核报告
```

规则与评分：

```text
configs/documentary/rules/aesthetic.yaml
configs/documentary/rules/shot_types.yaml
configs/documentary/rules/red_lines.yaml
configs/documentary/scoring/failure_tags.yaml
configs/documentary/scoring/dimensions.yaml
```
