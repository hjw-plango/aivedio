import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveConfigMock = vi.hoisted(() => vi.fn(async () => ({
  providerId: 'openai-compatible:test-provider',
  baseUrl: 'https://compat.example.com/v1',
  apiKey: 'sk-test',
})))

vi.mock('@/lib/model-gateway/openai-compat/common', () => ({
  resolveOpenAICompatClientConfig: resolveConfigMock,
}))

import { generateImageViaOpenAICompatTemplate } from '@/lib/model-gateway/openai-compat/template-image'

describe('openai-compat template image base64 (gpt-image-2 path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps b64_json into a data URL when outputBase64Path is configured', async () => {
    const fakeB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      created: 1778143778,
      data: [{ b64_json: fakeB64, revised_prompt: 'a cat' }],
      output_format: 'png',
    }), { status: 200 })) as unknown as typeof fetch

    const result = await generateImageViaOpenAICompatTemplate({
      userId: 'user-1',
      providerId: 'openai-compatible:test-provider',
      modelId: 'gpt-image-2',
      modelKey: 'openai-compatible:test-provider::gpt-image-2',
      prompt: 'draw a cat',
      profile: 'openai-compatible',
      template: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: {
          method: 'POST',
          path: '/images/generations',
          contentType: 'application/json',
          bodyTemplate: {
            model: '{{model}}',
            prompt: '{{prompt}}',
            size: '1024x1024',
          },
        },
        response: {
          outputBase64Path: '$.data[0].b64_json',
          outputMimeType: 'image/png',
        },
      },
    })

    expect(result).toEqual({
      success: true,
      imageBase64: fakeB64,
      imageUrl: `data:image/png;base64,${fakeB64}`,
    })
  })

  it('defaults outputMimeType to image/png when omitted', async () => {
    const fakeB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: fakeB64 }],
    }), { status: 200 })) as unknown as typeof fetch

    const result = await generateImageViaOpenAICompatTemplate({
      userId: 'user-1',
      providerId: 'openai-compatible:test-provider',
      modelId: 'gpt-image-2',
      modelKey: 'openai-compatible:test-provider::gpt-image-2',
      prompt: 'a dog',
      profile: 'openai-compatible',
      template: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: {
          method: 'POST',
          path: '/images/generations',
          contentType: 'application/json',
          bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}' },
        },
        response: {
          outputBase64Path: '$.data[0].b64_json',
        },
      },
    })

    expect(result).toMatchObject({
      success: true,
      imageBase64: fakeB64,
      imageUrl: `data:image/png;base64,${fakeB64}`,
    })
  })

  it('still throws OUTPUT_NOT_FOUND when neither url nor base64 fields resolve', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: '' }],
    }), { status: 200 })) as unknown as typeof fetch

    await expect(generateImageViaOpenAICompatTemplate({
      userId: 'user-1',
      providerId: 'openai-compatible:test-provider',
      modelId: 'gpt-image-2',
      modelKey: 'openai-compatible:test-provider::gpt-image-2',
      prompt: 'fox',
      profile: 'openai-compatible',
      template: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: {
          method: 'POST',
          path: '/images/generations',
          contentType: 'application/json',
          bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}' },
        },
        response: {
          outputBase64Path: '$.data[0].b64_json',
        },
      },
    })).rejects.toThrow('OPENAI_COMPAT_IMAGE_TEMPLATE_OUTPUT_NOT_FOUND')
  })

  it('falls back to $.data[0].b64_json when only legacy URL paths are configured (gpt-image-2 with old template)', async () => {
    // Legacy template configured with outputUrlPath/outputUrlsPath only.
    // gpt-image-2 returns no URL — only b64_json. Code should recognize OpenAI's
    // standard path even without explicit outputBase64Path.
    const fakeB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: fakeB64 }],
    }), { status: 200 })) as unknown as typeof fetch

    const result = await generateImageViaOpenAICompatTemplate({
      userId: 'user-1',
      providerId: 'openai-compatible:test-provider',
      modelId: 'gpt-image-2',
      modelKey: 'openai-compatible:test-provider::gpt-image-2',
      prompt: 'cat',
      profile: 'openai-compatible',
      template: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: {
          method: 'POST',
          path: '/images/generations',
          contentType: 'application/json',
          bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}' },
        },
        response: {
          // Legacy config — only URL paths, no outputBase64Path.
          outputUrlPath: '$.data[0].url',
          outputUrlsPath: '$.data',
          errorPath: '$.error.message',
        },
      },
    })

    expect(result).toMatchObject({
      success: true,
      imageBase64: fakeB64,
      imageUrl: `data:image/png;base64,${fakeB64}`,
    })
  })

  it('does NOT fall back when outputBase64Path IS configured but resolves empty (respects explicit config)', async () => {
    // If user explicitly configured a base64 path that doesn't match, don't silently
    // fall back to OpenAI convention — they should fix their config.
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'real-b64-data-here' }],
    }), { status: 200 })) as unknown as typeof fetch

    await expect(generateImageViaOpenAICompatTemplate({
      userId: 'user-1',
      providerId: 'openai-compatible:test-provider',
      modelId: 'gpt-image-2',
      modelKey: 'openai-compatible:test-provider::gpt-image-2',
      prompt: 'cat',
      profile: 'openai-compatible',
      template: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: {
          method: 'POST',
          path: '/images/generations',
          contentType: 'application/json',
          bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}' },
        },
        response: {
          outputBase64Path: '$.wrong.path',  // explicit but wrong
        },
      },
    })).rejects.toThrow('OPENAI_COMPAT_IMAGE_TEMPLATE_OUTPUT_NOT_FOUND')
  })

  it('prefers URL over base64 when both paths are configured and both resolve', async () => {
    const fakeB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ url: 'https://cdn.test/cat.png', b64_json: fakeB64 }],
    }), { status: 200 })) as unknown as typeof fetch

    const result = await generateImageViaOpenAICompatTemplate({
      userId: 'user-1',
      providerId: 'openai-compatible:test-provider',
      modelId: 'gpt-image-1',
      modelKey: 'openai-compatible:test-provider::gpt-image-1',
      prompt: 'cat',
      profile: 'openai-compatible',
      template: {
        version: 1,
        mediaType: 'image',
        mode: 'sync',
        create: {
          method: 'POST',
          path: '/images/generations',
          contentType: 'application/json',
          bodyTemplate: { model: '{{model}}', prompt: '{{prompt}}' },
        },
        response: {
          outputUrlPath: '$.data[0].url',
          outputBase64Path: '$.data[0].b64_json',
        },
      },
    })

    expect(result).toEqual({
      success: true,
      imageUrl: 'https://cdn.test/cat.png',
    })
  })
})
