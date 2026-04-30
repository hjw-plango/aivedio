# 跑起来

> P0 完整版（M0~M5 全部合入 main）。完整状态见 [STATUS.md](./STATUS.md)。


## 要求

- Python 3.11+
- Node.js 20+
- pnpm 或 npm 二选一(下面用 npm 示例)

## 一、克隆与配置

```bash
git clone <repo>
cd aivedio
cp .env.example .env
# 编辑 .env 把 LLM_API_KEY / ANTHROPIC_API_KEY 填上
```

P0 不强制必须填 key——不填时 `ModelRouter` 自动走 `MockProvider`,可以跑 smoke 测试。

## 二、后端

在仓库根执行(注意：`venv` 与所有 Python 命令都从仓库根跑，不要 cd 到 `server/`，否则 `python -m server.xxx` 找不到包)：

```bash
cd <repo-root>          # 例如 /root/junwei/aivedio
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt

# 初始化 SQLite（仓库根需要在 PYTHONPATH 里，让 `python -m server.data.init_db` 能 import）
PYTHONPATH=. python -m server.data.init_db

# 启动后端，默认 http://localhost:8000
PYTHONPATH=. python -m uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查:

```bash
curl http://localhost:8000/health | python -m json.tool
```

创建一个项目:

```bash
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"title":"景德镇 pilot","direction":"documentary","brief":"非遗 15 镜验证"}'
```

## 三、前端

```bash
cd web
npm install
npm run dev
# 访问 http://localhost:3000
```

API 基址解析(`web/lib/api.ts`)：

- **服务端组件 / SSR**：默认走 `http://localhost:8000`，可用 `SERVER_API_BASE` 环境变量覆盖（例如生产部署里 backend 跑在另一台机器）。
- **浏览器**：默认走相对路径，由 `web/next.config.ts` 的 rewrites 把 `/api/*` 转发到后端；也可以设 `NEXT_PUBLIC_API_BASE` 用绝对 URL。

跑 lint（非交互，不会卡问答）：

```bash
cd web
npm run lint:check     # next lint --max-warnings=0 --no-cache
```

跑端到端可用性 smoke（脚本会同时启 backend + 前端 production server，curl 三个 SSR 页面）：

```bash
bash scripts/smoke_frontend.sh
```

## 四、跑测试

```bash
cd <repo-root>
PYTHONPATH=. .venv/bin/python -m pytest -q
# 后端测试当前 40 passed
```

## 四点五、一键端到端

跑 3 主题 × 15 镜的完整 pilot：

```bash
PYTHONPATH=. .venv/bin/python -m scripts.run_pilot
```

跑完会 print 3 个 project_id；浏览器打开 `/projects/<id>/shots` 就能看到全部即梦提示词，按"复制提示词"按钮粘到即梦官网，回传视频后人工评分。


## 五、目录速览

```text
aivedio/
├── docs/                   设计 / 任务 / 协作文档
├── configs/documentary/    纪录片微调:prompts / rules / scoring
├── server/                 FastAPI 后端
│   ├── api/                HTTP 路由
│   ├── agents/             4 个 agent (M2)
│   ├── engine/             编排引擎 + ModelRouter
│   ├── data/               SQLAlchemy 模型与 session
│   ├── bridges/            即梦手动桥 (M4)
│   └── utils/              ID / 哈希等小工具
├── web/                    Next.js 前端
├── assets/                 本地资产存储 (gitignored)
├── var/                    运行时 (DB / runs)
└── tests/                  smoke + 单测
```

## 六、约束自检

- 不修改 `AIComicBuilder-main/`、`waoowaoo-main/`(参考项目,代码隔离)。
- 不实现即梦自动化。视频生成走方案 A:用户复制提示词到即梦官网。
- 不接 ASR / 独立 OCR / 视频理解 / 自动视频质检。
- 不保存模型原始思维链,只保存 `progress_note`。
- P0 单人本地,不做用户系统、多租户、对象存储。
