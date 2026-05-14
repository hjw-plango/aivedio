import { composeModelKey } from '@/lib/model-config-contract'
import { prisma } from '@/lib/prisma'

const MIMO_DEFAULT_TTS_MODEL_IDS = [
  'mimo-v2.5-tts',
  'mimo-v2-tts',
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

export function pickConfiguredMimoTtsModel(source: StoredAudioConfigSource | null | undefined): string | null {
  const models = parseArray<StoredModelLike>(source?.customModels)
  const providers = parseArray<StoredProviderLike>(source?.customProviders)

  const candidates = models
    .filter((model) => model.type === 'audio')
    .map((model) => {
      const provider = readModelProvider(model)
      const modelId = readModelId(model)
      return { provider, modelId }
    })
    .filter((model) => (
      getProviderKey(model.provider).toLowerCase() === 'mimo'
      && (MIMO_DEFAULT_TTS_MODEL_IDS as readonly string[]).includes(model.modelId)
      && hasConfiguredProvider(providers, model.provider)
    ))
    .sort((a, b) => (
      MIMO_DEFAULT_TTS_MODEL_IDS.indexOf(a.modelId as typeof MIMO_DEFAULT_TTS_MODEL_IDS[number])
      - MIMO_DEFAULT_TTS_MODEL_IDS.indexOf(b.modelId as typeof MIMO_DEFAULT_TTS_MODEL_IDS[number])
    ))

  const picked = candidates[0]
  return picked ? composeModelKey(picked.provider, picked.modelId) : null
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
