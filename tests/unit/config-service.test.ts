import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { getProjectModelConfig } from '@/lib/config-service'

const emptyProjectConfig = {
  analysisModel: null,
  characterModel: null,
  locationModel: null,
  storyboardModel: null,
  editModel: null,
  videoModel: null,
  audioModel: null,
  videoRatio: null,
  artStyle: null,
  capabilityOverrides: null,
}

const emptyUserPreference = {
  analysisModel: null,
  characterModel: null,
  locationModel: null,
  storyboardModel: null,
  editModel: null,
  videoModel: null,
  audioModel: null,
  capabilityDefaults: null,
}

describe('config-service getProjectModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue(emptyProjectConfig)
    prismaMock.userPreference.findUnique.mockResolvedValue(emptyUserPreference)
  })

  it('falls back to user default media models when project fields are empty', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      ...emptyUserPreference,
      analysisModel: 'openrouter::anthropic/claude-sonnet-4',
      characterModel: 'openai-compatible:oa-1::gpt-image-1',
      locationModel: 'google::imagen-4.0',
      storyboardModel: 'ark::doubao-seedream-4-0-250828',
      editModel: 'openai-compatible:oa-1::gpt-image-1',
      videoModel: 'bailian::wan2.6-i2v-flash',
      audioModel: 'mimo::mimo-v2.5-tts',
    })

    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config).toMatchObject({
      analysisModel: 'openrouter::anthropic/claude-sonnet-4',
      characterModel: 'openai-compatible:oa-1::gpt-image-1',
      locationModel: 'google::imagen-4.0',
      storyboardModel: 'ark::doubao-seedream-4-0-250828',
      editModel: 'openai-compatible:oa-1::gpt-image-1',
      videoModel: 'bailian::wan2.6-i2v-flash',
      audioModel: 'mimo::mimo-v2.5-tts',
    })
  })

  it('keeps project model fields ahead of user defaults', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      ...emptyProjectConfig,
      characterModel: 'google::imagen-4.0',
    })
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      ...emptyUserPreference,
      characterModel: 'openai-compatible:oa-1::gpt-image-1',
    })

    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config.characterModel).toBe('google::imagen-4.0')
  })
})
