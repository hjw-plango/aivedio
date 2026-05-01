/**
 * Low-level MiMo TTS synthesis.
 *
 * Re-exports the core function from studio-tools so the standalone tool and
 * the first-class waoowaoo provider stay in sync.
 */

import {
  synthesizeMimoTTS as synthesizeMimoTTSCore,
  mimoBase64ToWavBuffer,
} from '@/lib/studio-tools/mimo-tts'
import type { MimoTTSInput, MimoTTSResult } from './types'

export const MIMO_DEFAULT_TTS_MODEL_ID = 'mimo-v2.5-tts'

/**
 * Synthesize text into a WAV buffer via the MiMo gateway.
 *
 * Returns { success, audioData, requestId } so the caller can choose to
 * upload to storage (preferred) or fall back to a data URL.
 */
export async function synthesizeWithMimoTTS(
  input: MimoTTSInput,
  apiKey: string,
): Promise<MimoTTSResult> {
  const text = input.text.trim()
  if (!text) {
    return { success: false, error: 'MIMO_TEXT_REQUIRED' }
  }
  if (!apiKey) {
    return { success: false, error: 'MIMO_API_KEY_REQUIRED' }
  }

  try {
    const core = await synthesizeMimoTTSCore({
      text,
      apiKey,
      baseUrl: input.baseUrl,
      model: input.modelId,
    })
    return {
      success: true,
      audioData: mimoBase64ToWavBuffer(core.audioBase64),
      requestId: core.audioId ?? undefined,
    }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'MIMO_TTS_FAILED',
    }
  }
}
