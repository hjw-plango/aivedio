# 项目状态简报

> 写于 P0 完整完成时。后续每次大动作后由 Claude 更新顶部，旧状态保留为档案。

## 当前状态

**P0（M0~M5）已全部完成并合并到 main**，可直接用浏览器跑通完整非遗纪录片 pilot：3 主题 × 5 核心镜头 = 15 条即梦提示词。

| 里程碑 | 内容 | PR | 状态 |
|--------|------|-----|------|
| M0 | 后端/前端骨架、9 张表 schema、ModelRouter、纪录片配置 | [#1](https://github.com/hjw-plango/aivedio/pull/1) | ✅ merged |
| M1 | GraphRun 编排引擎、StepEmitter、SSE 推送、暂停/继续/重跑 | [#2](https://github.com/hjw-plango/aivedio/pull/2) | ✅ merged |
| M2 | 研究/编剧/分镜/质检 4 个 Agent，资料/事实库 API | [#3](https://github.com/hjw-plango/aivedio/pull/3) | ✅ merged |
| M3 | 项目页、Pipeline 可视化、SSE 实时事件流、可见性三档、FactCard 编辑 | [#4](https://github.com/hjw-plango/aivedio/pull/4) | ✅ merged |
| M4 | 即梦手动桥（提示词复制、视频回传、5 分制评分、失败标签）、资产管理 | [#5](https://github.com/hjw-plango/aivedio/pull/5) | ✅ merged |
| M5 | 3 主题 pilot 资料、run_pilot 驱动脚本、e2e 测试、复盘表骨架 | [#6](https://github.com/hjw-plango/aivedio/pull/6) | ✅ merged |

每个 PR 都派了独立子 agent 冷启动审核，发现的真实 bug（不是表面问题）都修复了再合并。审核记录详见每个 PR 的 review 评论。

## 一键跑通

```bash
# 1) 后端
cd /root/junwei/aivedio
python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
python -m server.data.init_db
uvicorn server.main:app --host 0.0.0.0 --port 8000 &

# 2) 前端
cd web && npm install && npm run dev &
# 浏览器打开 http://localhost:3000

# 3) 想直接跑 e2e 看效果
cd .. && PYTHONPATH=. .venv/bin/python -m scripts.run_pilot
```

## 测试

```bash
PYTHONPATH=. .venv/bin/python -m pytest -q
# → 29 passed
```

覆盖：health / projects / ModelRouter / config_loader / asset_store / GraphRun pause+auto+rerun / broadcaster 跨线程 / 4 个 Agent Mock 模式 / 红线规则 / Shot+ShotAsset / 即梦上传 / 候选 cap / 评分文件名 rename / 3 主题端到端 pilot。

## P0 验收清单

`docs/requirements.md` 末尾的 13 条 ☐ 全部 ✅，详见审核 agent 在 PR #6 的最终验收报告。

## 用户需要做的事

P0 流程图自动化部分到此为止。下一步**必须由人完成**：

1. 在 web UI 创建项目（或直接用 `scripts/run_pilot.py` 已经创建好的 3 个）
2. 进入 `/projects/{id}/shots`，复制每个项目的即梦提示词（每项目 5 核心镜头：establishing / craft_close / material_close / silhouette / imagery；如果 brief 命中"传承人正脸/采访/口述"等信号，silhouette 槽位会切换为真拍 `portrait_interview`，那一条不生成即梦提示词，按文档应人工拍摄替代）
3. 在即梦官网手动生成视频，下载 mp4
4. 回到 `/projects/{id}/shots`，**点上传**回传视频
5. 填 5 分制评分 + 失败标签 + 备注
6. 按 `docs/pilot-result.md` 表格汇总，对照 `docs/documentary-pilot.md` 成功标准判定方向是否进入 P1

如果失败标签集中在 `wrong_craft` / `ad_style` / `ai_face`，说明 prompt 还需调优；先手改提示词在分镜页 PATCH，下个迭代再升级模板。

## 已知 Follow-up（P1 处理）

子 agent 终审列出的非阻塞项，按文档 P0 不在范围：

1. 修改 input 后重跑 — 后端 rerun 接口无 override，前端无 UI（F6.8）
2. 资料上传缺 size limit + MIME magic 校验（NF3）
3. 配置热加载（F11.2）未做，需重启
4. 告警通道（F12.3）、项目导出（F12.4）、归档/删除（F1.3）— 本来就是 P1
5. 跳过 step（F6.7）UI 缺失
6. 重跑后下游 success step 不重置（design.md §5 语义需要明确）

这些不影响 P0 跑通，留给 M6/P1 再处理。

## 没有 LLM API key 也能跑

`server/engine/router.py` 的 `from_settings()` 在没有 `LLM_API_KEY` / `ANTHROPIC_API_KEY` 时自动 fallback 到 `MockProvider`。每个 Agent 都内置确定性兜底逻辑（句子切分 → FactCard，模板 fallback 剧本，固定模式分镜），保证 pipeline 完整可演示。

接入真 key 只需在 `.env` 里填，重启后所有 LLM 调用自动走真模型，不需要改一行代码。
