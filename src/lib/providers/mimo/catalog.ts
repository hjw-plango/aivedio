/**
 * MiMo capability catalog — registers known MiMo TTS models with the official
 * model registry so the strict capability checks pass.
 *
 * Mirrors `providers/bailian/catalog.ts` structure.
 */

import { registerOfficialModel } from '@/lib/providers/official/model-registry'
import type { OfficialModelModality } from '@/lib/providers/official/model-registry'

const MIMO_CATALOG: Readonly<Record<OfficialModelModality, readonly string[]>> = {
  llm: [],
  image: [],
  video: [],
  audio: [
    'mimo-v2.5-tts',
    'mimo-v2.5-tts-voiceclone',
    'mimo-v2.5-tts-voicedesign',
    'mimo-v2-tts',
  ],
}

let initialized = false

export function ensureMimoCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const modality of Object.keys(MIMO_CATALOG) as OfficialModelModality[]) {
    for (const modelId of MIMO_CATALOG[modality]) {
      registerOfficialModel({ provider: 'mimo', modality, modelId })
    }
  }
}

export function listMimoCatalogModels(modality: OfficialModelModality): readonly string[] {
  ensureMimoCatalogRegistered()
  return MIMO_CATALOG[modality]
}
