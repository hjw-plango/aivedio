import { NextRequest, NextResponse } from 'next/server'
import { composeJimengPrompt, JIMENG_WEBSITE_URL, type JimengPromptInput } from '@/lib/studio-tools/jimeng-prompt'

/**
 * POST /api/studio-tools/jimeng/prompt
 *
 * Body: JimengPromptInput
 * Response 200: JimengPromptOutput + { jimengUrl }
 */

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function asDuration(v: unknown): 5 | 10 | undefined {
  if (v === 5 || v === '5') return 5
  if (v === 10 || v === '10') return 10
  return undefined
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const subject = asString(body.subject)
  if (!subject) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 })
  }

  const input: JimengPromptInput = {
    subject,
    action: asString(body.action),
    cameraLanguage: asString(body.cameraLanguage),
    lighting: asString(body.lighting),
    style: asString(body.style),
    durationSec: asDuration(body.durationSec),
    extra: asString(body.extra),
    negative: asString(body.negative),
  }

  try {
    const result = composeJimengPrompt(input)
    return NextResponse.json({ ...result, jimengUrl: JIMENG_WEBSITE_URL })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
