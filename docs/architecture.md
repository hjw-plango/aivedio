# 架构设计

## 智能体

MVP 只保留 4 个智能体：

```text
内容智能体：研究、策划、剧本、旁白、采访提纲、事实卡片
视觉智能体：分镜、摄影、美术、分镜图提示词、即梦视频提示词
执行智能体：手动即梦执行记录、文件命名、ShotAsset 绑定、状态流转
质检智能体：人工评分辅助、事实对齐、AI 味归因、重跑建议
```

暂不拆摄影指导、美术指导、提示词工程师等细粒度智能体，避免上下文损耗和调试困难。

## 模型策略

不按成本优化，优先使用中转站最强模型。

```text
内容生成：Claude Opus 4.7
结构化输出：GPT-5.5
分镜与提示词：GPT-5.5
文化语气复核：Claude Opus 4.7
质检建议：GPT-5.5 + Claude Opus 交叉复核
分镜图/首帧/尾帧/参考图：GPT Image 2
普通工具操作：GPT-5.4-mini / DeepSeek V4 Flash 可选
视频生成：manual_jimeng
```

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

## 资产策略

继续采用 `ShotAsset`，但必须限制候选爆炸。

规则：

- 每个阶段必须 pin 一个候选才能进入下一阶段。
- UI 默认只展示 current branch。
- 未 pin 候选隐藏或转冷存。
- 视频大文件不进 git，只保存路径、元数据和生成记录。

核心类型：

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

版权字段必须预留：

```text
source_type
source_platform
license
attribution
creator
rights_holder
usage_scope
review_status
```

## 执行可视化

每一步都记录：

```text
agent_name
step_name
status
input_summary
output_summary
artifact_refs
warnings
created_at
```

前端展示制作流程，不展示单一 loading。
