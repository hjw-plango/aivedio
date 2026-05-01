import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import {
  isCharacterSource,
  isViewType,
  readCharacterFourView,
  resolveCharacterOwnerUserId,
  clearAllCharacterFourViews,
  setCharacterFourViewUrl,
  listViewTypes,
  type CharacterSource,
} from '@/lib/studio-tools/four-view'

/**
 * Four-view character reference query / clear.
 *
 * GET    /api/studio-tools/character-four-view?characterId=...&source=project|global
 * DELETE /api/studio-tools/character-four-view?characterId=...&viewType=...&source=...
 *
 * `source` defaults to `project` (NovelPromotionCharacter). Use `global` for
 * cross-project GlobalCharacter records.
 *
 * Auth: requires user session AND ownership of the character.
 */

function readSource(url: URL): CharacterSource {
  const raw = url.searchParams.get('source')?.trim() || 'project'
  return isCharacterSource(raw) ? raw : 'project'
}

async function ensureOwnership(
  source: CharacterSource,
  characterId: string,
  userId: string,
): Promise<void> {
  const ownerUserId = await resolveCharacterOwnerUserId(source, characterId)
  if (!ownerUserId) {
    throw new ApiError('NOT_FOUND')
  }
  if (ownerUserId !== userId) {
    throw new ApiError('FORBIDDEN')
  }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const userId = auth.session.user.id

  const url = new URL(req.url)
  const characterId = url.searchParams.get('characterId')?.trim()
  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const source = readSource(url)
  await ensureOwnership(source, characterId, userId)

  const snapshot = await readCharacterFourView(source, characterId)
  if (!snapshot) {
    throw new ApiError('NOT_FOUND')
  }
  return NextResponse.json({
    characterId: snapshot.id,
    name: snapshot.name,
    source: snapshot.source,
    views: snapshot.views,
  })
})

export const DELETE = apiHandler(async (req: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const userId = auth.session.user.id

  const url = new URL(req.url)
  const characterId = url.searchParams.get('characterId')?.trim()
  const viewTypeRaw = url.searchParams.get('viewType')?.trim()
  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!viewTypeRaw) {
    throw new ApiError('INVALID_PARAMS')
  }
  const source = readSource(url)
  await ensureOwnership(source, characterId, userId)

  if (viewTypeRaw === 'all') {
    await clearAllCharacterFourViews(source, characterId)
    return NextResponse.json({ characterId, source, cleared: 'all' })
  }

  if (!isViewType(viewTypeRaw)) {
    return NextResponse.json(
      { error: `viewType must be one of: ${listViewTypes().join(', ')}, all` },
      { status: 400 },
    )
  }
  await setCharacterFourViewUrl(source, characterId, viewTypeRaw, null)
  return NextResponse.json({ characterId, source, cleared: viewTypeRaw })
})

export const dynamic = 'force-dynamic'
