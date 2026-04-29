# 项目总览

## 项目定位

本项目是**通用型 AI 视频生成 agent 平台**，向纪录片方向（首个深调场景：非遗）做微调。

三条不可让步的设计原则：

1. **能跑通优先**：P0 端到端从输入主题走到产出可用镜头，不允许任何一步卡死。
2. **过程全透明**：每一个 agent 的输入、输出、思考、工具调用、产物都必须落库且默认可见。
3. **可见性可折叠**：用户信任后可把 agent 折叠为黑盒一键执行，但底层数据完整保留。

## 视频生成方案

采用方案 A：

```text
系统生成策划、剧本、分镜、分镜图提示词、即梦视频提示词
→ 用户复制到即梦官网手动生成
→ 用户下载视频并回传
→ 系统记录、评分、绑定到镜头资产
```

不把即梦官网当作 API Provider，不假设网页端能力可稳定 API 化。

## 文档入口

```text
docs/README.md            项目定位、阶段路线、核心取舍
docs/design.md            设计文档：原则、分层、Agent 协议、可见性、关键决策
docs/task-plan.md         任务规划：M0~M6 里程碑与具体任务
docs/requirements.md      功能需求：F1~F12 详细需求与验收清单
docs/architecture.md      实现细节：数据结构、状态机、存储、错误处理、模型与检索接口
docs/documentary-pilot.md 非遗纪录片 pilot：15 镜头、评分、失败处理
docs/task-log.md          执行记录和 git 版本
```

阅读建议：

- 看战略 → README + design
- 看落地节奏 → task-plan
- 看具体功能 → requirements
- 看技术细节 → architecture
- 看首个验证 → documentary-pilot

## 阶段路线

```text
P0  M0~M5  非遗纪录片 15 镜 pilot 跑通端到端流程
P1  M6     通用平台完善：多项目、多方向、配置切换、对象存储
P2         短剧 / 漫剧 pilot，AI 与真素材混合
P3         自动化探索：网页自动化、第三方中转 API、官方 API
```

没有稳定入口前，不做全自动视频生成的承诺。

## 通用底座 vs 微调层

通用底座（所有方向共用）：

```text
Agent 协议、编排引擎、LLM 路由、检索框架、ShotAsset、即梦手动桥、可视化前端
```

纪录片微调层（可插拔）：

```text
configs/documentary/
  prompts/   研究、写作、分镜、即梦提示词模板
  rules/     红线、美学边界、镜头类型
  scoring/   评分维度、失败标签
```

新方向（短剧/漫剧）只新建 `configs/{direction}/`，不改底座代码。

## 核心继承

从 `AIComicBuilder` 继承：ShotAsset 版本化、首尾帧路径、Prompt Registry。

从 `waoowaoo` 继承：GraphRun / Step / Artifact、TaskEvent 可视化、资产中心、模型能力配置。

本项目新增：

```text
结构化事实库与知识图谱
统一 Agent 协议（plan + run + StepEmitter）
可见性三档（detail / summary / hidden）
纪录片美学边界与红线
即梦官网手动执行记录
版权字段与合规检查
人工质检与专家审核节点
```

## 当前判断

先验证视频模型真实能力，再搭完整流水线。15 镜 pilot 是纪录片方向能否深入的前置门槛。

通用底座的设计同步铺开，但**只在 P0 必要范围内实现**，避免过度工程。
