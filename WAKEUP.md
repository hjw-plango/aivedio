# 醒来怎么跑 — WAKEUP.md

> 你睡前授权我重写仓库。这份文档列出**这次会话改了什么**、**你需要做什么**、**还有什么没做**。

## TL;DR — 5 步启动

```powershell
cd c:\Users\admin\Desktop\aivedio

# 1. 装依赖（首次约 3-5 分钟）
npm install

# 2. 起 docker 三件套（mysql + redis + minio）
docker compose up mysql redis minio -d

# 3. 初始化数据库表
npx prisma db push

# 4. 启动应用（next + worker + watchdog + bull-board）
npm run dev

# 5. 浏览器打开
# http://localhost:3000
```

任务队列面板：http://localhost:3010/admin/queues

---

## 我做了什么

### 1. 仓库重组（commit `6661825`）

- **waoowaoo-main/ 整体上移到仓库根**：原来在 `waoowaoo-main/` 子目录的所有源码、配置、Prisma schema、测试都已经移到根目录。这是当前主工程。
- **删除旧 Python 原型**：根目录的 `server/`、`web/`、`configs/`、`scripts/`（旧）、`tests/`（旧）、`docs/`、`var/`、`.pytest_cache/`、`.venv/` 全部删除。这些通过 git 历史可在 `main` 分支的 `585f9da` (`wip: pre-rewrite snapshot`) 找回。
- **删除旧文档**：`RUNNING.md`、`STATUS.md`、`workflow-analysis.md`、`pytest.ini` 等。
- **`.gitignore`** 合并 waoowaoo + 本地特化（`AIComicBuilder-main/`、`.tmp-*`、`*.wav`、`*.mp3`）。
- **`.env`** 重写：从 `.env.example` 复制 + 自动生成的随机密钥（`NEXTAUTH_SECRET` / `CRON_SECRET` / `INTERNAL_TASK_TOKEN`）。
- **`AIComicBuilder-main/`** 保留在本地（被 .gitignore 忽略），作为参考代码。

### 2. Studio Tools 模块（feature 分支二开 commit）

新增独立工具集，**旁挂在 waoowaoo 主流程外**，不破坏 novel-promotion 管道。

| 路径 | 内容 |
|---|---|
| [src/lib/studio-tools/mimo-tts.ts](src/lib/studio-tools/mimo-tts.ts) | MiMo TTS 合成核心函数（OpenAI 兼容，base64 WAV 解析） |
| [src/lib/studio-tools/jimeng-prompt.ts](src/lib/studio-tools/jimeng-prompt.ts) | 即梦视频提示词组装器（结构化字段 → 中文提示词） |
| [src/app/api/studio-tools/mimo-tts/route.ts](src/app/api/studio-tools/mimo-tts/route.ts) | POST /api/studio-tools/mimo-tts |
| [src/app/api/studio-tools/jimeng/prompt/route.ts](src/app/api/studio-tools/jimeng/prompt/route.ts) | POST /api/studio-tools/jimeng/prompt |
| [src/app/api/studio-tools/jimeng/upload/route.ts](src/app/api/studio-tools/jimeng/upload/route.ts) | POST /api/studio-tools/jimeng/upload（视频回传到 MinIO） |
| [src/app/[locale]/studio-tools/page.tsx](src/app/[locale]/studio-tools/page.tsx) | Studio Tools 入口页 |
| [src/app/[locale]/studio-tools/mimo-tts/page.tsx](src/app/[locale]/studio-tools/mimo-tts/page.tsx) | MiMo TTS 工具页 |
| [src/app/[locale]/studio-tools/jimeng/page.tsx](src/app/[locale]/studio-tools/jimeng/page.tsx) | 即梦手动桥工具页 |
| messages/zh/nav.json + en/nav.json | 加 `studioTools` 文案 |
| src/components/Navbar.tsx | 加 Studio Tools 入口 |

#### MiMo TTS 工具页

`http://localhost:3000/zh/studio-tools/mimo-tts`

- 填写 API Key + Base URL（默认 `https://api.xiaomimimo.com/v1`）+ 选模型 + 输入文本
- 提交 → 后端调网关 → 返回 base64 WAV
- 前端解码为 Blob → `<audio>` 试听 → 下载 .wav

支持 4 个模型：`mimo-v2.5-tts` / `voiceclone` / `voicedesign` / `mimo-v2-tts`。

