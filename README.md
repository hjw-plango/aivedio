# AI Video Studio

> 影视级别 AI 视频生产工作台 — 纪录片 / 漫剧 / 短剧 一体化创作环境

[English](README_en.md) · 中文

## 这是什么

AI Video Studio 是一个**自托管**的 AI 影视生产工作台。基于成熟的 [waoowaoo](https://github.com/saturndec/waoowaoo) 工作流为底座，针对个人创作者的真实需求做了三层增强：

1. **MiMo TTS first-class provider** — 小米 MiMo 系列 TTS 接入主管道，支持声音克隆与声音设计
2. **即梦手动桥** — 即梦官网无 API 时的"人在回路"工作流：拼装提示词 → 跳转生成 → 回传视频自动写入分镜面板
3. **角色四视图** — 来自 AIComicBuilder 的设计：每个角色 4 张参考图（正/四分之三/侧/背）作为一致性锚点

主管道（剧本拆解 → 角色/场景抽取 → 多阶段分镜 → 面板图 → 视频 → 配音 → 口型同步 → 视频合成）保持 waoowaoo 原有能力，没动。

## 核心能力

### 主管道（waoowaoo 基础）

- 项目 / 剧集 / 故事文本 / SRT 字幕管理
- 角色管理（别名、外观多版本、声音绑定、参考图）
- 场景库 / 道具库 / 资产中心（跨项目复用）
- 多阶段分镜（plan → cinematography → acting → detail）
- 面板图候选生成 + 候选投票
- 视频生成（fal / ark / minimax / vidu / google veo / openai-compatible）
- 角色配音 + 口型同步（lipsync）
- 任务队列（BullMQ）+ Worker + 失败重试 + Bull Board 管理面板
- 模型 API 配置中心（运行时按用户读取，零硬编码）
- 多语言（zh / en）

### 本工程新增（Studio Tools）

| 工具 | 路径 | 用途 |
|---|---|---|
| **MiMo TTS** | `/zh/studio-tools/mimo-tts` | 独立合成测试：粘文本 → WAV 试听/下载。同时也作为 first-class provider 供主管道配音阶段直接调用 |
| **即梦手动桥** | `/zh/studio-tools/jimeng` | 拼装即梦提示词 + 跳转官网 + 回传 mp4 → 可直接绑定到 NovelPromotionPanel.videoUrl |
| **角色四视图** | `/zh/studio-tools/four-view` | 为 NovelPromotionCharacter 或 GlobalCharacter 上传 4 张参考图（正/四分之三/侧/背）|

旁挂式架构：所有 Studio Tools 都不依赖主管道的任务队列，独立可用。

## 快速开始

### 环境要求

- Node.js 20+
- npm 9+
- Docker Desktop（跑 MySQL + Redis + MinIO）

### 本地开发模式

```powershell
# 1. 装依赖（含 prisma generate）
npm install

# 2. 起 docker 三件套
docker compose up mysql redis minio -d

# 3. 推送 schema 到 MySQL
npx prisma db push

# 4. 起应用（next + worker + watchdog + bull-board）
npm run dev
```

访问：

- 应用：http://localhost:3000
- 任务队列面板：http://localhost:3010/admin/queues
- MinIO 控制台：http://localhost:19001 (用户名/密码 `minioadmin/minioadmin`)

### Docker 容器模式

```powershell
docker compose up -d
```

访问：

- 应用：http://localhost:13000
- 任务队列面板：http://localhost:13010/admin/queues

### 首次使用顺序

1. 注册或登录本地账号
2. 进入设置中心配置模型 API Key（LLM / 文生图 / 文生视频 / TTS）
3. （可选）配置 MiMo provider：base URL `https://api.xiaomimimo.com/v1`，模型 `mimo-v2.5-tts`
4. 创建测试项目（推荐：2-4 角色 / 2-3 场景 / 3-6 道具 / 8-16 分镜）
5. 导入 800-2000 字故事或剧本
6. 检查角色/场景/道具抽取结果
7. 在 Studio Tools → 角色四视图上传角色参考图
8. 生成分镜 → 面板图 → 视频
9. 配音 → 口型同步 → 视频合成

### 关键配置

`.env`：

```env
BILLING_MODE=OFF              # 计费关闭（自托管默认）
DATABASE_URL=mysql://...      # MySQL 连接
REDIS_HOST=127.0.0.1
REDIS_PORT=16379
STORAGE_TYPE=minio            # minio | local | cos
MINIO_ENDPOINT=http://localhost:19000
NEXTAUTH_SECRET=...           # 自动生成
```

模型 API Key **不写在 .env**，启动后在 UI 设置中心管理。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16 (App Router) + React 19 + Tailwind 4 |
| 数据 | Prisma 6 + MySQL 8 |
| 任务 | BullMQ + Redis 7 |
| 存储 | MinIO (S3 兼容) / 本地 FS / 腾讯 COS |
| 认证 | NextAuth |
| 国际化 | next-intl (zh / en) |
| AI SDK | OpenAI / Gemini / Anthropic / 火山方舟 / 阿里百炼 / Fal / Minimax / Vidu / SiliconFlow / **小米 MiMo** |
| 视频处理 | Remotion + sharp |
| 测试 | vitest |

## 目录结构

```
aivedio/
├── prisma/                      # Prisma schema + migrations
├── src/
│   ├── app/[locale]/            # i18n 路由
│   │   ├── workspace/           # 主工作区（waoowaoo）
│   │   ├── studio-tools/        # 🆕 Studio Tools 入口
│   │   │   ├── mimo-tts/        # 🆕 MiMo TTS 工具页
│   │   │   ├── jimeng/          # 🆕 即梦手动桥
│   │   │   └── four-view/       # 🆕 角色四视图
│   │   └── ...
│   ├── app/api/
│   │   ├── novel-promotion/     # 主管道 API
│   │   ├── studio-tools/        # 🆕 Studio Tools API
│   │   │   ├── mimo-tts/
│   │   │   ├── jimeng/
│   │   │   └── character-four-view/
│   │   └── ...
│   ├── lib/
│   │   ├── novel-promotion/     # 主管道编排
│   │   ├── workflow-engine/     # 任务编排
│   │   ├── workers/             # BullMQ worker
│   │   ├── generators/          # 图/视频/语音 生成器（含新增的 mimo audio）
│   │   ├── providers/           # 各厂商 provider
│   │   │   ├── bailian/
│   │   │   ├── siliconflow/
│   │   │   ├── official/
│   │   │   └── mimo/            # 🆕 小米 MiMo provider
│   │   ├── storage/             # MinIO/Local/COS 存储抽象
│   │   ├── media/               # MediaObject 服务
│   │   ├── studio-tools/        # 🆕 工具核心逻辑
│   │   │   ├── mimo-tts.ts      # MiMo 合成核心
│   │   │   ├── jimeng-prompt.ts # 即梦提示词组装
│   │   │   └── four-view.ts     # 四视图共享逻辑
│   │   └── ...
│   └── components/
│       └── Navbar.tsx           # 含 Studio Tools 入口
├── messages/{zh,en}/
│   ├── nav.json
│   ├── studioTools.json         # 🆕 Studio Tools i18n
│   └── ...
├── docker-compose.yml
├── docker-compose.test.yml
├── .env.example
└── README.md / README_en.md
```

## 数据库 Schema 增强

本工程在 waoowaoo 基础上新增了 8 个字段：

```prisma
model NovelPromotionCharacter {
  // ... 既有字段
  referenceFrontUrl        String? @db.Text  // 🆕 正面参考图
  referenceThreeQuarterUrl String? @db.Text  // 🆕 四分之三视图
  referenceSideUrl         String? @db.Text  // 🆕 侧面参考图
  referenceBackUrl         String? @db.Text  // 🆕 背面参考图
}

model GlobalCharacter {
  // ... 既有字段
  referenceFrontUrl        String? @db.Text  // 🆕 跨项目复用四视图
  referenceThreeQuarterUrl String? @db.Text
  referenceSideUrl         String? @db.Text
  referenceBackUrl         String? @db.Text
}
```

升级现有数据库：

```powershell
npx prisma db push
```

## API 速查

### Studio Tools

```
POST  /api/studio-tools/mimo-tts                       MiMo TTS 合成
POST  /api/studio-tools/jimeng/prompt                  即梦提示词组装
POST  /api/studio-tools/jimeng/upload                  即梦视频回传（支持 panelId 自动绑定）
GET   /api/studio-tools/character-four-view            读 4 视图（?source=project|global）
POST  /api/studio-tools/character-four-view/upload     上传单张视图
DELETE /api/studio-tools/character-four-view           清除单张或全部视图
```

主管道 API 在 `/api/novel-promotion/[projectId]/...`，参考 [src/app/api/novel-promotion/](src/app/api/novel-promotion/)。

## 开发命令

```powershell
npm run dev          # 全套启动（next + worker + watchdog + bull-board）
npm run build        # 生产构建
npm run typecheck    # TypeScript 检查
npm run lint:all     # ESLint
npm run test:unit:all          # 单元测试
npm run test:integration:api   # API 集成测试
npm run check:guards           # 守护检查（路由契约 / 任务覆盖率 / 等）
```

## 路线图

- [x] 仓库重组：以 waoowaoo 为底座，合并旧 Python 原型
- [x] Studio Tools：MiMo TTS / 即梦手动桥 / 角色四视图
- [x] MiMo first-class provider（接入主管道配音阶段）
- [x] 即梦视频回传支持 panelId 自动绑定
- [x] 角色四视图 schema + API + UI（项目级 + 全局级）
- [x] Studio Tools i18n（zh / en）+ glass 设计系统
- [ ] AIComicBuilder 角色四视图自动注入到分镜面板 prompt
- [ ] 即梦提示词与 panel 数据双向同步（在 panel 视图直接打开工具）
- [ ] 视频合成阶段支持配置每镜过渡 / 字幕烧录

## 鸣谢

- [waoowaoo](https://github.com/saturndec/waoowaoo) — 提供成熟的 novel-promotion 主管道、任务编排、provider 抽象
- [AIComicBuilder](https://github.com/twwch/AIComicBuilder) — 角色四视图设计灵感
- 小米 [MiMo](https://github.com/XiaomiMiMo/MiMo) — TTS 模型

## 许可

继承 waoowaoo 原始许可（见 [LICENSE](LICENSE)）。
