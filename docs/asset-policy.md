# 资产与版本控制策略

## 直接结论

继续采用 ShotAsset 思路，但必须控制候选爆炸。

## 核心规则

每个阶段必须 pin 一个候选，才能进入下一阶段。

```text
分镜文本
→ pin 分镜图
→ pin 首帧或参考图
→ pin 视频提示词
→ 手动即梦生成
→ pin 视频结果
```

不允许默认把所有候选交叉组合进入下一步。

## 候选限制

- 每个 Shot 默认最多 3 个分镜图候选。
- 每个 Shot 默认最多 2 个视频提示词候选。
- 每个 Shot 默认最多 3 个即梦视频结果。
- 未 pin 候选默认标记为 `temporary`。
- 未 pin 候选 24 小时后转冷存或隐藏。
- UI 默认只展示 current branch。

## ShotAsset 类型

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

## 版权字段

所有资产必须预留：

```text
source_type: ai_generated / user_uploaded / cc0 / licensed / unknown
source_platform
license
attribution
creator
rights_holder
usage_scope
expires_at
review_status
```

第一阶段可以不做完整版权审核功能，但数据库设计和资产 JSON 必须保留字段。

## 冷存策略

视频和大文件不进 git。git 只保存：

- 元数据。
- 提示词。
- 评分。
- 文件路径或对象存储 key。
- 生成记录。

真实视频文件进入 `pilot-renders/` 或后续对象存储。
