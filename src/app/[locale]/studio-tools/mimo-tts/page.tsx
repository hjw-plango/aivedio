'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface MimoResult {
  audioBase64: string
  audioId: string | null
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  } | null
}

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'

const MODEL_IDS = [
  { id: 'mimo-v2.5-tts', labelKey: 'v25' },
  { id: 'mimo-v2.5-tts-voiceclone', labelKey: 'v25voiceclone' },
  { id: 'mimo-v2.5-tts-voicedesign', labelKey: 'v25voicedesign' },
  { id: 'mimo-v2-tts', labelKey: 'v2' },
] as const

type MimoModelId = (typeof MODEL_IDS)[number]['id']

export default function MimoTTSPage() {
  const t = useTranslations('studioTools.mimoTts')
  const tc = useTranslations('studioTools.common')

  const [text, setText] = useState('你好，这是一个语音合成测试。')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [model, setModel] = useState<MimoModelId>('mimo-v2.5-tts')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MimoResult | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setAudioUrl(null)
    if (!text.trim()) {
      setError(t('errors.textRequired'))
      return
    }
    if (!apiKey.trim()) {
      setError(t('errors.apiKeyRequired'))
      return
    }

    setLoading(true)
    try {
      const resp = await fetch('/api/studio-tools/mimo-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || undefined,
          model,
        }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.error || `HTTP ${resp.status}`)
        return
      }
      setResult(json as MimoResult)
      const bin = atob(json.audioBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'audio/wav' })
      setAudioUrl(URL.createObjectURL(blob))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function downloadWav() {
    if (!audioUrl) return
    const a = document.createElement('a')
    a.href = audioUrl
    a.download = `mimo-${Date.now()}.wav`
    a.click()
  }

  return (
    <div className="glass-page min-h-screen px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <Link
          href="../studio-tools"
          className="text-sm transition-colors"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {tc('back')}
        </Link>
        <h1
          className="text-2xl font-bold mt-2 mb-1"
          style={{ color: 'var(--glass-text-primary)' }}
        >
          {t('title')}
        </h1>
        <p
          className="text-sm mb-8"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('subtitle')}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t('fields.apiKey')}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="glass-input-base w-full"
              autoComplete="off"
            />
          </Field>

          <Field label={t('fields.baseUrl')}>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL}
              className="glass-input-base w-full"
            />
          </Field>

          <Field label={t('fields.model')}>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as MimoModelId)}
              className="glass-select-base w-full"
            >
              {MODEL_IDS.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(`models.${m.labelKey}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('fields.text')}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="glass-textarea-base w-full"
              placeholder={t('fields.textPlaceholder')}
            />
          </Field>

          <button
            type="submit"
            disabled={loading}
            className="glass-btn-base glass-btn-primary px-5 py-2"
          >
            {loading ? t('actions.synthesizing') : t('actions.synthesize')}
          </button>
        </form>

        {error && (
          <div
            className="mt-6 p-4 rounded-lg text-sm"
            style={{
              background: 'var(--glass-tone-danger-bg)',
              color: 'var(--glass-tone-danger-fg)',
              border: '1px solid var(--glass-stroke-base)',
            }}
          >
            {error}
          </div>
        )}

        {result && audioUrl && (
          <div className="glass-surface mt-6 p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div
                className="text-sm"
                style={{ color: 'var(--glass-text-tertiary)' }}
              >
                {t('result.modelLabel')}{' '}
                <span style={{ color: 'var(--glass-text-primary)' }}>{result.model}</span>
                {result.usage && (
                  <span className="ml-3" style={{ color: 'var(--glass-text-tertiary)' }}>
                    {t('result.tokensLabel')} {result.usage.totalTokens}
                  </span>
                )}
              </div>
              <button
                onClick={downloadWav}
                className="glass-btn-base glass-btn-soft px-3 py-1 text-xs"
              >
                {t('actions.downloadWav')}
              </button>
            </div>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="glass-field-label block mb-1">{label}</span>
      {children}
    </label>
  )
}
