export type VideoDurationGuidanceBucket = 'default' | 'short' | 'standard' | 'long'
export type FirstLastFrameGuidanceStatus = 'recommended' | 'optional' | 'notRecommended' | 'unavailable'

export type FirstLastFrameGuidanceReason =
  | 'lastPanel'
  | 'missingFrame'
  | 'sceneChange'
  | 'characterChange'
  | 'continuousMotion'
  | 'sameSceneCharacter'
  | 'sameScene'
  | 'insufficientContinuity'

export interface VideoGuidancePanelInput {
  imageUrl?: string | null
  duration?: number | null
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  characters?: unknown
  location?: string | null
  textPanel?: {
    duration?: number | null
    shot_type?: string | null
    camera_move?: string | null
    description?: string | null
    characters?: unknown
    location?: string | null
  } | null
}

export interface VideoDurationGuidance {
  sourceSeconds: number | null
  recommendedSeconds: number
  bucket: VideoDurationGuidanceBucket
  isEstimated: boolean
}

export interface FirstLastFrameGuidance {
  status: FirstLastFrameGuidanceStatus
  reason: FirstLastFrameGuidanceReason
  canLink: boolean
  score: number
}

export interface VideoPanelGuidance {
  duration: VideoDurationGuidance
  firstLastFrame: FirstLastFrameGuidance
}

export type VideoDurationOptionValue = string | number | boolean

interface NormalizedPanel {
  imageUrl: string
  duration: number | null
  shotType: string
  cameraMove: string
  description: string
  location: string
  characters: string[]
}

const CONTINUOUS_MOTION_RE = /(推进|推近|缓推|拉远|跟随|跟拍|平移|环绕|移动|走向|靠近|远离|转身|抬头|低头|回头|起身|坐下|伸手|看向|穿过|走过|连续|延续|过渡|慢慢|缓缓|push|dolly|track|follow|pan|orbit|move|walk|turn|look|raise|continuous|transition)/i

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。,.、；;：:\s"'“”‘’（）()【】\[\]{}<>]/g, '')
}

function splitTextList(value: string): string[] {
  return value
    .split(/[,\uFF0C\u3001;\uFF1B\n\r/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeCharacters(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'name' in item) {
          return trimString((item as { name?: unknown }).name)
        }
        return ''
      })
      .map(normalizeToken)
      .filter(Boolean)
  }

  const raw = trimString(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return normalizeCharacters(parsed)
  } catch {
    // Plain text is common for manually edited panels.
  }

  return splitTextList(raw).map(normalizeToken).filter(Boolean)
}

function normalizePanel(panel: VideoGuidancePanelInput | null | undefined): NormalizedPanel | null {
  if (!panel) return null
  const textPanel = panel.textPanel ?? null
  return {
    imageUrl: trimString(panel.imageUrl),
    duration: readPositiveNumber(textPanel?.duration ?? panel.duration),
    shotType: trimString(textPanel?.shot_type ?? panel.shotType),
    cameraMove: trimString(textPanel?.camera_move ?? panel.cameraMove),
    description: trimString(textPanel?.description ?? panel.description),
    location: trimString(textPanel?.location ?? panel.location),
    characters: normalizeCharacters(textPanel?.characters ?? panel.characters),
  }
}

function locationsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeToken(left)
  const normalizedRight = normalizeToken(right)
  if (!normalizedLeft || !normalizedRight) return false
  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
}

function hasCharacterOverlap(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  return left.some((leftName) => right.some((rightName) => (
    leftName === rightName
    || leftName.includes(rightName)
    || rightName.includes(leftName)
  )))
}

function roundToHalfSecond(value: number): number {
  return Math.round(value * 2) / 2
}

function normalizeRecommendedSeconds(value: number): number {
  if (value <= 1.25) return 1
  if (value <= 1.75) return 1.5
  if (value <= 2.25) return 2
  if (value <= 2.75) return 2.5
  if (value <= 3.5) return 3
  if (value <= 4.5) return 4
  if (value <= 6) return 5
  if (value <= 8) return 8
  return 10
}

function inferDurationSeconds(panel: NormalizedPanel | null): number {
  if (!panel) return 2
  const text = [
    panel.shotType,
    panel.cameraMove,
    panel.description,
  ].join('\n')

  if (/(极端特写|特写|眼神|瞳孔|手部|物品|道具|反应|一闪|瞬间|瞥|抬眼|点头|低头|回头|皱眉|微笑|手指)/i.test(text)) {
    return 1.5
  }

  if (/(开口|正在说话|说话|对话|回答|询问|质问|解释|念出|喊出)/i.test(text)) {
    return 2.5
  }

  if (/(走向|走进|走出|穿过|经过|推门|起身|坐下|转身|靠近|离开|跟随|跟拍|缓推|推进|环绕|慢慢|缓缓)/i.test(text)) {
    return 3
  }

  if (/(大远景|远景|全景|建立|俯拍|升起|城市|街道|战场|人群|环境)/i.test(text)) {
    return 3.5
  }

  return 2
}

function bucketForDuration(seconds: number, isEstimated: boolean): VideoDurationGuidanceBucket {
  if (isEstimated) return 'default'
  if (seconds < 2.5) return 'short'
  if (seconds > 5) return 'long'
  return 'standard'
}

