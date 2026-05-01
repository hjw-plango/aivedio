import { NextRequest, NextResponse } from 'next/server'
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
 *   {
 *     audioBase64: string,  // raw base64 WAV (no data: prefix)
 *     audioId: string|null,
 *     model: string,
 *     usage: {...}|null
 *   }
 *
 * Response 4xx/5xx:
 *   { error: string }
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

export async function POST(req: NextRequest) {
  let body: MimoBody
  try {
    body = (await req.json()) as MimoBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = asString(body.text)
  const apiKey = asString(body.apiKey)
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
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
    const status = message.includes('HTTP 4') ? 502 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
