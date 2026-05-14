import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { resolveMediaRef, resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { JIMENG_WEBSITE_URL } from '@/lib/studio-tools/jimeng-prompt'
import {
  buildVideoPanelGuidance,
  type VideoPanelGuidance,
} from '@/lib/novel-promotion/video-panel-guidance'

type JimengReferenceKind =
  | 'first-frame'
  | 'character-primary'
  | 'character-front'
  | 'character-three-quarter'
  | 'character-side'
  | 'character-back'
  | 'location'
  | 'prop'

type JimengReferenceItem = {
  kind: JimengReferenceKind
  label: string
  url: string
}

type JimengGuidanceText = {
  durationSummary: string
  durationNote: string
  firstLastFrameSummary: string
  firstLastFrameNote: string
}

const VIEW_LABELS = {
  referenceFrontUrl: { kind: 'character-front' as const, label: '正面' },
  referenceThreeQuarterUrl: { kind: 'character-three-quarter' as const, label: '四分之三' },
  referenceSideUrl: { kind: 'character-side' as const, label: '侧面' },
  referenceBackUrl: { kind: 'character-back' as const, label: '背面' },
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitNames(value: string | null | undefined): string[] {
  const raw = trimString(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item) => trimString(item)).filter(Boolean)
    }
  } catch {
    // Plain comma/semicolon text is the common shape.
  }
  return raw
    .split(/[,\uFF0C\u3001;\uFF1B\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function includesName(haystack: string, name: string): boolean {
  const normalizedName = name.trim().toLowerCase()
  if (!normalizedName) return false
  return haystack.includes(normalizedName)
}

function matchesAssetName(assetName: string, candidates: string[], contextText: string): boolean {
  const normalizedAssetName = assetName.trim().toLowerCase()
  if (!normalizedAssetName) return false
  if (candidates.some((candidate) => {
    const normalizedCandidate = candidate.toLowerCase()
    return normalizedCandidate === normalizedAssetName
      || normalizedCandidate.includes(normalizedAssetName)
      || normalizedAssetName.includes(normalizedCandidate)
  })) {
    return true
  }
  return includesName(contextText, normalizedAssetName)
}

async function resolveDisplayUrl(mediaId: string | null | undefined, legacyValue: string | null | undefined): Promise<string | null> {
  const media = await resolveMediaRef(mediaId, legacyValue)
  if (media?.url) return media.url
  const value = trimString(legacyValue)
  if (!value) return null
  if (value.startsWith('/m/') || value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value
  }
  const legacyMedia = await resolveMediaRefFromLegacyValue(value)
  return legacyMedia?.url || value
}

function pushReference(list: JimengReferenceItem[], seen: Set<string>, item: JimengReferenceItem | null) {
  if (!item?.url || seen.has(item.url)) return
  seen.add(item.url)
  list.push(item)
}

function normalizeSentence(parts: string[]): string {
  const clean = parts.map((part) => part.trim().replace(/[。,.，]+$/g, '')).filter(Boolean)
  if (clean.length === 0) return ''
  return `${clean.join('，')}。`
}

function formatSeconds(value: number | null): string {
  if (typeof value !== 'number') return ''
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function describeDurationGuidanceZh(guidance: VideoPanelGuidance): { summary: string; note: string } {
  const duration = guidance.duration
  const source = formatSeconds(duration.sourceSeconds)
  const target = formatSeconds(duration.recommendedSeconds)
  const summary = `目标剪辑 ${target} 秒`
  if (duration.bucket === 'default') {
    return { summary, note: `未读到明确字幕时长，已按镜头动作估算为 ${target} 秒；短反应镜头不要默认拉长到 5 秒。` }
  }
  if (duration.bucket === 'short') {
    return { summary, note: `分镜原时长约 ${source} 秒，按 ${target} 秒短镜头处理；即梦只能选更长档位时，生成后按该目标时长截取。` }
  }
  if (duration.bucket === 'long') {
    return { summary, note: `分镜原时长约 ${source} 秒，目标剪辑 ${target} 秒；超过 10 秒的动作建议拆成多个镜头。` }
  }
  return { summary, note: `分镜原时长约 ${source} 秒，按 ${target} 秒镜头节奏生成。` }
}

function describeFirstLastFrameGuidanceZh(guidance: VideoPanelGuidance): { summary: string; note: string } {
  const frame = guidance.firstLastFrame
  const summaryByStatus = {
    recommended: '建议首尾帧',
    optional: '可选首尾帧',
    notRecommended: '普通生成',
    unavailable: '先补首帧图',
  } satisfies Record<typeof frame.status, string>
  const noteByReason = {
    lastPanel: '最后一镜没有下一张尾帧，按普通视频生成。',
    missingFrame: '当前或下一镜头缺少图片，无法稳定做首尾帧。',
    sceneChange: '下一镜头切换场景，独立生成再剪辑更自然。',
    characterChange: '下一镜头切换角色，独立生成能避免串脸。',
    continuousMotion: '同场景或同角色存在连续动作，首尾帧能保持运动和画面一致。',
    sameSceneCharacter: '同场景同角色但动作不强连续，可按画面需要决定。',
    sameScene: '场景或角色有延续关系，可选首尾帧增强一致性。',
    insufficientContinuity: '未识别出明确连续关系，默认普通生成。',
  } satisfies Record<typeof frame.reason, string>
  return {
    summary: summaryByStatus[frame.status],
    note: noteByReason[frame.reason],
  }
}

function buildGuidanceText(guidance: VideoPanelGuidance): JimengGuidanceText {
  const duration = describeDurationGuidanceZh(guidance)
  const firstLastFrame = describeFirstLastFrameGuidanceZh(guidance)
  return {
    durationSummary: duration.summary,
    durationNote: duration.note,
    firstLastFrameSummary: firstLastFrame.summary,
    firstLastFrameNote: firstLastFrame.note,
  }
}

function buildPrompt(input: {
  basePrompt: string
  description: string
  shotType: string
  cameraMove: string
  location: string
  characters: string
  duration: number | null
  artStyle: string
  artStylePrompt: string
  hasFirstFrame: boolean
  hasReferences: boolean
}): string {
  const parts = [
    input.basePrompt || input.description,
    input.characters ? `角色：${input.characters}` : '',
    input.location ? `场景：${input.location}` : '',
    input.shotType ? `景别：${input.shotType}` : '',
    input.cameraMove ? `运镜：${input.cameraMove}` : '',
    input.artStylePrompt || input.artStyle ? `视觉风格：${input.artStylePrompt || input.artStyle}` : '',
    input.duration ? `${formatSeconds(input.duration)}秒` : '',
  ]
  if (input.hasFirstFrame) {
    parts.push('以首帧参考图作为画面起点')
  }
  if (input.hasReferences) {
    parts.push('保持角色外貌、服装、发型、场景空间与参考图一致')
  }
  return normalizeSentence(parts)
}

function buildPackageText(input: {
  panelId: string
  panelNumber: number | null
  prompt: string
  negative: string
  references: JimengReferenceItem[]
  guidance: JimengGuidanceText
  meta: {
    description: string
    shotType: string
    cameraMove: string
    location: string
    characters: string
    props: string
  }
}) {
  const lines = [
    `# 即梦分镜包 ${input.panelNumber ? `Panel ${input.panelNumber}` : input.panelId}`,
    '',
    '## 提示词',
    input.prompt || '(空)',
    '',
    '## 负面提示',
    input.negative,
    '',
    '## 生成建议',
    `- 视频时长: ${input.guidance.durationSummary}`,
    `  ${input.guidance.durationNote}`,
    `- 首尾帧: ${input.guidance.firstLastFrameSummary}`,
    `  ${input.guidance.firstLastFrameNote}`,
    '',
    '## 参考图',
    ...(
      input.references.length > 0
        ? input.references.map((item, index) => `${index + 1}. ${item.label}: ${item.url}`)
        : ['无']
    ),
    '',
    '## 分镜信息',
    `- panelId: ${input.panelId}`,
    input.meta.description ? `- 画面描述: ${input.meta.description}` : '',
    input.meta.shotType ? `- 景别: ${input.meta.shotType}` : '',
    input.meta.cameraMove ? `- 运镜: ${input.meta.cameraMove}` : '',
    input.meta.location ? `- 场景: ${input.meta.location}` : '',
    input.meta.characters ? `- 角色: ${input.meta.characters}` : '',
    input.meta.props ? `- 道具: ${input.meta.props}` : '',
  ].filter((line) => line !== '')

  return lines.join('\n')
}

export const GET = apiHandler(async (req: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const userId = auth.session.user.id

  const { searchParams } = new URL(req.url)
  const panelId = trimString(searchParams.get('panelId'))
  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      panelIndex: true,
      panelNumber: true,
      shotType: true,
      cameraMove: true,
      description: true,
      location: true,
      characters: true,
      props: true,
      duration: true,
      imagePrompt: true,
      videoPrompt: true,
      firstLastFramePrompt: true,
      imageUrl: true,
      imageMediaId: true,
      storyboard: {
        select: {
          id: true,
          episode: {
            select: {
              id: true,
              episodeNumber: true,
              name: true,
              novelPromotionProject: {
                select: {
                  id: true,
                  projectId: true,
                  artStyle: true,
                  artStylePrompt: true,
                  project: { select: { userId: true } },
                  characters: {
                    select: {
                      id: true,
                      name: true,
                      aliases: true,
                      referenceFrontUrl: true,
                      referenceThreeQuarterUrl: true,
                      referenceSideUrl: true,
                      referenceBackUrl: true,
                      appearances: {
                        orderBy: { appearanceIndex: 'asc' },
                        select: {
                          imageUrl: true,
                          imageMediaId: true,
                          selectedIndex: true,
                        },
                      },
                    },
                  },
                  locations: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                      id: true,
                      name: true,
                      summary: true,
                      assetKind: true,
                      selectedImageId: true,
                      selectedImage: {
                        select: {
                          imageUrl: true,
                          imageMediaId: true,
                        },
                      },
                      images: {
                        orderBy: { imageIndex: 'asc' },
                        select: {
                          id: true,
                          imageUrl: true,
                          imageMediaId: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const project = panel.storyboard.episode.novelPromotionProject
  if (project.project.userId !== userId) {
    throw new ApiError('FORBIDDEN')
  }

  const references: JimengReferenceItem[] = []
  const seenUrls = new Set<string>()
  const firstFrameUrl = await resolveDisplayUrl(panel.imageMediaId, panel.imageUrl)
  const episodeStoryboards = await prisma.novelPromotionStoryboard.findMany({
    where: { episodeId: panel.storyboard.episode.id },
    select: {
      id: true,
      clip: { select: { start: true, end: true } },
      panels: {
        orderBy: { panelIndex: 'asc' },
        select: {
          id: true,
          panelIndex: true,
          shotType: true,
          cameraMove: true,
          description: true,
          location: true,
          characters: true,
          duration: true,
          imageUrl: true,
          imageMediaId: true,
        },
      },
    },
  })
  const orderedEpisodePanels = [...episodeStoryboards]
    .sort((left, right) => {
      const leftStart = typeof left.clip?.start === 'number' ? left.clip.start : Number.MAX_SAFE_INTEGER
      const rightStart = typeof right.clip?.start === 'number' ? right.clip.start : Number.MAX_SAFE_INTEGER
      if (leftStart !== rightStart) return leftStart - rightStart
      return (left.clip?.end ?? 0) - (right.clip?.end ?? 0)
    })
    .flatMap((storyboard) => storyboard.panels.map((item) => ({ ...item, storyboardId: storyboard.id })))
  const currentPanelPosition = orderedEpisodePanels.findIndex((item) => item.id === panel.id)
  const nextPanelForGuidance = currentPanelPosition >= 0 ? orderedEpisodePanels[currentPanelPosition + 1] ?? null : null
  const nextFrameUrl = nextPanelForGuidance
    ? await resolveDisplayUrl(nextPanelForGuidance.imageMediaId, nextPanelForGuidance.imageUrl)
    : null
  const guidance = buildVideoPanelGuidance({
    panel: {
      imageUrl: firstFrameUrl || panel.imageUrl,
      duration: panel.duration,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      location: panel.location,
      characters: panel.characters,
    },
    nextPanel: nextPanelForGuidance
      ? {
          imageUrl: nextFrameUrl || nextPanelForGuidance.imageUrl,
          duration: nextPanelForGuidance.duration,
          shotType: nextPanelForGuidance.shotType,
          cameraMove: nextPanelForGuidance.cameraMove,
          description: nextPanelForGuidance.description,
          location: nextPanelForGuidance.location,
          characters: nextPanelForGuidance.characters,
        }
      : null,
  })
  const guidanceText = buildGuidanceText(guidance)
  pushReference(references, seenUrls, firstFrameUrl
    ? { kind: 'first-frame', label: '首帧参考图', url: firstFrameUrl }
    : null)

  const characterNames = splitNames(panel.characters)
  const locationNames = splitNames(panel.location)
  const propNames = splitNames(panel.props)
  const contextText = [
    panel.characters,
    panel.location,
    panel.props,
    panel.description,
    panel.imagePrompt,
    panel.videoPrompt,
  ].map(trimString).join('\n').toLowerCase()

  for (const character of project.characters) {
    const aliasNames = splitNames(character.aliases)
    const candidates = [...characterNames, ...aliasNames]
    if (!matchesAssetName(character.name, candidates, contextText)) continue

    const primaryAppearance = character.appearances[0]
    const primaryUrl = primaryAppearance
      ? await resolveDisplayUrl(primaryAppearance.imageMediaId, primaryAppearance.imageUrl)
      : null
    pushReference(references, seenUrls, primaryUrl
      ? { kind: 'character-primary', label: `角色：${character.name} 主形象`, url: primaryUrl }
      : null)

    for (const [field, view] of Object.entries(VIEW_LABELS)) {
      const url = await resolveDisplayUrl(null, character[field as keyof typeof VIEW_LABELS])
      pushReference(references, seenUrls, url
        ? { kind: view.kind, label: `角色：${character.name} ${view.label}`, url }
        : null)
    }
  }

  for (const location of project.locations) {
    const targetNames = location.assetKind === 'prop' ? propNames : locationNames
    if (!matchesAssetName(location.name, targetNames, contextText)) continue
    const selectedImage = location.selectedImage
      || location.images.find((image) => image.id === location.selectedImageId)
      || location.images[0]
      || null
    const url = selectedImage ? await resolveDisplayUrl(selectedImage.imageMediaId, selectedImage.imageUrl) : null
    pushReference(references, seenUrls, url
      ? {
          kind: location.assetKind === 'prop' ? 'prop' : 'location',
          label: `${location.assetKind === 'prop' ? '道具' : '场景'}：${location.name}`,
          url,
        }
      : null)
  }

  const prompt = buildPrompt({
    basePrompt: trimString(panel.firstLastFramePrompt) || trimString(panel.videoPrompt) || trimString(panel.imagePrompt),
    description: trimString(panel.description),
    shotType: trimString(panel.shotType),
    cameraMove: trimString(panel.cameraMove),
    location: trimString(panel.location),
    characters: trimString(panel.characters),
    duration: guidance.duration.recommendedSeconds,
    artStyle: trimString(project.artStyle),
    artStylePrompt: trimString(project.artStylePrompt),
    hasFirstFrame: !!firstFrameUrl,
    hasReferences: references.length > (firstFrameUrl ? 1 : 0),
  })
  const negative = '角色变脸，服装变化，发型变化，画风漂移，低清晰度，畸形手指，字幕，水印，文字。'
  const meta = {
    description: trimString(panel.description),
    shotType: trimString(panel.shotType),
    cameraMove: trimString(panel.cameraMove),
    location: trimString(panel.location),
    characters: trimString(panel.characters),
    props: trimString(panel.props),
  }

  return NextResponse.json({
    panelId: panel.id,
    panelNumber: panel.panelNumber,
    panelIndex: panel.panelIndex,
    episodeId: panel.storyboard.episode.id,
    episodeNumber: panel.storyboard.episode.episodeNumber,
    episodeName: panel.storyboard.episode.name,
    prompt,
    negative,
    references,
    packageText: buildPackageText({
      panelId: panel.id,
      panelNumber: panel.panelNumber,
      prompt,
      negative,
      references,
      guidance: guidanceText,
      meta,
    }),
    jimengUrl: JIMENG_WEBSITE_URL,
    guidance: {
      ...guidance,
      text: guidanceText,
    },
    meta,
  })
})

export const dynamic = 'force-dynamic'
