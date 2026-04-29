# assets/

P0 阶段的本地资产存储目录,git 不追踪具体文件。

## 命名规范

```text
assets/{project_id}/{shot_id}/storyboard_v{version}.png
assets/{project_id}/{shot_id}/jimeng_v{version}_score{score}.mp4
assets/{project_id}/{shot_id}/reference_v{version}.png
assets/{project_id}/{shot_id}/footage_v{version}.mp4
```

## 注意

- 每个文件入库时同时记录 `file_path` + `file_hash` (sha256)。
- 删除走 `assets/.trash/{date}/`,30 天后清理(脚本未实现,M4 再补)。
- P1 迁移到 S3/MinIO 时只改 `server/data/asset_store.py` 的存储后端,业务层不动。
