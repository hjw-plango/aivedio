# 当前工作流

## 直接结论

当前以 `waoowaoo-main` 原生工作流为准。

根目录旧 Python 工作流已经不再作为测试主线。

## 运行入口

```text
waoowaoo-main
```

开发模式：

```powershell
cd c:\Users\admin\Desktop\aivedio\waoowaoo-main
npm run dev
```

访问：

```text
http://localhost:3000
```

## 创作流程

### Step 1 创建项目

输入：

```text
故事创意
小说片段
剧本文本
项目名称
语言
画幅比例
```

输出：

```text
NovelPromotionProject
Episode
原始文本
```

### Step 2 解析角色、场景、道具

系统从文本中提取：

```text
characters
locations
props
clips
```

人工重点检查：

```text
角色名和别名是否完整
角色档案是否准确
场景名是否稳定
道具是否遗漏
```

### Step 3 建立角色外观和场景参考

角色一致性靠：

```text
CharacterAppearance
changeReason
description
imageUrl / imageUrls
selectedIndex
```

场景一致性靠：

```text
LocationImage
description
availableSlots
imageUrl
isSelected
```

### Step 4 多阶段分镜

`script-to-storyboard` 会执行：

```text
Phase 1: 分镜规划
Phase 2: 摄影规则
Phase 2: 表演指导
Phase 3: 详细分镜和视频 prompt
```

每个阶段会读取当前 clip 的角色、场景、道具上下文。

### Step 5 面板图生成

面板图生成会读取：

```text
panel.characters
panel.location
panel.photographyRules
panel.actingNotes
角色外观
场景参考
```

生成结果保存到：

```text
panel.imageUrl
panel.candidateImages
panel.previousImageUrl
```

### Step 6 视频、语音、口型同步

继续使用 `waoowaoo` 原有能力：

```text
videoPrompt
videoUrl
voice
lipSync
editor / render
```

具体可用程度以本地 API 配置和 provider 支持为准。

## 测试观察重点

测试时优先看这些问题：

- 同一人物跨镜头脸和服装是否稳定。
- 外观变化能否通过 `changeReason` 管住。
- 同一场景跨镜头空间关系是否稳定。
- 道具是否被保留。
- 分镜是否服务剧情。
- 出图 prompt 是否正确使用角色和场景参考。
- 视频 prompt 是否能承接面板图。
- 任务失败时错误是否可定位。

## 不再使用的旧流程

下面内容只作为历史记录：

```text
Research Agent
Writer Agent
Memory Agent
Review Agent
manual_jimeng_video
人工评分
纪录片固定审美 prompt
```
