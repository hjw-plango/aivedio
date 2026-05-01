# 醒来怎么跑 — WAKEUP.md

> 你睡前授权我重写仓库。这份文档列出**这次会话改了什么**、**你需要做什么**、**还有什么没做**。

## TL;DR — 启动步骤

```powershell
cd c:\Users\admin\Desktop\aivedio

# 1. 装依赖（已替你跑过；如果 node_modules 不在直接重跑，约 1 分钟）
npm install

# 2. 起 docker 三件套（mysql + redis + minio）
docker compose up mysql redis minio -d

# 3. 推送 schema（含本次新增的 NovelPromotionCharacter 四视图字段）
npx prisma db push

# 4. 启动应用（next + worker + watchdog + bull-board）
npm run dev

# 5. 浏览器
# http://localhost:3000          应用入口
# http://localhost:3010/admin/queues   任务队列面板
```

---

## 我做了什么（按 commit 顺序）

### Commit 1：仓库重组（`6661825`）

- waoowaoo-main/ 全部上移到根目录
- 删除根目录旧 Python 原型（server/ web/ configs/ scripts/ tests/ docs/ var/ .pytest_cache/ .venv/）
- 删除旧文档 RUNNING.md / STATUS.md / workflow-analysis.md / pytest.ini
- `.gitignore` 合并：waoowaoo 规则 + AIComicBuilder-main/ + .tmp-* + *.wav + *.mp3
- `.env` 重写：自动生成的 NEXTAUTH_SECRET / CRON_SECRET / INTERNAL_TASK_TOKEN
- AIComicBuilder-main/ 保留本地（gitignored）作为参考

### Commit 2：Studio Tools 模块（`9893598`）

旁挂在 waoowaoo 主流程外的独立工具集：

| 路径 | 内容 |
|---|---|
| [src/lib/studio-tools/mimo-tts.ts](src/lib/studio-tools/mimo-tts.ts) | MiMo TTS 合成核心函数（OpenAI 兼容 → base64 WAV） |
| [src/lib/studio-tools/jimeng-prompt.ts](src/lib/studio-tools/jimeng-prompt.ts) | 即梦提示词组装器 |
| [src/app/api/studio-tools/mimo-tts/route.ts](src/app/api/studio-tools/mimo-tts/route.ts) | POST /api/studio-tools/mimo-tts |
| [src/app/api/studio-tools/jimeng/prompt/route.ts](src/app/api/studio-tools/jimeng/prompt/route.ts) | POST /api/studio-tools/jimeng/prompt |
| [src/app/api/studio-tools/jimeng/upload/route.ts](src/app/api/studio-tools/jimeng/upload/route.ts) | POST /api/studio-tools/jimeng/upload（独立模式） |
| [src/app/[locale]/studio-tools/page.tsx](src/app/[locale]/studio-tools/page.tsx) | Studio Tools 入口页 |
| [src/app/[locale]/studio-tools/mimo-tts/page.tsx](src/app/[locale]/studio-tools/mimo-tts/page.tsx) | MiMo TTS 工具页 |
| [src/app/[locale]/studio-tools/jimeng/page.tsx](src/app/[locale]/studio-tools/jimeng/page.tsx) | 即梦手动桥工具页 |
| messages/{zh,en}/nav.json | 加 `studioTools` 文案 |
| src/components/Navbar.tsx | 加 Studio Tools 入口 |

### Commit 3：把 WAKEUP 里的 TODO 全做完（**本次新增**）

按你要求"没做的事情都帮我做了"，这一刀把第二阶段的所有 TODO 落地：

#### A. MiMo TTS 升级为 first-class provider

不再仅仅是 Studio Tools 的旁挂工具——现在 waoowaoo 主管道（novel-promotion 配音阶段）可以直接选 mimo 模型生成角色配音。

- [src/lib/providers/mimo/types.ts](src/lib/providers/mimo/types.ts) — provider 类型
- [src/lib/providers/mimo/tts.ts](src/lib/providers/mimo/tts.ts) — 复用 studio-tools 的 synthesize 核心，包成 provider 协议
- [src/lib/providers/mimo/audio.ts](src/lib/providers/mimo/audio.ts) — `generateMimoAudio()`：合成 → 上传 MinIO → 注册 MediaObject → 返回 GenerateResult
- [src/lib/providers/mimo/catalog.ts](src/lib/providers/mimo/catalog.ts) — 注册 4 个 MiMo TTS 模型到 official model registry
- [src/lib/providers/mimo/index.ts](src/lib/providers/mimo/index.ts) — barrel
- [src/lib/providers/official/model-registry.ts](src/lib/providers/official/model-registry.ts) — `OfficialProviderKey` 加 `'mimo'`
- [src/lib/generators/official.ts](src/lib/generators/official.ts) — 加 `MimoAudioGenerator` 包装类
- [src/lib/generators/factory.ts](src/lib/generators/factory.ts) — `createAudioGenerator()` 加 `case 'mimo'`

**用法**：在 UI 设置中心新增一个名为 `mimo` 的 provider（baseUrl 默认 `https://api.xiaomimimo.com/v1`，填你的 API Key），然后在项目的"配音模型"里就能选到 `mimo::mimo-v2.5-tts` 等。

#### B. 即梦上传支持关联到 panel

[src/app/api/studio-tools/jimeng/upload/route.ts](src/app/api/studio-tools/jimeng/upload/route.ts) 现在两种模式：

- **独立模式**（不传 panelId）：上传到 MinIO，返回 URL。无需登录
- **关联模式**（传 panelId）：要求登录 + 项目所有权校验，自动写到 NovelPromotionPanel 的 `videoUrl` + `videoMediaId`，分镜面板自动显示新视频

UI 也加了 panelId 输入框 + 状态徽章（"已写入面板" vs "独立上传"）。

