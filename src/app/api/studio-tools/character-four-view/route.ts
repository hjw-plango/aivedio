import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/api-auth'

/**
 * Four-view character reference query / clear.
 *
 * GET /api/studio-tools/character-four-view?characterId=...
 *   Returns the 4 reference URLs for the character.
 *
 * DELETE /api/studio-tools/character-four-view?characterId=...&viewType=...
 *   Clears one view (sets URL to null). viewType=all clears all four.
 *
 * Auth: user must own the character (via project).
 */

const VIEW_TYPES = ['front', 'threeQuarter', 'side', 'back'] as const
type ViewType = (typeof VIEW_TYPES)[number]

const VIEW_FIELD: Record<ViewType, 'referenceFrontUrl' | 'referenceThreeQuarterUrl' | 'referenceSideUrl' | 'referenceBackUrl'> = {
  front: 'referenceFrontUrl',
  threeQuarter: 'referenceThreeQuarterUrl',
  side: 'referenceSideUrl',
  back: 'referenceBackUrl',
}

async function resolveCharacterOwner(characterId: string): Promise<string | null> {
  const row = await prisma.novelPromotionCharacter.findUnique({
    where: { id: characterId },
    select: {
      novelPromotionProject: {
        select: {
          project: { select: { userId: true } },
        },
      },
    },
  })
  return row?.novelPromotionProject?.project?.userId ?? null
}

async function requireOwnership(characterId: string): Promise<NextResponse | { userId: string }> {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const ownerUserId = await resolveCharacterOwner(characterId)
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
  const auth = await requireOwnership(characterId)
  if (auth instanceof NextResponse) return auth

  const character = await prisma.novelPromotionCharacter.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      referenceFrontUrl: true,
      referenceThreeQuarterUrl: true,
      referenceSideUrl: true,
      referenceBackUrl: true,
    },
  })
  if (!character) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 })
  }
  return NextResponse.json({
    characterId: character.id,
    name: character.name,
    views: {
      front: character.referenceFrontUrl,
      threeQuarter: character.referenceThreeQuarterUrl,
      side: character.referenceSideUrl,
      back: character.referenceBackUrl,
    },
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
  const auth = await requireOwnership(characterId)
  if (auth instanceof NextResponse) return auth

  if (viewTypeRaw === 'all') {
    await prisma.novelPromotionCharacter.update({
      where: { id: characterId },
      data: {
        referenceFrontUrl: null,
        referenceThreeQuarterUrl: null,
        referenceSideUrl: null,
        referenceBackUrl: null,
      },
    })
    return NextResponse.json({ characterId, cleared: 'all' })
  }

  const isView = (VIEW_TYPES as readonly string[]).includes(viewTypeRaw)
  if (!isView) {
    return NextResponse.json(
      { error: `viewType must be one of: ${VIEW_TYPES.join(', ')}, all` },
      { status: 400 },
    )
  }
  const field = VIEW_FIELD[viewTypeRaw as ViewType]
  await prisma.novelPromotionCharacter.update({
    where: { id: characterId },
    data: { [field]: null },
  })
  return NextResponse.json({ characterId, cleared: viewTypeRaw })
}

export const dynamic = 'force-dynamic'