function shouldCorrectOverlongSourceDuration(panel: NormalizedPanel | null, sourceSeconds: number, inferredSeconds: number): boolean {
  if (!panel || sourceSeconds < 4.5 || inferredSeconds > 2.5) return false
  const text = [
    panel.shotType,
    panel.cameraMove,
    panel.description,
  ].join('\n')
  return /(极端特写|特写|眼神|瞳孔|手部|物品|道具|反应|一闪|瞬间|瞥|抬眼|点头|低头|回头|皱眉|微笑|手指|放下|拿起)/i.test(text)
}

function buildDurationGuidance(panel: NormalizedPanel | null): VideoDurationGuidance {
  const duration = panel?.duration ?? null
  if (!duration) {
    const estimatedSeconds = roundToHalfSecond(inferDurationSeconds(panel))
    return {
      sourceSeconds: null,
      recommendedSeconds: normalizeRecommendedSeconds(estimatedSeconds),
      bucket: 'default',
      isEstimated: true,
    }
  }

  const inferredSeconds = roundToHalfSecond(inferDurationSeconds(panel))
  const recommendedSeconds = shouldCorrectOverlongSourceDuration(panel, duration, inferredSeconds)
    ? normalizeRecommendedSeconds(inferredSeconds)
    : normalizeRecommendedSeconds(duration)

  return {
    sourceSeconds: duration,
    recommendedSeconds,
    bucket: bucketForDuration(recommendedSeconds, false),
    isEstimated: false,
  }
}

function buildFirstLastFrameGuidance(
  current: NormalizedPanel,
  next: NormalizedPanel | null,
): FirstLastFrameGuidance {
  if (!next) {
    return {
      status: 'notRecommended',
      reason: 'lastPanel',
      canLink: false,
      score: 0,
    }
  }

  if (!current.imageUrl || !next.imageUrl) {
    return {
      status: 'unavailable',
      reason: 'missingFrame',
      canLink: false,
      score: 0,
    }
  }

  const hasBothLocations = !!current.location && !!next.location
  const sameScene = hasBothLocations && locationsMatch(current.location, next.location)
  if (hasBothLocations && !sameScene) {
    return {
      status: 'notRecommended',
      reason: 'sceneChange',
      canLink: true,
      score: 1,
    }
  }

  const hasBothCharacters = current.characters.length > 0 && next.characters.length > 0
  const sameCharacter = hasCharacterOverlap(current.characters, next.characters)
  if (hasBothCharacters && !sameCharacter) {
    return {
      status: 'notRecommended',
      reason: 'characterChange',
      canLink: true,
      score: 1,
    }
  }

  const motionText = [
    current.cameraMove,
    current.description,
    next.cameraMove,
    next.description,
  ].join('\n')
  const hasContinuousMotion = CONTINUOUS_MOTION_RE.test(motionText)

  if (hasContinuousMotion && (sameScene || sameCharacter)) {
    return {
      status: 'recommended',
      reason: 'continuousMotion',
      canLink: true,
      score: 3,
    }
  }

  if (sameScene && sameCharacter) {
    return {
      status: 'optional',
      reason: 'sameSceneCharacter',
      canLink: true,
      score: 2,
    }
  }

  if (sameScene || sameCharacter) {
    return {
      status: 'optional',
      reason: 'sameScene',
      canLink: true,
      score: 2,
    }
  }

  return {
    status: 'notRecommended',
    reason: 'insufficientContinuity',
    canLink: true,
    score: 1,
  }
}

export function buildVideoPanelGuidance(input: {
  panel: VideoGuidancePanelInput
  nextPanel?: VideoGuidancePanelInput | null
}): VideoPanelGuidance {
  const current = normalizePanel(input.panel)
  const next = normalizePanel(input.nextPanel)
  const duration = buildDurationGuidance(current)

  return {
    duration,
    firstLastFrame: current
      ? buildFirstLastFrameGuidance(current, next)
      : {
          status: 'unavailable',
          reason: 'missingFrame',
          canLink: false,
          score: 0,
    },
  }
}

export function pickNearestVideoDurationOption(
  recommendedSeconds: number,
  options: readonly VideoDurationOptionValue[] | null | undefined,
): number | null {
  if (!Number.isFinite(recommendedSeconds) || recommendedSeconds <= 0) return null
  const durations = (options || [])
    .filter((option): option is number => typeof option === 'number' && Number.isFinite(option) && option > 0)
    .slice()
    .sort((left, right) => left - right)
  if (durations.length === 0) return null

  const exact = durations.find((duration) => Math.abs(duration - recommendedSeconds) < 0.001)
  if (exact !== undefined) return exact

  const upper = durations.find((duration) => duration >= recommendedSeconds)
  if (upper !== undefined) return upper

  return durations[durations.length - 1] ?? null
}

export function applyRecommendedVideoDurationOption(input: {
  generationOptions: Record<string, VideoDurationOptionValue> | null | undefined
  durationOptions: readonly VideoDurationOptionValue[] | null | undefined
  guidance: VideoPanelGuidance
}): Record<string, VideoDurationOptionValue> {
  const duration = pickNearestVideoDurationOption(
    input.guidance.duration.recommendedSeconds,
    input.durationOptions,
  )
  if (duration === null) return { ...(input.generationOptions || {}) }
  return {
    ...(input.generationOptions || {}),
    duration,
  }
}
