import type { GenerateResult } from '@/lib/generators/base'
import type { OpenAICompatImageRequest } from '../types'
import {
  buildRenderedTemplateRequest,
  buildTemplateVariables,
  extractTemplateError,
  normalizeResponseJson,
  readJsonPath,
} from '@/lib/openai-compat-template-runtime'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveOpenAICompatClientConfig } from './common'

const OPENAI_COMPAT_PROVIDER_PREFIX = 'openai-compatible:'
const PROVIDER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function encodeProviderToken(providerId: string): string {
  const value = providerId.trim()
  if (value.startsWith(OPENAI_COMPAT_PROVIDER_PREFIX)) {
    const uuid = value.slice(OPENAI_COMPAT_PROVIDER_PREFIX.length).trim()
    if (PROVIDER_UUID_PATTERN.test(uuid)) {
      return `u_${uuid.toLowerCase()}`
    }
  }
  return `b64_${Buffer.from(value, 'utf8').toString('base64url')}`
}

function encodeModelRef(modelRef: string): string {
  return Buffer.from(modelRef, 'utf8').toString('base64url')
}

function resolveModelRef(request: OpenAICompatImageRequest): string {
  const modelId = typeof request.modelId === 'string' ? request.modelId.trim() : ''
  if (modelId) return modelId
  const parsed = typeof request.modelKey === 'string' ? parseModelKeyStrict(request.modelKey) : null
  if (parsed?.modelId) return parsed.modelId
  throw new Error('OPENAI_COMPAT_IMAGE_MODEL_REF_REQUIRED')
}

/**
 * Build a short, redacted summary of an upstream image-API response when no
 * URL/base64 can be extracted. Lands in worker error message + DB tasks.errorMessage,
 * so future "OUTPUT_NOT_FOUND" failures self-diagnose without log mining.
 */
function summarizePayloadForError(payload: unknown): string {
  if (payload === null || payload === undefined) return 'payload=null'
  if (typeof payload !== 'object') {
    const s = String(payload)
    return `payload=${s.length > 120 ? `${s.slice(0, 120)}...<${s.length}>` : s}`
  }
  const root = payload as Record<string, unknown>
  const topKeys = Object.keys(root).join(',')
  const dataField = root.data
  let dataPart = ''
  if (Array.isArray(dataField)) {
    const first = dataField[0]
    if (first && typeof first === 'object') {
      dataPart = ` data[0]Keys=[${Object.keys(first as object).join(',')}]`
    } else {
      dataPart = ` data[]=${dataField.length}items first=${typeof first}`
    }
  }
  let errorPart = ''
  const errorField = root.error
  if (errorField !== undefined) {
    try {
      const errStr = JSON.stringify(errorField)
      errorPart = ` error=${errStr.length > 200 ? `${errStr.slice(0, 200)}...` : errStr}`
    } catch {
      errorPart = ' error=<unserializable>'
    }
  }
  let messagePart = ''
  const msgField = root.message
  if (typeof msgField === 'string' && msgField.length > 0) {
    messagePart = ` message=${msgField.slice(0, 160)}`
  }
  return `topKeys=[${topKeys}]${dataPart}${errorPart}${messagePart}`
}

function readTemplateOutputUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      urls.push(item.trim())
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const url = (item as { url?: unknown }).url
    if (typeof url === 'string' && url.trim()) {
      urls.push(url.trim())
    }
  }
  return urls
}

