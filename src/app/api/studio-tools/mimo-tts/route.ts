import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { synthesizeMimoTTS } from '@/lib/studio-tools/mimo-tts'

/**
 * POST /api/studio-tools/mimo-tts
 *
 * Body:
 *   {
 *     text: string,        // required
 *     apiKey: string,      // required (passed through, never stored)
 *     baseUrl?: string,    // default https://api.xiaomimimo.com/v1
 *     model?: string       // default mimo-v2.5-tts
 *   }
 *
 * Response 200:
 *   { audioBase64, audioId, model, usage }
 *
 * Auth: requires user session; the API key in the body belongs to the user
 * and is forwarded to the MiMo gateway without persisting on our side.
 */

interface MimoBody {
  text?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  model?: unknown
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth

  let body: MimoBody
  try {
    body = (await req.json()) as MimoBody
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  const text = asString(body.text)
  const apiKey = asString(body.apiKey)
  if (!text) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!apiKey) {
    throw new ApiError('INVALID_PARAMS')
  }

  try {
    const result = await synthesizeMimoTTS({
      text,
      apiKey,
      baseUrl: asString(body.baseUrl),
      model: asString(body.model),
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
})
