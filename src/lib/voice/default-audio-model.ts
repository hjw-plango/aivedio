import { composeModelKey } from '@/lib/model-config-contract'
import { prisma } from '@/lib/prisma'

const MIMO_DEFAULT_TTS_MODEL_IDS = [
  'mimo-v2.5-tts',
  'mimo-v2-tts',
] as const

const MIMO_EXPLICIT_TTS_MODEL_IDS = [
  'mimo-v2.5-tts',
  'mimo-v2-tts',
  'mimo-v2.5-tts-voicedesign',
  'mimo-v2.5-tts-voiceclone',
] as const

const MIMO_VOICE_DESIGN_MODEL_IDS = [
  'mimo-v2.5-tts-voicedesign',
  'mimo-v2.5-tts',
  'mimo-v2-tts',
  'mimo-v2.5-tts-voiceclone',
] as const

interface StoredModelLike {
  modelId?: unknown
  modelKey?: unknown
  provider?: unknown
  type?: unknown
}

interface StoredProviderLike {
  id?: unknown
  apiKey?: unknown
}

export interface StoredAudioConfigSource {
  audioModel?: string | null
  voiceDesignModel?: string | null
  customModels?: string | null
  customProviders?: string | null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getProviderKey(providerId: string): string {
  const index = providerId.indexOf(':')
  return index === -1 ? providerId : providerId.slice(0, index)
}

function parseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function hasProviderApiKey(provider: StoredProviderLike): boolean {
  return readTrimmedString(provider.apiKey).length > 0
}

function hasConfiguredProvider(
  providers: StoredProviderLike[],
  providerId: string,
): boolean {
  const providerKey = getProviderKey(providerId)
  const exact = providers.find((provider) => readTrimmedString(provider.id) === providerId)
  if (exact) return hasProviderApiKey(exact)

  const sameKeyProviders = providers.filter((provider) => getProviderKey(readTrimmedString(provider.id)) === providerKey)
  return sameKeyProviders.some(hasProviderApiKey)
}

function readModelProvider(model: StoredModelLike): string {
  const provider = readTrimmedString(model.provider)
  if (provider) return provider

  const modelKey = readTrimmedString(model.modelKey)
  const markerIndex = modelKey.indexOf('::')
  return markerIndex === -1 ? '' : modelKey.slice(0, markerIndex).trim()
}

function readModelId(model: StoredModelLike): string {
  const modelId = readTrimmedString(model.modelId)
  if (modelId) return modelId

  const modelKey = readTrimmedString(model.modelKey)
  const markerIndex = modelKey.indexOf('::')
  return markerIndex === -1 ? '' : modelKey.slice(markerIndex + 2).trim()
}

function parseStoredModelKey(value: unknown): { provider: string; modelId: string } | null {
  const modelKey = readTrimmedString(value)
  const markerIndex = modelKey.indexOf('::')
  if (markerIndex === -1) return null

  const provider = modelKey.slice(0, markerIndex).trim()
  const modelId = modelKey.slice(markerIndex + 2).trim()
  return provider && modelId ? { provider, modelId } : null
}

function allowsMimoModelId(modelId: string, allowedModelIds: readonly string[]) {
  const normalized = modelId.toLowerCase()
  return allowedModelIds.includes(modelId)
    || (normalized.startsWith('mimo-') && normalized.includes('tts'))
}

function findConfiguredModelCandidate(
  models: StoredModelLike[],
  providers: StoredProviderLike[],
  modelKey: string | null | undefined,
  allowedModelIds: readonly string[],
) {
  const parsed = parseStoredModelKey(modelKey)
  if (!parsed) return null
  if (getProviderKey(parsed.provider).toLowerCase() !== 'mimo') return null
  if (!allowsMimoModelId(parsed.modelId, allowedModelIds)) return null
  if (!hasConfiguredProvider(providers, parsed.provider)) return null

  const matched = models.find((model) => (
    model.type === 'audio'
    && readModelProvider(model) === parsed.provider
    && readModelId(model) === parsed.modelId
  ))
  if (!matched) return null

  return { provider: parsed.provider, modelId: parsed.modelId }
}

function pickConfiguredMimoModel(
  source: StoredAudioConfigSource | null | undefined,
  allowedModelIds: readonly string[],
  explicitModelKey?: string | null,
  options?: { explicitOnly?: boolean },
): string | null {
  const models = parseArray<StoredModelLike>(source?.customModels)
  const providers = parseArray<StoredProviderLike>(source?.customProviders)
  const explicit = findConfiguredModelCandidate(models, providers, explicitModelKey, allowedModelIds)
  if (explicit) return composeModelKey(explicit.provider, explicit.modelId)
  if (options?.explicitOnly) return null

  const candidates = models
    .filter((model) => model.type === 'audio')
    .map((model) => {
      const provider = readModelProvider(model)
      const modelId = readModelId(model)
      return { provider, modelId }
    })
    .filter((model) => (
      getProviderKey(model.provider).toLowerCase() === 'mimo'
      && allowedModelIds.includes(model.modelId)
      && hasConfiguredProvider(providers, model.provider)
    ))
    .sort((a, b) => (
      allowedModelIds.indexOf(a.modelId)
      - allowedModelIds.indexOf(b.modelId)
    ))

  const picked = candidates[0]
  return picked ? composeModelKey(picked.provider, picked.modelId) : null
}

export function pickConfiguredMimoTtsModel(source: StoredAudioConfigSource | null | undefined): string | null {
  return pickConfiguredMimoModel(source, MIMO_EXPLICIT_TTS_MODEL_IDS, source?.audioModel, { explicitOnly: true })
    || pickConfiguredMimoModel(source, MIMO_DEFAULT_TTS_MODEL_IDS)
}

export function pickConfiguredMimoVoiceDesignModel(source: StoredAudioConfigSource | null | undefined): string | null {
  return pickConfiguredMimoModel(source, MIMO_VOICE_DESIGN_MODEL_IDS, source?.voiceDesignModel, { explicitOnly: true })
    || pickConfiguredMimoModel(source, MIMO_VOICE_DESIGN_MODEL_IDS)
    || pickConfiguredMimoModel(source, MIMO_EXPLICIT_TTS_MODEL_IDS, source?.audioModel, { explicitOnly: true })
    || pickConfiguredMimoModel(source, MIMO_DEFAULT_TTS_MODEL_IDS)
}

export async function resolveConfiguredMimoTtsModel(userId: string): Promise<string | null> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customModels: true,
      customProviders: true,
    },
  })
  return pickConfiguredMimoTtsModel(preference)
}
