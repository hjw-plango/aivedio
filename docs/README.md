# 项目总览

## 当前结论

本项目主线已经收束为：**直接以 `waoowaoo-main` 作为自己的主工程继续检查、测试和二次打磨**。

前面设想的“额外迁入剧本依据、完整项目记忆、状态账本、Review、人工评分、即梦桥”等能力，现阶段不再作为 P0 目标。`waoowaoo` 自身已经具备足够的基础一致性能力，先按它的成熟工作流跑通真实项目，再根据实际生成问题做小范围增强。

## 主工程

```text
waoowaoo-main
```

保留并优先测试它已有的能力：

- 小说、剧本、故事文本导入。
- 角色、别名、角色档案。
- 多套角色外观 `CharacterAppearance`。
- 场景库和选中场景参考图。
- 道具、资产、参考图。
- 多阶段分镜。
- 面板级候选图生成。
- 视频、语音、口型同步、成片合成。
- 任务队列、工作流、重试、日志、成本估算。
- 用户偏好、模型配置、API Key 配置。

## 一致性策略

现阶段采用 `waoowaoo` 原生方式维护一致性：

- 人物一致性：用角色档案、别名、外观版本、角色参考图维护。
- 状态变化：用 `CharacterAppearance.changeReason` 表达，例如“初始造型”“雨夜湿身”“受伤后”等。
- 场景一致性：用场景描述、场景参考图、选中场景图维护。
- 分镜上下文：每个 clip 和 panel 写入当前角色、场景、道具、摄影规则、表演提示。
- 出图上下文：生成面板图时读取当前 panel 的角色外观和场景参考。

这不是完整状态机，但足够作为当前可测底座。P0 不再新建独立 `ProjectMemory` / `ContinuityState` 系统。

## 旧项目处理

根目录下的 Python/Next 原型暂时保留为历史参考，不再作为主线继续扩展。

```text
server/
web/
configs/
scripts/
tests/
```

这些目录不删除，避免丢失历史实验记录，但测试和开发入口切到 `waoowaoo-main`。

`AIComicBuilder-main` 也暂时只作为参考，不做代码融合。

## 不做

现阶段明确不做：

- 不继续开发旧 Python 原型。
- 不迁入旧项目的纪录片审美 prompt。
- 不迁入 Review Agent。
- 不迁入人工评分体系。
- 不迁入即梦手动桥。
- 不新增完整项目记忆和连续性状态机。
- 不强删 `waoowaoo` 的会员、余额、计费代码。

会员和计费相关代码继续保留，运行时使用 `BILLING_MODE=OFF`。

## 文档入口

```text
RUNNING.md                 当前主工程启动方式
STATUS.md                  当前项目状态
docs/README.md             项目总览
docs/requirements.md       当前 P0 需求
docs/design.md             当前设计边界
docs/task-plan.md          检查和测试任务清单
docs/workflow.md           waoowaoo 原生工作流
docs/input-checklist.md    用户需要提供的测试内容
```
