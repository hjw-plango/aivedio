import { beforeEach, describe, expect, it, vi } from 'vitest'
import { synthesizeMimoTTS } from '@/lib/studio-tools/mimo-tts'

const fetchMock = vi.hoisted(() => vi.fn())

describe('MiMo TTS studio client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      model: 'mimo-v2.5-tts',
      choices: [
        {
          message: {
            audio: {
              id: 'audio-1',
              data: Buffer.from('wav').toString('base64'),
            },
          },
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    }), { status: 200 }))
  })

  it('uses the current MiMo v2.5 chat audio request shape', async () => {
    const result = await synthesizeMimoTTS({
      text: 'hello',
      stylePrompt: 'calm voice',
      apiKey: 'mimo-key',
      model: 'mimo-v2.5-tts',
      voice: 'Chloe',
    })

    expect(result.audioId).toBe('audio-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'api-key': 'mimo-key',
      Authorization: 'Bearer mimo-key',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: 'calm voice' },
        { role: 'assistant', content: 'hello' },
      ],
      audio: {
        format: 'wav',
        voice: 'Chloe',
      },
    })
  })
})