export async function generateImageViaOpenAICompatTemplate(
  request: OpenAICompatImageRequest,
): Promise<GenerateResult> {
  if (!request.template) {
    throw new Error('OPENAI_COMPAT_IMAGE_TEMPLATE_REQUIRED')
  }
  if (request.template.mediaType !== 'image') {
    throw new Error('OPENAI_COMPAT_IMAGE_TEMPLATE_MEDIA_TYPE_INVALID')
  }

  const config = await resolveOpenAICompatClientConfig(request.userId, request.providerId)
  const firstReference = Array.isArray(request.referenceImages) && request.referenceImages.length > 0
    ? request.referenceImages[0]
    : ''
  const variables = buildTemplateVariables({
    model: request.modelId || 'gpt-image-1',
    prompt: request.prompt,
    image: firstReference,
    images: request.referenceImages || [],
    aspectRatio: typeof request.options?.aspectRatio === 'string' ? request.options.aspectRatio : undefined,
    resolution: typeof request.options?.resolution === 'string' ? request.options.resolution : undefined,
    size: typeof request.options?.size === 'string' ? request.options.size : undefined,
    extra: request.options,
  })

  const createRequest = await buildRenderedTemplateRequest({
    baseUrl: config.baseUrl,
    endpoint: request.template.create,
    variables,
    defaultAuthHeader: `Bearer ${config.apiKey}`,
  })
  if (['POST', 'PUT', 'PATCH'].includes(createRequest.method) && !createRequest.body) {
    throw new Error('OPENAI_COMPAT_IMAGE_TEMPLATE_CREATE_BODY_REQUIRED')
  }
  const response = await fetch(createRequest.endpointUrl, {
    method: createRequest.method,
    headers: createRequest.headers,
    ...(createRequest.body ? { body: createRequest.body } : {}),
  })
  const rawText = await response.text().catch(() => '')
  const payload = normalizeResponseJson(rawText)
  if (!response.ok) {
    throw new Error(extractTemplateError(request.template, payload, response.status))
  }

  if (request.template.mode === 'sync') {
    const outputUrls = readTemplateOutputUrls(
      readJsonPath(payload, request.template.response.outputUrlsPath),
    )
    if (outputUrls.length > 0) {
      const first = outputUrls[0]
      return {
        success: true,
        imageUrl: first,
        ...(outputUrls.length > 1 ? { imageUrls: outputUrls } : {}),
      }
    }

    const outputUrl = readJsonPath(payload, request.template.response.outputUrlPath)
    if (typeof outputUrl === 'string' && outputUrl.trim().length > 0) {
      return {
        success: true,
        imageUrl: outputUrl.trim(),
      }
    }

    // GPT Image series (gpt-image-1/1.5/2) always returns base64, never URLs.
    // 1. Explicit outputBase64Path takes precedence.
    const explicitB64 = readJsonPath(payload, request.template.response.outputBase64Path)
    if (typeof explicitB64 === 'string' && explicitB64.trim().length > 0) {
      const base64 = explicitB64.trim()
      const mimeType = request.template.response.outputMimeType || 'image/png'
      return {
        success: true,
        imageBase64: base64,
        imageUrl: `data:${mimeType};base64,${base64}`,
      }
    }

    // 2. Convention-based fallback: when the user has not configured outputBase64Path
    // but the response carries OpenAI's standard `data[0].b64_json` (gpt-image-2 only
    // returns base64 — there is no `data[0].url` to read), recognize it. This keeps
    // existing legacy URL-only template configs working with gpt-image-2 / dalle-3
    // (b64_json mode) without forcing a UI edit.
    if (!request.template.response.outputBase64Path) {
      const conventionalB64 = readJsonPath(payload, '$.data[0].b64_json')
      if (typeof conventionalB64 === 'string' && conventionalB64.trim().length > 0) {
        const base64 = conventionalB64.trim()
        const mimeType = request.template.response.outputMimeType || 'image/png'
        return {
          success: true,
          imageBase64: base64,
          imageUrl: `data:${mimeType};base64,${base64}`,
        }
      }
    }

    throw new Error(`OPENAI_COMPAT_IMAGE_TEMPLATE_OUTPUT_NOT_FOUND: ${summarizePayloadForError(payload)}`)
  }

  const taskIdRaw = readJsonPath(payload, request.template.response.taskIdPath)
  const taskId = typeof taskIdRaw === 'string' ? taskIdRaw.trim() : ''
  if (!taskId) {
    throw new Error('OPENAI_COMPAT_IMAGE_TEMPLATE_TASK_ID_NOT_FOUND')
  }
  const providerToken = encodeProviderToken(config.providerId)
  const modelRefToken = encodeModelRef(resolveModelRef(request))
  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `OCOMPAT:IMAGE:${providerToken}:${modelRefToken}:${taskId}`,
  }
}
