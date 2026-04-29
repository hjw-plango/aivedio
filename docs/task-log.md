# 执行记录

## 2026-04-29

### 已确认

- 当前项目不是直接接火山云。
- 当前只有即梦官网/即梦平台视频生成能力。
- 即梦官网暂不按正式 API 能力设计。
- 第一阶段采用方案 A：系统生成提示词，用户手动到即梦官网生成视频并回传。
- 第一阶段重点改为 15 镜纪录片质感 pilot。
- MVP 智能体从 10 个压缩到 4 个：内容、视觉、执行、质检。
- 非遗纪录片不能 100% AI 生成，必须支持 AI 镜头与真实素材混合。
- 传承人采访、人脸特写、历史影像必须走真拍或授权素材。
- ShotAsset 继续保留，但加入 pin 和候选限制，避免版本树爆炸。
- 资产 schema 必须预留版权字段。

### 新增文档

- `docs/project-strategy.md`
- `docs/documentary-aesthetics.md`
- `docs/pilot-15-shots.md`
- `docs/agents.md`
- `docs/jimeng-manual-workflow.md`
- `docs/asset-policy.md`
- `docs/roadmap.md`
- `docs/task-log.md`

### 下一步

- 基于 `docs/pilot-15-shots.md` 生成 15 条可直接复制到即梦官网的正式提示词。
- 建立 pilot 评分表。
- 建立手动回传的视频命名与记录规范。
