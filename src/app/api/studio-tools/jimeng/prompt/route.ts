import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import {
  composeJimengPrompt,
  JIMENG_WEBSITE_URL,
  type JimengPromptInput,
} from '@/lib/studio-tools/jimeng-prompt'

/**
 * POST /api/studio-tools/jimeng/prompt
 *
 * Body: JimengPromptInput
 * Response 200: JimengPromptOutput + { jimengUrl }
 *
 * Auth: user session required (so the prompt builder is gated by the same
 * login as the rest of the workspace).
 */

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function asDuration(v: unknown): 5 | 10 | undefined {
  if (v === 5 || v === '5') return 5
  if (v === 10 || v === '10') return 10
  return undefined
}

export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  const subject = asString(body.subject)
  if (!subject) {
    throw new ApiError('INVALID_PARAMS')
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

  const result = composeJimengPrompt(input)
  return NextResponse.json({ ...result, jimengUrl: JIMENG_WEBSITE_URL })
})
