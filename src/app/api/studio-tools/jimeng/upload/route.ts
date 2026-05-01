import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { uploadObject, generateUniqueKey, getSignedUrl } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'

/**
 * POST /api/studio-tools/jimeng/upload
 *
 * Accepts a video file uploaded by the user (downloaded from Jimeng website).
 * Stores it in MinIO/local storage and returns a fetchable URL + storage key.
 *
 * Two modes (driven by the optional FormData panelId):
 *   ① Standalone (no panelId): just upload, return url.
 *   ② Linked (panelId provided): also verifies project ownership and writes
 *      videoUrl + videoMediaId to the NovelPromotionPanel record so the panel
 *      view picks it up automatically.
 *
 * FormData:
 *   file:    Blob (mp4/mov/webm, required)
 *   tag?:    string (optional grouping tag for storage path)
 *   panelId?: string (optional; when set, attach to panel)
 *
 * Auth: user session required.
 */

const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // 200 MB

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
 * Panel → Storyboard → Episode → NovelPromotionProject → Project.userId.
 */
async function resolvePanelOwnerUserId(panelId: string): Promise<string | null> {
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
                  project: { select: { userId: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!panel) return null
  return panel.storyboard?.episode?.novelPromotionProject?.project?.userId ?? null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const userId = auth.session.user.id

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (file.size === 0) {
    throw new ApiError('INVALID_PARAMS')
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

  if (panelId) {
    const ownerUserId = await resolvePanelOwnerUserId(panelId)
    if (!ownerUserId) {
      throw new ApiError('NOT_FOUND')
    }
    if (ownerUserId !== userId) {
      throw new ApiError('FORBIDDEN')
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
})

export const dynamic = 'force-dynamic'
