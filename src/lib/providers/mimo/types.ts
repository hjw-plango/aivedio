export interface MimoGenerateRequestOptions {
  /** Provider id from the user-configured provider list (e.g. "mimo"). */
  provider: string
  /** Model id, e.g. "mimo-v2.5-tts". */
  modelId: string
  /** Optional model key in `provider::modelId` form. */
  modelKey?: string
  /** Optional override base URL (default: https://api.xiaomimimo.com/v1). */
  baseUrl?: string
}

export interface MimoTTSInput {
  text: string
  modelId: string
  /** Optional baseUrl override. */
  baseUrl?: string
}

export interface MimoTTSResult {
  success: boolean
  /** Optional uploaded URL (data URL fallback if missing). */
  audioUrl?: string
  /** Decoded WAV bytes. */
  audioData?: Buffer
  /** Gateway-side audio id (for tracing). */
  requestId?: string
  error?: string
}
