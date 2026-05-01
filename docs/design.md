# 设计边界

## 总体架构

当前主工程保持 `waoowaoo-main` 原架构。

```text
Next.js App
Prisma + MySQL
Redis + BullMQ
MinIO / S3 compatible storage
GraphRun / Task / Worker
Novel Promotion workflow
Image / Video / Voice / LipSync generation
```

不在 P0 新建第二套后端、第二套工作流引擎或第二套资产系统。

## 数据模型使用方式

### 角色

使用已有模型：

```text
NovelPromotionCharacter
CharacterAppearance
```

角色一致性主要由这些字段承担：

- `name`
- `aliases`
- `profileData`
- `introduction`
- `appearances`
- `CharacterAppearance.changeReason`
- `CharacterAppearance.description`
- `CharacterAppearance.imageUrl`
- `CharacterAppearance.imageUrls`
- `CharacterAppearance.selectedIndex`

### 场景

使用已有模型：

```text
NovelPromotionLocation
LocationImage
```

场景一致性主要由这些字段承担：

- `name`
- `summary`
- `selectedImageId`
- `LocationImage.description`
- `LocationImage.availableSlots`
- `LocationImage.imageUrl`
- `LocationImage.isSelected`

### 分镜

使用已有模型：

```text
NovelPromotionClip
NovelPromotionPanel
NovelPromotionStoryboard
```

分镜上下文主要由这些字段承担：

- `Clip.content`
- `Clip.characters`
- `Clip.props`
- `Clip.location`
- `Clip.screenplay`
- `Panel.characters`
- `Panel.props`
- `Panel.location`
- `Panel.photographyRules`
- `Panel.actingNotes`
- `Panel.imagePrompt`
- `Panel.videoPrompt`
- `Panel.candidateImages`
- `Panel.previousImageUrl`

## 一致性机制

当前不新增 `ProjectMemory` 和 `ContinuityState`。

一致性维护规则：

1. 角色的固定设定写入 `profileData` 和 `introduction`。
2. 角色每种重要状态创建一条 `CharacterAppearance`。
3. `changeReason` 必须写成人能识别的状态名称。
4. panel 里需要特定状态时，应明确引用该 appearance。
5. 场景参考图由 `selectedImageId` 控制当前使用图。
6. 光线、天气、时间段变化优先通过场景图描述或新增场景图表达。
7. 道具一致性先沿用 clip/panel 的 props 字段和资产中心能力。

## 生成链路

### 分镜阶段

`script-to-storyboard/orchestrator.ts` 会按当前 clip 过滤角色、场景、道具，并注入到多阶段 prompt：

```text
clip characters
clip location
clip props
filtered character appearances
filtered character descriptions
filtered location descriptions
filtered prop descriptions
```

### 出图阶段

`panel-image-task-handler.ts` 会读取：

```text
panel.characters
panel.location
panel.photographyRules
panel.actingNotes
projectData.characters
projectData.locations
```

然后把角色外观和场景参考注入生成上下文。

## 本地自用策略

P0 保持最小改造：

- 保留登录注册。
- 保留用户表。
- 保留模型配置中心。
- 保留会员和计费代码。
- 默认 `BILLING_MODE=OFF`。
- 先不做无登录本地用户模式。

原因是 `userId` 与项目、任务、资产、模型偏好关联很深，早期强改容易破坏主流程。

## 品牌和清理

允许做轻量自用化：

- README 改为本项目说明。
- package name 改为本地项目名。
- UI 中的应用名改为 `AI Video Studio`。
- 保留底层文件名、队列名、数据库名中的 `waoowaoo`，避免无意义大改。

## 后续增强触发条件

只有在真实测试发现 `waoowaoo` 原生机制无法满足时，才做增强。

优先级从低风险到高风险：

1. 改进角色外观命名和引用规范。
2. 增加面板层的 appearance 选择 UI。
3. 增加场景图选择和锁定 UI。
4. 增加道具参考图注入。
5. 再考虑轻量项目记忆表。
6. 最后才考虑完整状态机。