**请求格式**（你之前实测确认的非标格式）：
```json
POST {baseUrl}/chat/completions
{ "model": "mimo-v2.5-tts", "messages": [{"role":"assistant","content":"文本"}] }
```
响应里 `choices[0].message.audio.data` 是 base64 WAV。**API Key 不持久化**——每次请求都从前端传，不进数据库。

#### 即梦手动桥工具页

`http://localhost:3000/zh/studio-tools/jimeng`

两段式工作流：

**① 拼装提示词**：填表（主体 / 动作 / 镜头 / 光线 / 风格 / 时长 / 补充 / 负面）→ 后端拼装中文提示词 → 复制按钮 + "打开即梦官网"按钮。

**② 回传 mp4**：从即梦官网下载视频后，在工具页选文件上传 → 后端通过 [src/lib/storage](src/lib/storage) 写入 MinIO → 返回签名 URL，可直接试播。

最大上传 200 MB，支持 mp4/mov/webm。

### 3. 权限配置

- [.claude/settings.local.json](.claude/settings.local.json)：项目级权限规则（已 gitignored）。你睡前手动删了 `deny` 列表，保留下 46 条 allow。
- [.gitignore](.gitignore)：加 `.claude/settings.local.json`、`.tmp-*`、`*.wav`、`*.mp3`、`AIComicBuilder-main/`。

### 4. memory（在 `~/.claude/projects/...`，跨会话）

清理为 3 条反映现状的记忆：
- `project_aivedio_overview.md` — 以 waoowaoo 为底座
- `project_tech_stack.md` — Next.js 16 + Prisma + MySQL + Redis + MinIO
- `project_current_focus.md` — 先跑真实测试，按问题改

旧的 6 条（基于 Python 原型的）已删除。

---

## ⚠️ 你还要自己做的事

### 启动后必做

1. **注册账号**：访问 http://localhost:3000，先注册一个本地账号（NextAuth + Prisma 用户表）。`BILLING_MODE=OFF` 已配置，免计费。
2. **配置 LLM API Key**：登录后进"设置中心"，添加你的 Claude Opus key（或其他 LLM）。这是 waoowaoo 主管道（剧本 / 角色 / 分镜 AI 调用）需要的。
3. **配置文生图 Key**：同样在"设置中心"，添加 GPT-Image-2（OpenAI 兼容）的 key + base URL。
4. **MiMo Key**：Studio Tools 的 MiMo 工具页里**直接填**就行，不需要在设置中心配（不持久化）。

### 没做的事 / TODO

| 项 | 状态 | 备注 |
|---|---|---|
| **AIComicBuilder 角色四视图融合** | ❌ 未做 | 跨 ORM（Drizzle→Prisma）+ 业务层 + UI 多层。无人监督做容易半成品。等你判断是否真的需要再开工。 |
| **MiMo TTS 接入 waoowaoo 主管道** | ❌ 未做 | 现在 MiMo 是 Studio Tools 独立工具。要让 novel-promotion 的"配音阶段"直接用 MiMo，需要：在 [src/lib/providers/](src/lib/providers/) 加 mimo provider + 在 [src/lib/generators/factory.ts](src/lib/generators/factory.ts) 注册 + 在 [standards/capabilities/](standards/capabilities/) 注册模型能力。**3-5 小时**。 |
| **即梦手动桥关联到 panel/shot** | ❌ 未做 | 现在上传的视频只回单独的 URL，没自动写到 `NovelPromotionPanel` / `Clip`。 要打通需要扩展 Prisma schema（加 `manualJimengVideoUrl` 等字段）+ 改 panel UI。**2-3 小时**。 |
| **typecheck / build / 测试** | ❌ 未跑 | 没装 npm 依赖，typecheck 跑不了。装完 `npm install` 后建议先跑 `npm run typecheck`。 |
| **Studio Tools UI 风格统一** | 🟡 半成品 | 用了原生 Tailwind，没用 waoowaoo 的 `glass-*` 设计系统。功能全，颜值粗糙。要统一可以参考 [src/app/\[locale\]/page.tsx](src/app/[locale]/page.tsx) 的 glass 类名。 |
| **国际化** | 🟡 半成品 | Studio Tools 页面里的中文文案直接硬编码，没走 next-intl。 |

---

