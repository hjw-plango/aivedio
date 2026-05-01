# 纪录片 P0 生产链路

> 历史归档说明：本文记录的是旧纪录片原型链路，不再作为当前测试入口。当前测试入口是 `waoowaoo-main`，见 `RUNNING.md`。

## 目的

P0 不再验证“5 条镜头提示词能否复制到即梦”。当前目标是做出一条真实可用的纪录片生产链路:

```text
完整纪录片大纲
→ 章节分钟秒数
→ 第一章完整内容
→ 项目记忆与参考图提示词
→ 第一章连续分镜
→ 可复制到即梦的详细视频提示词
```

## 当前默认产物

以单个纪录片项目为单位:

- 全片规划:约 10-15 分钟。
- 章节计划:默认 4 章,每章有起止时间码、叙事职责、视觉策略、声音策略。
- 第一章:约 180 秒。
- 第一章分镜:18 个镜头。
- 项目记忆:1 条 `production_memory` 资产。
- 参考图提示词:人物、环境、工具、材料、人物表情、手部姿态、环境光线、材料状态等 `reference_image_prompt`。
- 每镜头资产:
  - `jimeng_video_prompt`
  - `storyboard_prompt`
  - `shot_reference_manifest`

## 生产顺序

1. 创建项目,上传资料或粘贴 brief。
2. 启动 Pipeline。
3. 到 `/projects/{id}/memory` 复制参考图提示词,先生成主体参考图。
4. 到 `/projects/{id}/shots` 逐条复制即梦提示词。
5. 每条即梦提示词按 `reference_ids` 使用对应参考图。
6. 下载生成视频并回传到对应 shot。
7. 人工评分,记录失败标签和备注。

## 分镜字段

每个 shot 至少包含:

```json
{
  "chapter_id": "ch_01",
  "scene_id": "ch01_sc01",
  "sequence": 1,
  "timecode_start": "00:00",
  "timecode_end": "00:10",
  "shot_type": "opening_environment",
  "subject": "主体外观、材质、比例、位置",
  "action": "动作或状态变化",
  "composition": "景别、主体位置、空间关系",
  "camera_motion": "运镜",
  "lighting": "光线",
  "duration_estimate": 10,
  "narration": "旁白",
  "sound_design": "现场声与动作声",
  "reference_ids": ["REF_ENV_PRIMARY_WORKSHOP"],
  "reference_requirements": [],
  "fact_refs": ["fc_x"]
}
```

## 提示词要求

即梦提示词必须写清:

- 时间段与建议时长。
- 使用哪些参考图。
- 画面主体。
- 动作与状态。
- 构图、光线、运镜。
- 旁白对应。
- 声音与剪辑备注。
- 事实细节。
- 统一风格与负向约束。

## 成功标准

当前 P0 的最低成功标准:

```text
1 个项目成功生成完整大纲
1 个项目成功生成 production_memory
参考图提示词 ≥ 6 条
第一章镜头 = 18 条
第一章总时长约 180 秒
即梦提示词 = 18 条
每条即梦提示词包含参考图使用清单
```
