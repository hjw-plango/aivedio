import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { uploadObject, generateUniqueKey } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import {
  isCharacterSource,
  isViewType,
  resolveCharacterOwnerUserId,
  setCharacterFourViewUrl,
  type CharacterSource,
  type ViewType,
} from '@/lib/studio-tools/four-view'

/**
 * Four-view character reference upload (AIComicBuilder-inspired).
 *
 * POST /api/studio-tools/character-four-view/upload
 *   FormData:
 *     characterId: string (required)
 *     viewType:    'front' | 'threeQuarter' | 'side' | 'back' (required)
 *     source?:     'project' | 'global' (default 'project')
 *     file:        Blob image (png/jpg/webp/gif, required)
 *   Returns: { url, mediaId, viewType, source }
 *
 * Auth: user must own the character (project chain or globalCharacter.userId).
 */

const MAX_IMAGE_BYTES = 30 * 1024 * 1024 // 30 MB
const ACCEPTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

function pickExtension(file: File): string {
  const name = file.name || ''
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx >= 0) {
    const ext = name.slice(dotIdx + 1).toLowerCase()
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext
  }
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/gif') return 'gif'
  return 'jpg'
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

  const characterIdRaw = form.get('characterId')
  const viewTypeRaw = form.get('viewType')
  const sourceRaw = form.get('source')
  const file = form.get('file')

  const characterId =
    typeof characterIdRaw === 'string' && characterIdRaw.trim().length > 0
      ? characterIdRaw.trim()
      : null
  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!isViewType(viewTypeRaw)) {
    throw new ApiError('INVALID_PARAMS')
  }
  const viewType: ViewType = viewTypeRaw

  const sourceCandidate = typeof sourceRaw === 'string' ? sourceRaw.trim() : 'project'
  const source: CharacterSource = isCharacterSource(sourceCandidate) ? sourceCandidate : 'project'

  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (file.size === 0) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `file too large (>${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    )
  }
  if (file.type && !ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `unsupported file type: ${file.type}` }, { status: 415 })
  }

  // Authorization: character must belong to authenticated user.
  const ownerUserId = await resolveCharacterOwnerUserId(source, characterId)
  if (!ownerUserId) {
    throw new ApiError('NOT_FOUND')
  }
  if (ownerUserId !== userId) {
    throw new ApiError('FORBIDDEN')
  }

  const ext = pickExtension(file)
  const prefix = `characters/${source}/${characterId}/four-view/${viewType}`
  const key = generateUniqueKey(prefix, ext)
  const buffer = Buffer.from(await file.arrayBuffer())
  const contentType = file.type || 'image/jpeg'

  let storedKey: string
  try {
    storedKey = await uploadObject(buffer, key, 3, contentType)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `upload failed: ${message}` }, { status: 500 })
  }

  const media = await ensureMediaObjectFromStorageKey(storedKey, {
    mimeType: contentType,
    sizeBytes: buffer.length,
  })

  await setCharacterFourViewUrl(source, characterId, viewType, media.url)

  return NextResponse.json({
    characterId,
    source,
    viewType,
    url: media.url,
    mediaId: media.id,
  })
})

export const dynamic = 'force-dynamic'