权限链：Panel → Storyboard → Episode → NovelPromotionProject → Project.userId 必须 = session.user.id。

#### C. AIComicBuilder 四视图

新增 4 个字段到 NovelPromotionCharacter（schema 已改，[`prisma db push`](#tldr--启动步骤) 会创建列）：

```prisma
referenceFrontUrl        String?  @db.Text
referenceThreeQuarterUrl String?  @db.Text
referenceSideUrl         String?  @db.Text
referenceBackUrl         String?  @db.Text
```

API：

| 路径 | 方法 | 作用 |
|---|---|---|
| `/api/studio-tools/character-four-view` | GET | 查 4 张参考图 URL |
| `/api/studio-tools/character-four-view` | DELETE | 清空一个 view 或全部（`viewType=all`） |
| `/api/studio-tools/character-four-view/upload` | POST | 上传一张参考图（FormData: characterId / viewType / file） |

UI：[`/zh/studio-tools/four-view`](src/app/[locale]/studio-tools/four-view/page.tsx) — 输入 characterId 加载 → 4 个视图槽，每个支持上传/清除。

**所有 API 都做了项目所有权校验**，user 不能改别人的角色。

#### D. tsconfig 修复

[tsconfig.json](tsconfig.json) 把 `AIComicBuilder-main` 加到 exclude，免得 typecheck 把那个不属于本工程的子项目算进去（它有自己的依赖）。

#### E. 验证

```bash
npm run typecheck   ← 已跑，零错误
```

build / docker / 真实 UI 测试我没跑（你睡觉时不能跑 docker；build 留给你醒来跑）。

---

## ⚠️ 你启动后还要做的事

### 必做

1. **`npx prisma db push`** — schema 改了 4 个字段，必须推到 MySQL（docker 已起为前提）。这条会列出新增列让你确认
2. **注册账号 / 登录** — http://localhost:3000，先注册（NextAuth）
3. **配 LLM API Key** — UI 设置中心 → 新增 provider/model，加你的 Claude Opus
4. **配文生图 Key** — 同上，加 GPT-Image-2（OpenAI 兼容）
5. **（可选）配 MiMo provider** — 设置中心新增名为 `mimo` 的 provider，baseUrl=`https://api.xiaomimimo.com/v1`，填你的 sk-... key。然后就能在项目"配音模型"里选 mimo

### 推荐

6. **`npm run build`** — 完整打包验证（typecheck 已过，build 会再跑一次 prisma generate + Next 编译）
7. **走一遍工具页** — 打开 http://localhost:3000/zh/studio-tools 试 3 个工具
8. **测试 MiMo first-class** — 在 novel-promotion 项目里配 mimo 模型生成一段配音，验证主管道集成

---

## 仍未做的（已记录，不阻塞）

| 项 | 状态 | 说明 |
|---|---|---|
| Studio Tools UI 风格统一 | 🟡 用了原生 Tailwind | 没用 waoowaoo 的 `glass-*` 设计系统。功能完整、颜值粗糙。改 `glass-page` / `glass-surface` / `glass-btn-*` 类名即可 |
| Studio Tools i18n | 🟡 中文硬编码 | 文案在 page.tsx 里直接写中文，没走 next-intl。要做就把字符串提到 `messages/{zh,en}/studioTools.json` 然后 useTranslations |
| GlobalCharacter 四视图 | ❌ 未做 | 当前四视图只在 `NovelPromotionCharacter`（项目级）。`GlobalCharacter`（跨项目复用）也想要的话，重复同样字段并改 API |
| 自动同步选中外观到四视图 | ❌ 未做 | 现在四视图是独立字段；如果想"选中某个 CharacterAppearance 的某张图作为四视图之一"自动复制 URL，需要写额外逻辑 |
| Jimeng panelId 自动建议 | ❌ 未做 | 现在要人工填 panelId；理想做法是在 panel 视图里加"用即梦生成"按钮直接跳转工具页带上 panelId |
| build 验证 | ❌ 未跑 | typecheck 过了；build 留给你 |
| 真实端到端跑 | ❌ 未跑 | docker 没起，nothing tested in browser |

---

## 启动后的健康检查清单

```powershell
# 1. typecheck（已通过，但你也跑一次确认环境干净）
npm run typecheck

# 2. build
npm run build

# 3. 浏览器三个工具页
# /zh/studio-tools
# /zh/studio-tools/mimo-tts       —— 填 key + 文本，听 WAV
# /zh/studio-tools/jimeng         —— 拼提示词、回传视频（panelId 留空先测独立模式）
# /zh/studio-tools/four-view      —— 创建一个 character 后填它的 id 试上传

# 4. MiMo first-class（需要先在设置中心配 mimo provider）
# 创建 novel-promotion 项目 → 选 mimo 配音模型 → 生成一段 voiceLine 验证
```

---

## 回滚

```powershell
# 完全回到睡前状态：
git checkout main
git log --oneline -3   # 585f9da 是 pre-rewrite snapshot

# 只想丢掉本次"做完所有 TODO"的 commit（保留前两个 commit）：
git checkout feature/waoowaoo-rewrite
git reset --hard <commit-hash-of-Commit-2>   # 看下面的 git 状态找 hash

# 看本次会话总改动：
git diff main..feature/waoowaoo-rewrite --stat
```

---

## Git 状态

```
main:                     585f9da  wip: pre-rewrite snapshot

feature/waoowaoo-rewrite: 6661825  chore: promote waoowaoo-main to repo root, drop legacy Python prototype
                          9893598  feat: studio-tools module — MiMo TTS + Jimeng manual bridge
                          ???????  feat: complete remaining TODOs (本次提交)  ← HEAD
```

**没有 push 任何东西**，所有改动都是本地。

睡好。
