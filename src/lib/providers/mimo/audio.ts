/**
 * MiMo audio generator — wires `synthesizeWithMimoTTS` into waoowaoo's
 * generator pipeline. Uploads the WAV to storage so the panel/voice subsystem
 * gets a fetchable URL just like bailian/siliconflow.
 */

import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { getProviderConfig } from '@/lib/api-config'
import { uploadObject, generateUniqueKey, getSignedUrl } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import type { GenerateResult } from '@/lib/generators/base'
import { ensureMimoCatalogRegistered } from './catalog'
import { synthesizeWithMimoTTS } from './tts'
import type { MimoGenerateRequestOptions } from './types'

export interface MimoAudioGenerateParams {
  userId: string
  text: string
  voice?: string
  rate?: number
  options: MimoGenerateRequestOptions
}

function assertRegistered(modelId: string): void {
  ensureMimoCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'mimo',
    modality: 'audio' satisfies OfficialModelModality,
    modelId,
  })
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function generateMimoAudio(params: MimoAudioGenerateParams): Promise<GenerateResult> {
  assertRegistered(params.options.modelId)
  const text = readTrimmedString(params.text)
  if (!text) {
    throw new Error('MIMO_TEXT_REQUIRED')
  }

  const { apiKey, baseUrl } = await getProviderConfig(params.userId, params.options.provider)
  const result = await synthesizeWithMimoTTS(
    {
      text,
      modelId: params.options.modelId,
      baseUrl: params.options.baseUrl || baseUrl,
    },
    apiKey,
  )

  if (!result.success || !result.audioData) {
    throw new Error(result.error || 'MIMO_AUDIO_SYNTHESIZE_FAILED')
  }

  // Upload to storage so the panel UI can stream/download.
  const storageKey = generateUniqueKey('audio/mimo', 'wav')
  let uploadedKey: string | null = null
  try {
    uploadedKey = await uploadObject(result.audioData, storageKey, 3, 'audio/wav')
  } catch (err) {
    // Fall back to data URL — caller will still get audio.
    void err
  }

  if (uploadedKey) {
    try {
      const media = await ensureMediaObjectFromStorageKey(uploadedKey, {
        mimeType: 'audio/wav',
        sizeBytes: result.audioData.length,
      })
      return {
        success: true,
        audioUrl: media.url,
        requestId: result.requestId,
      }
    } catch {
      // Fallback to signed URL if media object registration fails.
      return {
        success: true,
        audioUrl: getSignedUrl(uploadedKey),
        requestId: result.requestId,
      }
    }
  }

  // Last-resort: data URL.
  const dataUrl = `data:audio/wav;base64,${result.audioData.toString('base64')}`
  return {
    success: true,
    audioUrl: dataUrl,
    requestId: result.requestId,
  }
}
