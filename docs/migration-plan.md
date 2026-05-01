# 迁移计划

## 当前结论

迁移计划已经收束：**不做完整代码融合，直接以 `waoowaoo-main` 为自己的项目底座继续测试和打磨**。

之前讨论的迁移内容现在降级为历史参考：

```text
AIComicBuilder-main      暂不融合
旧 Python/Next 原型      暂不继续
完整项目记忆系统         暂不新增
完整状态机               暂不新增
```

## 保留内容

### waoowaoo-main

全部保留为主工程。

重点保留：

```text
src/lib/task
src/lib/run-runtime
src/lib/workflow-engine
src/lib/novel-promotion
src/lib/workers
src/app/api/tasks
src/app/api/runs
src/app/api/user/api-config
prisma/schema.prisma
messages
```

### 旧根项目

暂时保留在仓库里，但不作为运行入口。

```text
server/
web/
configs/
scripts/
tests/
```

这些内容只用于回看历史实验，不继续接入 `waoowaoo-main`。

### AIComicBuilder-main

暂时保留为参考目录，不迁移代码。

## 不迁移清单

```text
旧纪录片 prompt
旧审美规则
Review Agent
人工评分
即梦手动桥
旧 Python 工作流
AIComicBuilder UI
AIComicBuilder pipeline
独立 ProjectMemory schema
独立 ContinuityState schema
```

## 自用化改造范围

允许的低风险改造：

- 文档改成当前项目说明。
- README 改成本地运行说明。
- package 名称改成本地项目名。
- UI 应用名改为 `AI Video Studio`。
- `.env.example` 保持 `BILLING_MODE=OFF`。
- 保留原数据库名、队列名、内部常量名。

不做高风险改造：

- 不批量重命名 `novel-promotion`。
- 不批量重命名数据库表。
- 不批量修改任务类型。
- 不删除 billing 相关代码。
- 不删除 auth 相关代码。

## 后续判断规则

真实测试后按问题决定改造方向：

```text
角色漂移严重
→ 先增强 CharacterAppearance 使用规范和 UI 选择

场景漂移严重
→ 先增强 LocationImage 选择、锁定和提示注入

道具丢失严重
→ 先增强 props 结构化和 panel prompt 注入

剧情状态断裂严重
→ 再考虑轻量状态字段

多轮测试仍无法控制
→ 最后才考虑完整项目记忆系统
```

当前不提前做重架构。