## 已知风险 / 醒来检查清单

启动后**优先验证**这些：

```powershell
# A. typecheck 看新加的 studio-tools 代码有无类型错
npm run typecheck

# B. build 看能否打包（会自动跑 prisma generate）
npm run build

# C. 浏览器走一次 Studio Tools
# http://localhost:3000/zh/studio-tools
```

可能需要修的点：
- **Prisma generate**：`npm install` 已经在 postinstall 自动跑 `prisma generate`。如果失败，手动 `npx prisma generate`。
- **MinIO 启动**：`docker compose up minio -d` 后访问 http://localhost:19001 用 `minioadmin/minioadmin` 登录验证 bucket `waoowaoo` 已自动创建（不用手动建，[src/lib/storage/init.ts](src/lib/storage/init.ts) 会处理）。
- **端口冲突**：默认占用 3000(next) / 3010(bull-board) / 13306(mysql) / 16379(redis) / 19000(minio) / 19001(minio-console)。

---

## 回滚

如果觉得这次重写太激进或有大坑：

```powershell
# 切回 main 分支（safety snapshot 在那里）
git checkout main

# main 上的最新 commit（585f9da）就是重写前的完整状态
git log --oneline -3
```

如果只想丢掉某些修改：

```powershell
# 看 feature 分支 vs main 的差异
git diff main..feature/waoowaoo-rewrite --stat

# 选择性 cherry-pick 或丢弃
```

---

## 你之前给的 LLM API Key

旧 `.env` 里有这些，已被新 `.env` 覆盖：

```
LLM_BASE_URL=https://www.computinger.com/v1
LLM_API_KEY=sk-MD0fjqakAirF29kQcCmu27YzUxg4NmXpLvoW71bhnNWzmBXD
```

**这是 Python 原型给中转 API 的配置**。waoowaoo 不读这两个环境变量——它从数据库的"用户 API 配置"读 key。你要在 UI 设置中心重新填一次，加 Claude Opus key + GPT-Image-2 key。

旧 .env 现在已经被覆盖。如果需要找回：

```powershell
git show 585f9da:.env
```

---

## 文件级总览

```
aivedio/
├── .env                      ← 新（已生成密钥）
├── .env.example              ← waoowaoo 版本
├── .gitignore                ← 合并版
├── .claude/                  ← 权限配置（gitignored）
├── .github/                  ← waoowaoo workflows
├── .husky/ .nvmrc .dockerignore
├── package.json package-lock.json tsconfig.json
├── docker-compose.yml docker-compose.test.yml
├── caddyfile Dockerfile LICENSE README.md README_en.md
├── eslint.config.mjs vitest.config.ts vitest.core-coverage.config.ts
├── next.config.ts middleware.ts postcss.config.mjs
├── prisma/                   ← schema.prisma + migrations
├── src/                      ← waoowaoo 全部源码
│   ├── app/[locale]/
│   │   ├── studio-tools/     ← 🆕 新增工具集
│   │   ├── workspace/        ← waoowaoo 主工作区
│   │   └── ...
│   ├── app/api/
│   │   ├── studio-tools/     ← 🆕 新增 API
│   │   └── ...
│   ├── lib/
│   │   ├── studio-tools/     ← 🆕 MiMo TTS + 即梦提示词组装
│   │   ├── novel-promotion/  ← waoowaoo 核心管道（未动）
│   │   ├── generators/       ← 视频/图片/音频生成（未动）
│   │   ├── providers/        ← Bailian/Fal/Official/Siliconflow（未动）
│   │   └── ...
│   └── components/Navbar.tsx ← 加了 Studio Tools 入口
├── messages/zh/nav.json      ← 加 studioTools 文案
├── messages/en/nav.json      ← 加 studioTools 文案
├── public/ images/ standards/ tests/ scripts/ lib/ pages/
├── AIComicBuilder-main/      ← 参考代码（gitignored）
└── assets/                   ← 你的旧素材（保留）
```

---

## Git 状态

```
main:                     585f9da  wip: pre-rewrite snapshot (旧状态完整保存)
                          6661825  chore: promote waoowaoo-main to repo root, drop legacy Python prototype
feature/waoowaoo-rewrite: 6661825 + (本次 commit) feat: studio-tools 模块
```

你**没有 push 任何东西**，所有操作都是本地。

睡好。
