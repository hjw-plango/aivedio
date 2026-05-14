export type VideoPromptGenerationMode = 'normal' | 'firstlastframe'

export interface VideoPromptPanelInput {
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  location?: string | null
  characters?: unknown
  props?: string | null
  srtSegment?: string | null
  duration?: number | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  photographyRules?: string | null
  actingNotes?: string | null
}

const MAX_PROMPT_LENGTH = 1500
const MAX_SEGMENT_LENGTH = 260

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactText(value: unknown, maxLength = MAX_SEGMENT_LENGTH): string {
  const text = trimString(value)
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const raw = value.trim()
  if (!raw) return null
  if (!raw.startsWith('{') && !raw.startsWith('[')) return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function summarizeCharacters(value: unknown): string {
  const parsed = parseJsonValue(value)
  if (Array.isArray(parsed)) {
    const items = parsed
      .map((item) => {
        if (typeof item === 'string') return compactText(item, 80)
        if (!isRecord(item)) return ''
        const name = compactText(item.name, 40)
        const appearance = compactText(item.appearance, 80)
        const slot = compactText(item.slot, 80)
        return [name, appearance, slot ? `位置:${slot}` : ''].filter(Boolean).join('，')
      })
      .filter(Boolean)
      .slice(0, 4)
    return compactText(items.join('；'), 320)
  }
  return compactText(parsed, 260)
}

function summarizeProps(value: unknown): string {
  const parsed = parseJsonValue(value)
  if (Array.isArray(parsed)) {
    return compactText(parsed.map((item) => {
      if (typeof item === 'string') return item
      if (isRecord(item)) return [item.name, item.description].map(trimString).filter(Boolean).join('，')
      return ''
    }).filter(Boolean).join('；'), 220)
  }
  return compactText(parsed, 220)
}

function summarizePhotographyRules(value: unknown): string {
  const parsed = parseJsonValue(value)
  if (!parsed) return ''
  if (typeof parsed === 'string') return compactText(parsed, 280)

  const source = Array.isArray(parsed) ? parsed[0] : parsed
  if (!isRecord(source)) return compactText(JSON.stringify(parsed), 280)

  const lighting = isRecord(source.lighting)
    ? [source.lighting.direction, source.lighting.quality].map(trimString).filter(Boolean).join('，')
    : ''
  const characterPositions = Array.isArray(source.characters)
    ? source.characters
      .map((item) => {
        if (!isRecord(item)) return ''
        const name = trimString(item.name)
        const position = [item.screen_position, item.posture, item.facing].map(trimString).filter(Boolean).join('，')
        return [name, position].filter(Boolean).join(':')
      })
      .filter(Boolean)
      .slice(0, 3)
      .join('；')
    : ''

  return compactText([
    lighting ? `光线:${lighting}` : '',
    trimString(source.depth_of_field) ? `景深:${trimString(source.depth_of_field)}` : '',
    trimString(source.color_tone) ? `色调:${trimString(source.color_tone)}` : '',
    characterPositions ? `构图:${characterPositions}` : '',
  ].filter(Boolean).join('；'), 360)
}

function summarizeActingNotes(value: unknown): string {
  const parsed = parseJsonValue(value)
  if (!parsed) return ''
  const source = isRecord(parsed) && Array.isArray(parsed.characters) ? parsed.characters : parsed
  if (Array.isArray(source)) {
    return compactText(source
      .map((item) => {
        if (typeof item === 'string') return item
        if (!isRecord(item)) return ''
        const name = trimString(item.name)
        const acting = trimString(item.acting)
        return [name, acting].filter(Boolean).join(':')
      })
      .filter(Boolean)
      .slice(0, 4)
      .join('；'), 360)
  }
  return compactText(source, 280)
}

function pushSegment(segments: string[], label: string, value: string) {
  const text = compactText(value)
  if (!text) return
  segments.push(label ? `${label}: ${text}` : text)
}

function joinPromptSegments(segments: string[]): string {
  const seen = new Set<string>()
  const uniqueSegments: string[] = []
  for (const segment of segments) {
    const normalized = segment.replace(/\s+/g, '').toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    uniqueSegments.push(segment)
  }

  let output = ''
  for (const segment of uniqueSegments) {
    const next = output ? `${output}\n${segment}` : segment
    if (next.length > MAX_PROMPT_LENGTH) break
    output = next
  }
  return output || uniqueSegments.join('\n').slice(0, MAX_PROMPT_LENGTH)
}

export function buildPanelVideoGenerationPrompt(input: {
  panel: VideoPromptPanelInput
  lastPanel?: VideoPromptPanelInput | null
  basePrompt: string
  mode: VideoPromptGenerationMode
}): string {
  const { panel, lastPanel, mode } = input
  const basePrompt = compactText(input.basePrompt || panel.videoPrompt || panel.description, 520)
  const segments: string[] = []

  pushSegment(segments, '', basePrompt)
  pushSegment(segments, '镜头设计', [
    compactText(panel.shotType, 80),
    compactText(panel.cameraMove, 80),
  ].filter(Boolean).join('，'))
  pushSegment(segments, '核心动作', panel.description || '')
  pushSegment(segments, '场景', panel.location || '')
  pushSegment(segments, '角色保持', summarizeCharacters(panel.characters))
  pushSegment(segments, '关键道具', summarizeProps(panel.props))
  pushSegment(segments, '摄影质感', summarizePhotographyRules(panel.photographyRules))
  pushSegment(segments, '表演细节', summarizeActingNotes(panel.actingNotes))
  pushSegment(segments, '首帧视觉约束', panel.imagePrompt || '')
  if (typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0) {
    pushSegment(segments, '节奏', `约${Math.round(panel.duration * 10) / 10}秒，动作自然连续，不要突然跳切`)
  }
  pushSegment(segments, '对白依据', panel.srtSegment || '')

  if (mode === 'firstlastframe') {
    pushSegment(segments, '首尾帧目标', '从首帧自然运动到尾帧，主体身份、服装、场景和光线保持连续，不要变脸、变装、换场景或新增无关人物')
    if (lastPanel) {
      pushSegment(segments, '尾帧动作目标', lastPanel.videoPrompt || lastPanel.description || lastPanel.imagePrompt || '')
      pushSegment(segments, '尾帧场景', lastPanel.location || '')
    }
  } else {
    pushSegment(segments, '生成约束', '严格保持首帧角色外观、服装、场景、构图和光线一致；画面要有细微身体动作或镜头运动，避免静帧、漂移、变脸和新增人物')
  }

  return joinPromptSegments(segments)
}
