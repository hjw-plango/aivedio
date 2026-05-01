# AI Video Studio

> Cinematic-grade AI video production workbench — documentary / animated / short-form drama in one environment

English · [中文](README.md)

## What is this

AI Video Studio is a **self-hosted** AI video production workbench. Built on top of the mature [waoowaoo](https://github.com/saturndec/waoowaoo) workflow as a foundation, with three custom enhancements for individual creators:

1. **MiMo TTS first-class provider** — Xiaomi MiMo TTS series wired into the main pipeline, with voice cloning and voice design
2. **Jimeng manual bridge** — Human-in-the-loop workflow for the (API-less) Jimeng video service: compose prompt → open Jimeng → upload result mp4, auto-bind to storyboard panel
3. **Character Four-View** — From AIComicBuilder design: 4 reference images per character (front / three-quarter / side / back) as a consistency anchor

The main pipeline (script split → character/location extraction → multi-stage storyboard → panel images → video → voice → lipsync → composition) keeps waoowaoo's original capabilities intact.

## Core capabilities

### Main pipeline (waoowaoo foundation)

- Project / Episode / Story / SRT subtitle management
- Character management (aliases, multi-version appearances, voice binding, reference images)
- Location / Prop libraries / Asset Hub (cross-project reuse)
- Multi-stage storyboard (plan → cinematography → acting → detail)
- Panel image candidate generation + voting
- Video generation (fal / ark / minimax / vidu / google veo / openai-compatible)
- Character voice + lip-sync
- Task queue (BullMQ) + workers + retries + Bull Board admin panel
- Per-user model API config center (runtime read, zero hardcoding)
- i18n (zh / en)

### Custom additions (Studio Tools)

| Tool | Path | Purpose |
|---|---|---|
| **MiMo TTS** | `/en/studio-tools/mimo-tts` | Standalone synth: paste text → WAV. Also exposed as a first-class provider for the main voice stage |
| **Jimeng Manual Bridge** | `/en/studio-tools/jimeng` | Compose Jimeng prompt + open website + upload mp4 → optionally bind to `NovelPromotionPanel.videoUrl` |
| **Character Four-View** | `/en/studio-tools/four-view` | Upload 4 references per `NovelPromotionCharacter` or `GlobalCharacter` |

Side-channel architecture: Studio Tools do not depend on the main pipeline's task queue.

## Quick start

### Requirements

- Node.js 20+
- npm 9+
- Docker Desktop (for MySQL + Redis + MinIO)

### Local dev mode

```powershell
# 1. Install deps (runs prisma generate in postinstall)
npm install

# 2. Bring up the docker trio
docker compose up mysql redis minio -d

# 3. Push schema to MySQL
npx prisma db push

# 4. Start (next + worker + watchdog + bull-board)
npm run dev
```

Open:

- App:               http://localhost:3000
- Task queue:        http://localhost:3010/admin/queues
- MinIO console:     http://localhost:19001 (login `minioadmin` / `minioadmin`)

### Docker container mode

```powershell
docker compose up -d
```

Open:

- App:               http://localhost:13000
- Task queue:        http://localhost:13010/admin/queues

### First-time use

1. Register / sign in
2. In Settings, add your LLM / image / video / TTS API keys
3. (Optional) Add a MiMo provider: base URL `https://api.xiaomimimo.com/v1`, model `mimo-v2.5-tts`
4. Create a test project (recommend: 2-4 characters / 2-3 locations / 3-6 props / 8-16 panels)
5. Import an 800-2000 word story or screenplay
6. Verify character/location/prop extraction
7. In Studio Tools → Four-View, upload reference images per character
8. Generate storyboard → panel images → videos
9. Voice → lipsync → composition

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + Tailwind 4 |
| Data | Prisma 6 + MySQL 8 |
| Tasks | BullMQ + Redis 7 |
| Storage | MinIO (S3-compatible) / local FS / Tencent COS |
| Auth | NextAuth |
| i18n | next-intl (zh / en) |
| AI SDKs | OpenAI / Gemini / Anthropic / Volcano Ark / Aliyun Bailian / Fal / Minimax / Vidu / SiliconFlow / **Xiaomi MiMo** |
| Video | Remotion + sharp |
| Tests | vitest |

## Schema additions

8 new fields on top of the waoowaoo schema:

```prisma
model NovelPromotionCharacter {
  // ... existing
  referenceFrontUrl        String? @db.Text  // NEW
  referenceThreeQuarterUrl String? @db.Text  // NEW
  referenceSideUrl         String? @db.Text  // NEW
  referenceBackUrl         String? @db.Text  // NEW
}

model GlobalCharacter {
  // ... existing
  referenceFrontUrl        String? @db.Text  // NEW (cross-project)
  referenceThreeQuarterUrl String? @db.Text
  referenceSideUrl         String? @db.Text
  referenceBackUrl         String? @db.Text
}
```

Apply with `npx prisma db push`.

## Studio Tools API cheatsheet

```
POST  /api/studio-tools/mimo-tts                       MiMo TTS synth
POST  /api/studio-tools/jimeng/prompt                  Compose Jimeng prompt
POST  /api/studio-tools/jimeng/upload                  Upload Jimeng mp4 (optional panelId binding)
GET   /api/studio-tools/character-four-view            Read 4 views (?source=project|global)
POST  /api/studio-tools/character-four-view/upload     Upload one view
DELETE /api/studio-tools/character-four-view           Clear one view or all
```

## Roadmap

- [x] Restructure: waoowaoo as foundation, drop legacy prototype
- [x] Studio Tools: MiMo TTS / Jimeng manual bridge / four-view
- [x] MiMo as first-class provider (main voice stage integration)
- [x] Jimeng upload → auto-bind to panel
- [x] Four-view schema + API + UI (project + global)
- [x] Studio Tools i18n (zh / en) + glass design system
- [ ] Auto-inject four-view into storyboard panel prompts
- [ ] Bidirectional sync between Jimeng tool and panel views
- [ ] Per-shot transitions and subtitle burn-in in composition

## Acknowledgements

- [waoowaoo](https://github.com/saturndec/waoowaoo) — main pipeline, task orchestration, provider abstractions
- [AIComicBuilder](https://github.com/twwch/AIComicBuilder) — four-view design inspiration
- Xiaomi [MiMo](https://github.com/XiaomiMiMo/MiMo) — TTS models

## License

Inherits the waoowaoo upstream license — see [LICENSE](LICENSE).
