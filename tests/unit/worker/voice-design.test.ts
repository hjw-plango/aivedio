import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const bailianMock = vi.hoisted(() => ({
  createVoiceDesign: vi.fn(),
  validateVoicePrompt: vi.fn(),
  validatePreviewText: vi.fn(),
}))

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(),
  getProviderKey: vi.fn((providerId: string) => providerId),
  resolveModelSelectionOrSingle: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const mimoMock = vi.hoisted(() => ({
  synthesizeMimoTTS: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/providers/bailian/voice-design', () => bailianMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/studio-tools/mimo-tts', () => mimoMock)
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: workerMock.reportTaskProgress,
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: workerMock.assertTaskActive,
}))

import { handleVoiceDesignTask } from '@/lib/workers/handlers/voice-design'

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-voice-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'VoiceDesign',
      targetId: 'voice-design-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker voice-design behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bailianMock.validateVoicePrompt.mockReturnValue({ valid: true })
    bailianMock.validatePreviewText.mockReturnValue({ valid: true })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      audioModel: null,
      voiceDesignModel: null,
      customModels: null,
      customProviders: null,
    })
    apiConfigMock.resolveModelSelectionOrSingle.mockResolvedValue({
      provider: 'bailian',
      modelId: 'qwen-voice-design',
      modelKey: 'bailian::qwen-voice-design',
      mediaType: 'audio',
    })
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'bailian-key' })
    mimoMock.synthesizeMimoTTS.mockResolvedValue({
      audioBase64: 'mimo-base64-audio',
      audioId: 'mimo-audio-1',
      model: 'mimo-v2.5-tts-voicedesign',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    })
    bailianMock.createVoiceDesign.mockResolvedValue({
      success: true,
      voiceId: 'voice-id-1',
      targetModel: 'bailian-tts',
      audioBase64: 'base64-audio',
      sampleRate: 24000,
      responseFormat: 'mp3',
      usageCount: 11,
      requestId: 'req-1',
    })
  })

  it('missing required fields -> explicit error', async () => {
    const job = buildJob(TASK_TYPE.VOICE_DESIGN, { previewText: 'hello' })
    await expect(handleVoiceDesignTask(job)).rejects.toThrow('voicePrompt is required')
  })

  it('invalid prompt validation -> explicit error message from validator', async () => {
    bailianMock.validateVoicePrompt.mockReturnValue({ valid: false, error: 'bad prompt' })

    const job = buildJob(TASK_TYPE.VOICE_DESIGN, {
      voicePrompt: 'x',
      previewText: 'hello',
    })
    await expect(handleVoiceDesignTask(job)).rejects.toThrow('bad prompt')
  })

  it('success path -> submits normalized input and returns typed result', async () => {
    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: '  calm female narrator  ',
      previewText: '  hello world  ',
      preferredName: '  custom_name  ',
      language: 'en',
    })

    const result = await handleVoiceDesignTask(job)

    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'bailian')
    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-1',
      'bailian::qwen-voice-design',
      'audio',
    )
    expect(bailianMock.createVoiceDesign).toHaveBeenCalledWith({
      voicePrompt: 'calm female narrator',
      previewText: 'hello world',
      preferredName: 'custom_name',
      language: 'en',
    }, 'bailian-key')

    expect(result).toEqual(expect.objectContaining({
      success: true,
      voiceId: 'voice-id-1',
      taskType: TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
    }))
  })

  it('configured MiMo voice design avoids the hard-coded bailian provider', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      audioModel: 'bailian::qwen3-tts-vd-2026-01-26',
      voiceDesignModel: null,
      customModels: JSON.stringify([
        {
          modelId: 'mimo-v2.5-tts-voicedesign',
          modelKey: 'mimo::mimo-v2.5-tts-voicedesign',
          name: 'MiMo TTS 2.5 Voice Design',
          type: 'audio',
          provider: 'mimo',
        },
      ]),
      customProviders: JSON.stringify([
        { id: 'mimo', name: 'MiMo', apiKey: 'mimo-key' },
      ]),
    })
    apiConfigMock.resolveModelSelectionOrSingle.mockResolvedValueOnce({
      provider: 'mimo',
      modelId: 'mimo-v2.5-tts-voicedesign',
      modelKey: 'mimo::mimo-v2.5-tts-voicedesign',
      mediaType: 'audio',
    })
    apiConfigMock.getProviderConfig.mockResolvedValueOnce({
      apiKey: 'mimo-key',
      baseUrl: 'https://api.xiaomimimo.com/v1',
    })

    const job = buildJob(TASK_TYPE.VOICE_DESIGN, {
      voicePrompt: 'warm young narrator',
      previewText: 'hello world',
      preferredName: 'custom_name',
      language: 'zh',
    })

    const result = await handleVoiceDesignTask(job)

    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-1',
      'mimo::mimo-v2.5-tts-voicedesign',
      'audio',
    )
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'mimo')
    expect(mimoMock.synthesizeMimoTTS).toHaveBeenCalledWith({
      text: 'hello world',
      apiKey: 'mimo-key',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-tts-voicedesign',
      stylePrompt: 'warm young narrator',
    })
    expect(bailianMock.createVoiceDesign).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      success: true,
      targetModel: 'mimo::mimo-v2.5-tts-voicedesign',
      audioBase64: 'mimo-base64-audio',
      taskType: TASK_TYPE.VOICE_DESIGN,
    }))
  })
})
