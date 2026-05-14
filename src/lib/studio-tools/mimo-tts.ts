/**
 * MiMo TTS — 小米 MiMo 系列 TTS 模型的合成调用。
 *
 * 这是一个独立工具模块，不接入 waoowaoo 主 generator 体系。
 * 直接调用第三方 OpenAI 兼容网关（如 https://api.xiaomimimo.com/v1）。
 *
 * 网关把 TTS 包装成 chat completions：
 *   POST {baseUrl}/chat/completions
 *   { model, messages: [{role:'assistant', content: text}] }
 *   响应 message.audio.data 是 base64 WAV
 *
 * 已知模型：
 *   mimo-v2.5-tts                 基础 TTS
 *   mimo-v2.5-tts-voiceclone      声音克隆
 *   mimo-v2.5-tts-voicedesign     声音设计
 *   mimo-v2-tts                   旧版
 */

export type MimoModel =
  | 'mimo-v2.5-tts'
  | 'mimo-v2.5-tts-voiceclone'
  | 'mimo-v2.5-tts-voicedesign'
  | 'mimo-v2-tts'
  | string // allow forward-compat custom model ids

export interface MimoSynthesizeParams {
  text: string
  apiKey: string
  baseUrl?: string // default: https://api.xiaomimimo.com/v1
  model?: MimoModel // default: mimo-v2.5-tts
  stylePrompt?: string
  voice?: string
}

export interface MimoSynthesizeResult {
  /** Base64-encoded WAV audio (no data: prefix). */
  audioBase64: string
  /** Audio id from the gateway (for debugging / tracing). */
  audioId: string | null
  /** Model used. */
  model: string
  /** Token usage from the gateway response. */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  } | null
}

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
const DEFAULT_MODEL: MimoModel = 'mimo-v2.5-tts'

/**
 * Call MiMo TTS gateway and return the synthesized WAV as base64.
 *
 * Throws if the gateway returns an error or no audio.
 */
export async function synthesizeMimoTTS(
  params: MimoSynthesizeParams,
): Promise<MimoSynthesizeResult> {
  const text = params.text.trim()
  if (!text) {
    throw new Error('MIMO_TTS: text is required')
  }
  if (!params.apiKey) {
    throw new Error('MIMO_TTS: apiKey is required')
  }

  const baseUrl = (params.baseUrl?.replace(/\/+$/, '')) || DEFAULT_BASE_URL
  const model = params.model || DEFAULT_MODEL
  const url = `${baseUrl}/chat/completions`
  const stylePrompt = params.stylePrompt?.trim()
  const voice = params.voice?.trim() || 'mimo_default'
  const supportsBuiltInVoice = model === 'mimo-v2.5-tts' || model === 'mimo-v2-tts'

  const body = {
    model,
    messages: [
      ...(stylePrompt ? [{ role: 'user', content: stylePrompt }] : []),
      // MiMo TTS requires the target synthesis text in assistant.content.
      { role: 'assistant', content: text },
    ],
    audio: {
      format: 'wav',
      ...(supportsBuiltInVoice ? { voice } : {}),
    },
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`MIMO_TTS: HTTP ${resp.status} ${errText.slice(0, 500)}`)
  }

  const json = (await resp.json()) as MimoChatResponse

  if (json.error) {
    throw new Error(`MIMO_TTS: ${json.error.message || JSON.stringify(json.error)}`)
  }

  const choice = json.choices?.[0]
  const audio = choice?.message?.audio
  if (!audio?.data) {
    throw new Error('MIMO_TTS: response missing message.audio.data')
  }

  return {
    audioBase64: audio.data,
    audioId: audio.id || null,
    model: json.model || model,
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : null,
  }
}

/**
 * Decode a MiMo response into a Node Buffer.
 */
export function mimoBase64ToWavBuffer(audioBase64: string): Buffer {
  return Buffer.from(audioBase64, 'base64')
}

interface MimoChatResponse {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      role?: string
      content?: string
      audio?: {
        id?: string
        data?: string
        expires_at?: number | null
        transcript?: string | null
      }
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: {
    code?: string
    message?: string
    type?: string
    param?: string
  }
}
