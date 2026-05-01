import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadObject, generateUniqueKey, getSignedUrl } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { getAuthSession } from '@/lib/api-auth'

/**
 * POST /api/studio-tools/jimeng/upload
 *
 * Accepts a video file uploaded by the user (downloaded from Jimeng website).
 * Stores it in MinIO/local storage and returns a fetchable URL + storage key.
 *
 * Two modes:
 *   ① Standalone (no panelId): just upload, return url. No auth required.
 *   ② Linked (panelId provided): auth + project ownership check, then write
 *      videoUrl + videoMediaId to the NovelPromotionPanel record so the panel
 *      view picks it up automatically.
 *
 * FormData:
 *   file:    Blob (mp4/mov/webm, required)
 *   tag?:    string (optional grouping tag for storage path)
 *   panelId?: string (optional; when set, attach to panel)
 *
 * Response 200 standalone:
 *   { key, url, sizeBytes, contentType, mode: 'standalone' }
 *
 * Response 200 linked:
 *   { key, url, sizeBytes, contentType, mode: 'linked',
 *     panelId, mediaId, mediaUrl }
 */

const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // 200 MB
const ACCEPTED_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
])

function pickExtension(file: File): string {
  const name = file.name || ''
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx >= 0) {
    const ext = name.slice(dotIdx + 1).toLowerCase()
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext
  }
  if (file.type === 'video/quicktime') return 'mov'
  if (file.type === 'video/webm') return 'webm'
  return 'mp4'
}

/**
 * Resolve the project owner of a given panel.
 *
 * Panel → Storyboard → Episode → NovelPromotionProject → Project (whose
 * userId is the owner). Returns null if any link is missing.
 */
async function resolvePanelOwnerUserId(panelId: string): Promise<{
  userId: string | null
  projectInternalId: string | null
} | null> {
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      storyboard: {
        select: {
          episode: {
            select: {
              novelPromotionProject: {
                select: {
                  projectId: true,
                  project: { select: { id: true, userId: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!panel) return null
  const project = panel.storyboard?.episode?.novelPromotionProject?.project
  return {
    userId: project?.userId ?? null,
    projectInternalId: project?.id ?? null,
  }
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 })
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: `file too large (>${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    )
  }

  const tagRaw = form.get('tag')
  const tag = typeof tagRaw === 'string' && /^[a-zA-Z0-9_-]{0,40}$/.test(tagRaw) ? tagRaw : ''

  const panelIdRaw = form.get('panelId')
  const panelId =
    typeof panelIdRaw === 'string' && panelIdRaw.trim().length > 0
      ? panelIdRaw.trim()
      : null

  // Auth check is only required when linking to a panel.
  let authedUserId: string | null = null
  if (panelId) {
    const session = await getAuthSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required to link to a panel' }, { status: 401 })
    }
    authedUserId = session.user.id

    const owner = await resolvePanelOwnerUserId(panelId)
    if (!owner) {
      return NextResponse.json({ error: 'Panel not found' }, { status: 404 })
    }
    if (owner.userId !== authedUserId) {
      return NextResponse.json({ error: 'Panel belongs to a different user' }, { status: 403 })
    }
  }

  const ext = pickExtension(file)
  const prefix = panelId ? `jimeng/panel/${panelId}` : tag ? `jimeng/${tag}` : 'jimeng/manual'
  const key = generateUniqueKey(prefix, ext)

  const buffer = Buffer.from(await file.arrayBuffer())
  const contentType = file.type || 'video/mp4'

  let storedKey: string
  try {
    storedKey = await uploadObject(buffer, key, 3, contentType)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `upload failed: ${message}` }, { status: 500 })
  }

  // Standalone mode: done.
  if (!panelId) {
    return NextResponse.json({
      mode: 'standalone' as const,
      key: storedKey,
      url: getSignedUrl(storedKey),
      sizeBytes: buffer.length,
      contentType,
    })
  }

  // Linked mode: register MediaObject, attach to panel.
  try {
    const media = await ensureMediaObjectFromStorageKey(storedKey, {
      mimeType: contentType,
      sizeBytes: buffer.length,
    })

    await prisma.novelPromotionPanel.update({
      where: { id: panelId },
      data: {
        videoUrl: media.url,
        videoMediaId: media.id,
      },
    })

    return NextResponse.json({
      mode: 'linked' as const,
      key: storedKey,
      url: media.url,
      sizeBytes: buffer.length,
      contentType,
      panelId,
      mediaId: media.id,
      mediaUrl: media.url,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `linked-mode write failed (file uploaded to ${storedKey}): ${message}` },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
