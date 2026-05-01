import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/api-auth'
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
 * Auth: user must own the character (project chain or globalCharacter.userId).
 */

function readSource(url: URL): CharacterSource {
  const raw = url.searchParams.get('source')?.trim() || 'project'
  return isCharacterSource(raw) ? raw : 'project'
}

async function requireOwnership(
  source: CharacterSource,
  characterId: string,
): Promise<NextResponse | { userId: string }> {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const ownerUserId = await resolveCharacterOwnerUserId(source, characterId)
  if (!ownerUserId) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 })
  }
  if (ownerUserId !== session.user.id) {
    return NextResponse.json({ error: 'Character belongs to a different user' }, { status: 403 })
  }
  return { userId: session.user.id }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const characterId = url.searchParams.get('characterId')?.trim()
  if (!characterId) {
    return NextResponse.json({ error: 'characterId is required' }, { status: 400 })
  }
  const source = readSource(url)
  const auth = await requireOwnership(source, characterId)
  if (auth instanceof NextResponse) return auth

  const snapshot = await readCharacterFourView(source, characterId)
  if (!snapshot) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 })
  }
  return NextResponse.json({
    characterId: snapshot.id,
    name: snapshot.name,
    source: snapshot.source,
    views: snapshot.views,
  })
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url)
  const characterId = url.searchParams.get('characterId')?.trim()
  const viewTypeRaw = url.searchParams.get('viewType')?.trim()
  if (!characterId) {
    return NextResponse.json({ error: 'characterId is required' }, { status: 400 })
  }
  if (!viewTypeRaw) {
    return NextResponse.json({ error: 'viewType is required' }, { status: 400 })
  }
  const source = readSource(url)
  const auth = await requireOwnership(source, characterId)
  if (auth instanceof NextResponse) return auth

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
}

export const dynamic = 'force-dynamic'
