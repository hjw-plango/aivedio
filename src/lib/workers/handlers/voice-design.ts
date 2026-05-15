import { createHash } from 'crypto'
import type { Job } from 'bullmq'
import {
  createVoiceDesign,
  validatePreviewText,
  validateVoicePrompt,
  type VoiceDesignInput,
} from '@/lib/providers/bailian/voice-design'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'
import { synthesizeMimoTTS } from '@/lib/studio-tools/mimo-tts'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { pickConfiguredMimoVoiceDesignModel } from '@/lib/voice/default-audio-model'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function readLanguage(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh'
}

function makeMimoVoiceId(params: {
  userId: string
  preferredName: string
  audioId?: string | null
  audioBase64: string
}) {
  const digest = createHash('sha1')
    .update(`${params.userId}:${params.preferredName}:${params.audioId || params.audioBase64.slice(0, 48)}`)
    .digest('hex')
    .slice(0, 24)
  return `mimo-vd-${digest}`
}

export async function handleVoiceDesignTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const preferredName = typeof payload.preferredName === 'string' && payload.preferredName.trim()
    ? payload.preferredName.trim()
    : 'custom_voice'
  const language = readLanguage(payload.language)

  const promptValidation = validateVoicePrompt(voicePrompt)
  if (!promptValidation.valid) {
    throw new Error(promptValidation.error || 'invalid voicePrompt')
  }
  const textValidation = validatePreviewText(previewText)
  if (!textValidation.valid) {
    throw new Error(textValidation.error || 'invalid previewText')
  }

  await reportTaskProgress(job, 25, {
    stage: 'voice_design_submit',
    stageLabel: '提交声音设计任务',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_design_submit')

  const pref = await prisma.userPreference.findUnique({
    where: { userId: job.data.userId },
    select: {
      audioModel: true,
      voiceDesignModel: true,
      customModels: true,
      customProviders: true,
    },
  })
  const configuredMimoVoiceDesignModel = pickConfiguredMimoVoiceDesignModel(pref)
  const preferredVoiceDesignModel = typeof pref?.voiceDesignModel === 'string' ? pref.voiceDesignModel.trim() : ''
  const voiceDesignModel = configuredMimoVoiceDesignModel || preferredVoiceDesignModel || 'bailian::qwen-voice-design'
  const selection = await resolveModelSelectionOrSingle(job.data.userId, voiceDesignModel, 'audio')
  const providerKey = getProviderKey(selection.provider).toLowerCase()

  let designed: {
    success: boolean
    voiceId?: string
    targetModel?: string
    audioBase64?: string
    sampleRate?: number
    responseFormat?: string
    usageCount?: number
    requestId?: string
    error?: string
  }

  if (providerKey === 'mimo') {
    const { apiKey, baseUrl } = await getProviderConfig(job.data.userId, selection.provider)
    try {
      const result = await synthesizeMimoTTS({
        text: previewText,
        apiKey,
        baseUrl,
        model: selection.modelId,
        stylePrompt: voicePrompt,
      })
      designed = {
        success: true,
        voiceId: makeMimoVoiceId({
          userId: job.data.userId,
          preferredName,
          audioId: result.audioId,
          audioBase64: result.audioBase64,
        }),
        targetModel: selection.modelKey,
        audioBase64: result.audioBase64,
        sampleRate: 24000,
        responseFormat: 'wav',
        usageCount: result.usage?.totalTokens,
        requestId: result.audioId || undefined,
      }
    } catch (error: unknown) {
      designed = {
        success: false,
        error: error instanceof Error ? error.message : 'MIMO_VOICE_DESIGN_FAILED',
      }
    }
  } else if (providerKey === 'bailian') {
    const { apiKey } = await getProviderConfig(job.data.userId, selection.provider)
    const input: VoiceDesignInput = {
      voicePrompt,
      previewText,
      preferredName,
      language,
    }
    designed = await createVoiceDesign(input, apiKey)
  } else {
    throw new Error(`VOICE_DESIGN_PROVIDER_UNSUPPORTED: ${selection.provider}`)
  }
  if (!designed.success) {
    throw new Error(designed.error || '声音设计失败')
  }

  await reportTaskProgress(job, 96, {
    stage: 'voice_design_done',
    stageLabel: '声音设计完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    voiceId: designed.voiceId,
    targetModel: designed.targetModel,
    audioBase64: designed.audioBase64,
    sampleRate: designed.sampleRate,
    responseFormat: designed.responseFormat,
    usageCount: designed.usageCount,
    requestId: designed.requestId,
    taskType: job.data.type === TASK_TYPE.ASSET_HUB_VOICE_DESIGN ? TASK_TYPE.ASSET_HUB_VOICE_DESIGN : TASK_TYPE.VOICE_DESIGN,
  }
}
