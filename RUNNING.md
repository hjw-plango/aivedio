# 跑起来

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

```bash
cd server
python -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt

# 初始化 SQLite
python -m server.data.init_db

# 启动 (默认 http://localhost:8000)
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
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

前端通过 `NEXT_PUBLIC_API_BASE` 反向代理到后端,默认 `http://localhost:8000`。

## 四、跑测试

```bash
cd <repo root>
pytest -q
```

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
