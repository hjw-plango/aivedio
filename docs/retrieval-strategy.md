# 检索策略

## 直接结论

本项目不采用向量库和 reranker 作为核心检索方案。

检索底座改为：

```text
结构化事实库
+ 知识图谱
+ 上下文全文检索
+ 层级摘要
+ Agentic 查询规划
+ 引用锚点
```

这套方案更适合视频生成平台，因为我们真正需要的不是“语义相似段落”，而是可追踪的事实、角色、场景、工艺步骤、剧情事件、镜头资产和授权来源。

## 为什么不用向量和 reranker

向量检索适合泛语义召回，但在本项目里有几个明显问题：

- 非遗事实需要精确，不能只靠相似度。
- 剧情、角色、场景、道具之间是关系网络，不是孤立文本块。
- 版权和素材来源必须可追踪，不能只返回相似 chunk。
- 分镜生成需要工艺步骤顺序、时间线、人物关系和空间关系。
- reranker 会增加黑盒排序，不利于调试为什么召回某条材料。

本项目更需要“可解释检索”和“证据链检索”。

## 核心架构

### 1. 结构化事实库

把资料拆成可验证事实，而不是只切 chunk。

```text
FactCard
├─ id
├─ domain: documentary / short_drama / comic_drama / general
├─ entity
├─ claim
├─ fact_type: person / location / craft_step / prop / taboo / timeline / style / quote
├─ source_id
├─ source_span
├─ confidence
├─ review_status
├─ license_status
└─ metadata
```

非遗方向示例：

```text
entity: 景德镇制瓷
fact_type: craft_step
claim: 拉坯是将泥料置于转盘中心，通过手部控制使泥坯形成器型的步骤。
source_span: 第 12 页第 3 段
review_status: human_pending
```

短剧方向示例：

```text
entity: 女主角林晚
fact_type: character_state
claim: 林晚在第 3 场前仍不知道男主真实身份。
source_span: episode_01_scene_03
```

### 2. 知识图谱

把事实组织成关系网络。

```text
Entity
├─ Person
├─ Character
├─ Location
├─ Prop
├─ Craft
├─ CraftStep
├─ Scene
├─ Shot
├─ Asset
└─ LicenseSource

Relation
├─ appears_in
├─ uses
├─ located_in
├─ before / after
├─ derived_from
├─ contradicts
├─ requires_real_footage
└─ licensed_by
```

非遗纪录片用它控制工艺、传承谱系、器具和地域关系。

短剧用它控制人物关系、剧情状态、伏笔、反转和场景连续性。

漫剧用它控制角色设定、服装、分镜连续性、画风资产和对白关系。

### 3. 上下文全文检索

不用 embedding，使用全文检索。

推荐方案：

```text
SQLite FTS5 / PostgreSQL full-text / Meilisearch / Typesense
```

入库时不直接索引原始段落，而是先生成上下文增强文本：

```text
原始段落
+ 文档标题
+ 章节
+ 主题
+ 涉及实体
+ 时间地点
+ 工艺步骤
+ 资产标签
```

这样可以吸收 Contextual Retrieval 的优点，但只用 BM25/全文检索，不用向量和 reranker。

### 4. 层级摘要

每份资料同时生成多层摘要：

```text
DocumentSummary
SectionSummary
ParagraphSummary
FactCard
SourceSpan
```

查询时先找高层摘要，再向下展开到事实和原文 span。

这能覆盖“这批资料主要讲什么”“这个非遗项目的核心冲突是什么”“这个角色在前 5 集的情绪变化是什么”这类全局问题。

### 5. Agentic 查询规划

检索不是一次搜索，而是由智能体规划多个查询步骤。

示例：

```text
用户任务：生成苏绣纪录片分镜

查询规划：
1. 查苏绣核心工艺步骤
2. 查苏绣常见器具
3. 查苏绣视觉纹样
4. 查哪些镜头必须真拍
5. 查版权可用素材
6. 汇总成分镜约束
```

每一步都写入日志，方便调试。

## 检索流程

```text
用户任务
→ Query Planner
→ 结构化 SQL 查询
→ 知识图谱遍历
→ 上下文全文检索
→ 层级摘要展开
→ SourceSpan 证据装配
→ GPT-5.5 / Claude Opus 生成
→ 引用与事实校验
```

## 检索结果格式

每次检索必须返回证据包：

```text
EvidencePack
├─ query_plan
├─ facts[]
├─ graph_paths[]
├─ source_spans[]
├─ unresolved_questions[]
├─ conflicts[]
└─ license_warnings[]
```

生成智能体只能基于 EvidencePack 写作或分镜。

## OCR 与多模态资料

暂不单独接传统 OCR。图片、扫描件、展板、老照片说明文字先交给多模态 AI 读取。

输出仍然落成结构化数据：

```text
ImageObservation
├─ visible_text
├─ objects
├─ people
├─ scene
├─ craft_items
├─ uncertainty
└─ source_image_id
```

## 暂不做的能力

- 向量数据库。
- embedding 召回。
- reranker。
- ASR。
- 视频理解模型。
- 全自动视频质检。

视频结果暂时由人工评判。

## 默认技术选型

P0/P1 推荐：

```text
SQLite/PostgreSQL
全文检索 FTS
结构化 FactCard 表
Entity / Relation 图谱表
SourceSpan 引用表
LLM Query Planner
人工评分
```

后续数据量大后，可以把图谱迁到 Neo4j 或 Kuzu，把全文检索迁到 Meilisearch / Typesense。
