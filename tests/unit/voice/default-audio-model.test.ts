import { describe, expect, it } from 'vitest'
import {
  pickConfiguredMimoTtsModel,
  pickConfiguredMimoVoiceDesignModel,
} from '@/lib/voice/default-audio-model'

describe('default audio model selection', () => {
  it('picks mimo v2.5 basic tts when it is enabled and keyed', () => {
    const picked = pickConfiguredMimoTtsModel({
      customModels: JSON.stringify([
        {
          modelId: 'mimo-v2-tts',
          modelKey: 'mimo::mimo-v2-tts',
          name: 'MiMo TTS 2',
          type: 'audio',
          provider: 'mimo',
        },
        {
          modelId: 'mimo-v2.5-tts',
          modelKey: 'mimo::mimo-v2.5-tts',
          name: 'MiMo TTS 2.5',
          type: 'audio',
          provider: 'mimo',
        },
      ]),
      customProviders: JSON.stringify([
        { id: 'mimo', name: 'MiMo', apiKey: 'encrypted-key' },
      ]),
    })

    expect(picked).toBe('mimo::mimo-v2.5-tts')
  })

  it('does not pick voice design or clone models as the default tts path', () => {
    const picked = pickConfiguredMimoTtsModel({
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
        { id: 'mimo', name: 'MiMo', apiKey: 'encrypted-key' },
      ]),
    })

    expect(picked).toBeNull()
  })

  it('keeps an explicitly selected mimo voice design model for tts compatibility', () => {
    const picked = pickConfiguredMimoTtsModel({
      audioModel: 'mimo::mimo-v2.5-tts-voicedesign',
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
        { id: 'mimo', name: 'MiMo', apiKey: 'encrypted-key' },
      ]),
    })

    expect(picked).toBe('mimo::mimo-v2.5-tts-voicedesign')
  })

  it('picks mimo voice design for role voice generation', () => {
    const picked = pickConfiguredMimoVoiceDesignModel({
      customModels: JSON.stringify([
        {
          modelId: 'mimo-v2.5-tts',
          modelKey: 'mimo::mimo-v2.5-tts',
          name: 'MiMo TTS 2.5',
          type: 'audio',
          provider: 'mimo',
        },
        {
          modelId: 'mimo-v2.5-tts-voicedesign',
          modelKey: 'mimo::mimo-v2.5-tts-voicedesign',
          name: 'MiMo TTS 2.5 Voice Design',
          type: 'audio',
          provider: 'mimo',
        },
      ]),
      customProviders: JSON.stringify([
        { id: 'mimo', name: 'MiMo', apiKey: 'encrypted-key' },
      ]),
    })

    expect(picked).toBe('mimo::mimo-v2.5-tts-voicedesign')
  })
})
