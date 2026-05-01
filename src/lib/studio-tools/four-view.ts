import { prisma } from '@/lib/prisma'

/**
 * Source of the character record for four-view operations.
 *
 * - `project` → `NovelPromotionCharacter` (project-scoped)
 * - `global`  → `GlobalCharacter` (cross-project, owned by user directly)
 */
export type CharacterSource = 'project' | 'global'

const PROJECT_SOURCES: readonly CharacterSource[] = ['project', 'global']

export function isCharacterSource(value: unknown): value is CharacterSource {
  return typeof value === 'string' && (PROJECT_SOURCES as readonly string[]).includes(value)
}

export type ViewType = 'front' | 'threeQuarter' | 'side' | 'back'

const VIEW_TYPES: readonly ViewType[] = ['front', 'threeQuarter', 'side', 'back']

export function isViewType(value: unknown): value is ViewType {
  return typeof value === 'string' && (VIEW_TYPES as readonly string[]).includes(value)
}

export function listViewTypes(): readonly ViewType[] {
  return VIEW_TYPES
}

export const VIEW_FIELD: Record<
  ViewType,
  'referenceFrontUrl' | 'referenceThreeQuarterUrl' | 'referenceSideUrl' | 'referenceBackUrl'
> = {
  front: 'referenceFrontUrl',
  threeQuarter: 'referenceThreeQuarterUrl',
  side: 'referenceSideUrl',
  back: 'referenceBackUrl',
}

export interface CharacterFourViewSnapshot {
  id: string
  name: string
  source: CharacterSource
  views: {
    front: string | null
    threeQuarter: string | null
    side: string | null
    back: string | null
  }
}

/**
 * Resolve the userId that owns the given character (regardless of source).
 * Returns null if not found.
 */
export async function resolveCharacterOwnerUserId(
  source: CharacterSource,
  characterId: string,
): Promise<string | null> {
  if (source === 'global') {
    const row = await prisma.globalCharacter.findUnique({
      where: { id: characterId },
      select: { userId: true },
    })
    return row?.userId ?? null
  }

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

/**
 * Read the four-view URLs for a character.
 */
export async function readCharacterFourView(
  source: CharacterSource,
  characterId: string,
): Promise<CharacterFourViewSnapshot | null> {
  if (source === 'global') {
    const row = await prisma.globalCharacter.findUnique({
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
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      source: 'global',
      views: {
        front: row.referenceFrontUrl,
        threeQuarter: row.referenceThreeQuarterUrl,
        side: row.referenceSideUrl,
        back: row.referenceBackUrl,
      },
    }
  }

  const row = await prisma.novelPromotionCharacter.findUnique({
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
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    source: 'project',
    views: {
      front: row.referenceFrontUrl,
      threeQuarter: row.referenceThreeQuarterUrl,
      side: row.referenceSideUrl,
      back: row.referenceBackUrl,
    },
  }
}

/**
 * Update one view URL on a character.
 */
export async function setCharacterFourViewUrl(
  source: CharacterSource,
  characterId: string,
  view: ViewType,
  url: string | null,
): Promise<void> {
  const field = VIEW_FIELD[view]
  if (source === 'global') {
    await prisma.globalCharacter.update({
      where: { id: characterId },
      data: { [field]: url },
    })
    return
  }
  await prisma.novelPromotionCharacter.update({
    where: { id: characterId },
    data: { [field]: url },
  })
}

/**
 * Clear all four views on a character.
 */
export async function clearAllCharacterFourViews(
  source: CharacterSource,
  characterId: string,
): Promise<void> {
  const data = {
    referenceFrontUrl: null,
    referenceThreeQuarterUrl: null,
    referenceSideUrl: null,
    referenceBackUrl: null,
  }
  if (source === 'global') {
    await prisma.globalCharacter.update({ where: { id: characterId }, data })
    return
  }
  await prisma.novelPromotionCharacter.update({ where: { id: characterId }, data })
}
