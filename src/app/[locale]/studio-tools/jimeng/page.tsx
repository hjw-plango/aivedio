'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

interface PromptResult {
  prompt: string
  negative?: string
  parts: string[]
  jimengUrl: string
}

interface UploadResult {
  mode: 'standalone' | 'linked'
  key: string
  url: string
  sizeBytes: number
  contentType: string
  panelId?: string
  mediaId?: string
  mediaUrl?: string
}

export default function JimengToolPage() {
  const t = useTranslations('studioTools.jimeng')
  const tc = useTranslations('studioTools.common')

  const [subject, setSubject] = useState('')
  const [action, setAction] = useState('')
  const [cameraLanguage, setCameraLanguage] = useState('')
  const [lighting, setLighting] = useState('')
  const [style, setStyle] = useState('')
  const [durationSec, setDurationSec] = useState<5 | 10>(5)
  const [extra, setExtra] = useState('')
  const [negative, setNegative] = useState('')

  const [tag, setTag] = useState('')
  const [panelId, setPanelId] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [promptResult, setPromptResult] = useState<PromptResult | null>(null)
  const [promptLoading, setPromptLoading] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function onComposePrompt(e: React.FormEvent) {
    e.preventDefault()
    setPromptError(null)
    setPromptResult(null)
    setCopied(false)
    if (!subject.trim()) {
      setPromptError(t('compose.errors.subjectRequired'))
      return
    }
    setPromptLoading(true)
    try {
      const resp = await fetch('/api/studio-tools/jimeng/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          action: action.trim() || undefined,
          cameraLanguage: cameraLanguage.trim() || undefined,
          lighting: lighting.trim() || undefined,
          style: style.trim() || undefined,
          durationSec,
          extra: extra.trim() || undefined,
          negative: negative.trim() || undefined,
        }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        setPromptError(json?.error || `HTTP ${resp.status}`)
        return
      }
      setPromptResult(json as PromptResult)
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : String(err))
    } finally {
      setPromptLoading(false)
    }
  }

  async function onCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault()
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress(0)
    if (!videoFile) {
      setUploadError(t('upload.errors.fileRequired'))
      return
    }
    const form = new FormData()
    form.append('file', videoFile)
    if (tag.trim()) form.append('tag', tag.trim())
    if (panelId.trim()) form.append('panelId', panelId.trim())

    setUploadProgress(10)
    try {
      const resp = await fetch('/api/studio-tools/jimeng/upload', {
        method: 'POST',
        body: form,
      })
      setUploadProgress(85)
      const json = await resp.json()
      if (!resp.ok) {
        setUploadError(json?.error || `HTTP ${resp.status}`)
        setUploadProgress(0)
        return
      }
      setUploadResult(json as UploadResult)
      setUploadProgress(100)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
      setUploadProgress(0)
    }
  }

  return (
    <div className="glass-page min-h-screen px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <Link
          href={{ pathname: '/studio-tools' }}
          className="text-sm"
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
          className="text-sm mb-2"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('subtitle')}
        </p>
        <p
          className="text-xs mb-8"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('subtitleSteps')}
        </p>

        <section className="mb-12">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--glass-text-primary)' }}
          >
            {t('compose.heading')}
          </h2>
          <form onSubmit={onComposePrompt} className="grid gap-4 sm:grid-cols-2">
            <Field label={t('compose.fields.subject')} hint={t('compose.fields.subjectHint')}>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="glass-input-base w-full"
                required
              />
            </Field>
            <Field label={t('compose.fields.action')} hint={t('compose.fields.actionHint')}>
              <input
                type="text"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="glass-input-base w-full"
              />
            </Field>
            <Field label={t('compose.fields.camera')} hint={t('compose.fields.cameraHint')}>
              <input
                type="text"
                value={cameraLanguage}
                onChange={(e) => setCameraLanguage(e.target.value)}
                className="glass-input-base w-full"
              />
            </Field>
            <Field label={t('compose.fields.lighting')} hint={t('compose.fields.lightingHint')}>
              <input
                type="text"
                value={lighting}
                onChange={(e) => setLighting(e.target.value)}
                className="glass-input-base w-full"
              />
            </Field>
            <Field label={t('compose.fields.style')} hint={t('compose.fields.styleHint')}>
              <input
                type="text"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="glass-input-base w-full"
              />
            </Field>
            <Field label={t('compose.fields.duration')}>
              <select
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value) as 5 | 10)}
                className="glass-select-base w-full"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </Field>
            <Field label={t('compose.fields.extra')} hint={t('compose.fields.extraHint')} full>
              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                rows={2}
                className="glass-textarea-base w-full"
              />
            </Field>
            <Field
              label={t('compose.fields.negative')}
              hint={t('compose.fields.negativeHint')}
              full
            >
              <textarea
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                rows={2}
                className="glass-textarea-base w-full"
              />
            </Field>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={promptLoading}
                className="glass-btn-base glass-btn-primary px-5 py-2"
              >
                {promptLoading ? t('compose.actions.generating') : t('compose.actions.generate')}
              </button>
            </div>
          </form>

          {promptError && (
            <div
              className="mt-4 p-4 rounded-lg text-sm"
              style={{
                background: 'var(--glass-tone-danger-bg)',
                color: 'var(--glass-tone-danger-fg)',
                border: '1px solid var(--glass-stroke-base)',
              }}
            >
              {promptError}
            </div>
          )}

          {promptResult && (
            <div className="mt-6 space-y-4">
              <div className="glass-surface p-4 rounded-lg">
                <div
                  className="text-xs mb-2"
                  style={{ color: 'var(--glass-text-tertiary)' }}
                >
                  {t('compose.result.promptHint')}
                </div>
                <div
                  className="text-base leading-relaxed whitespace-pre-wrap font-sans"
                  style={{ color: 'var(--glass-text-primary)' }}
                >
                  {promptResult.prompt}
                </div>
                {promptResult.negative && (
                  <div
                    className="mt-3 pt-3 glass-divider"
                    style={{ borderTopWidth: '1px' }}
                  >
                    <div
                      className="text-xs mb-1"
                      style={{ color: 'var(--glass-text-tertiary)' }}
                    >
                      {t('compose.result.negativeHint')}
                    </div>
                    <div
                      className="text-sm font-sans"
                      style={{ color: 'var(--glass-text-secondary)' }}
                    >
                      {promptResult.negative}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => onCopy(promptResult.prompt)}
                  className="glass-btn-base glass-btn-soft px-4 py-2 text-sm"
                >
                  {copied ? tc('copied') : t('compose.actions.copyPrompt')}
                </button>
                <a
                  href={promptResult.jimengUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="glass-btn-base glass-btn-tone-info px-4 py-2 text-sm font-medium"
                >
                  {t('compose.actions.openJimeng')}
                </a>
              </div>
            </div>
          )}
        </section>

        <section>
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--glass-text-primary)' }}
          >
            {t('upload.heading')}
          </h2>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--glass-text-tertiary)' }}
          >
            {t('upload.subtitle')}
          </p>
          <form onSubmit={onUpload} className="space-y-4">
            <Field label={t('upload.fields.tag')} hint={t('upload.fields.tagHint')}>
              <input
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="glass-input-base w-full"
                pattern="[a-zA-Z0-9_-]{0,40}"
              />
            </Field>
            <Field label={t('upload.fields.panelId')} hint={t('upload.fields.panelIdHint')}>
              <input
                type="text"
                value={panelId}
                onChange={(e) => setPanelId(e.target.value)}
                className="glass-input-base w-full"
                placeholder={t('upload.fields.panelIdPlaceholder')}
              />
            </Field>
            <Field label={t('upload.fields.file')} hint={t('upload.fields.fileHint')}>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="glass-input-base w-full"
                required
              />
            </Field>

            <button
              type="submit"
              disabled={!videoFile || (uploadProgress > 0 && uploadProgress < 100)}
              className="glass-btn-base glass-btn-tone-info px-5 py-2"
            >
              {t('upload.actions.upload')}
            </button>
          </form>

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mt-4">
              <div
                className="h-2 rounded"
                style={{ background: 'var(--glass-bg-muted)' }}
              >
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${uploadProgress}%`,
                    background: 'var(--glass-tone-info-fg)',
                  }}
                />
              </div>
            </div>
          )}

          {uploadError && (
            <div
              className="mt-4 p-4 rounded-lg text-sm"
              style={{
                background: 'var(--glass-tone-danger-bg)',
                color: 'var(--glass-tone-danger-fg)',
                border: '1px solid var(--glass-stroke-base)',
              }}
            >
              {uploadError}
            </div>
          )}

          {uploadResult && (
            <div className="glass-surface mt-4 p-4 rounded-lg space-y-2">
              <div className="text-sm">
                <span
                  className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
                  style={{
                    background:
                      uploadResult.mode === 'linked'
                        ? 'var(--glass-tone-success-bg)'
                        : 'var(--glass-bg-muted)',
                    color:
                      uploadResult.mode === 'linked'
                        ? 'var(--glass-tone-success-fg)'
                        : 'var(--glass-text-secondary)',
                  }}
                >
                  {uploadResult.mode === 'linked'
                    ? t('upload.result.modeLinked')
                    : t('upload.result.modeStandalone')}
                </span>
              </div>
              {uploadResult.mode === 'linked' && uploadResult.panelId && (
                <div
                  className="text-sm"
                  style={{ color: 'var(--glass-text-secondary)' }}
                >
                  <span style={{ color: 'var(--glass-text-tertiary)' }}>
                    {t('upload.result.panelIdLabel')}
                  </span>{' '}
                  <span className="font-mono">{uploadResult.panelId}</span>
                </div>
              )}
              <div
                className="text-sm"
                style={{ color: 'var(--glass-text-secondary)' }}
              >
                <span style={{ color: 'var(--glass-text-tertiary)' }}>
                  {t('upload.result.keyLabel')}
                </span>{' '}
                {uploadResult.key}
              </div>
              <div
                className="text-sm"
                style={{ color: 'var(--glass-text-secondary)' }}
              >
                <span style={{ color: 'var(--glass-text-tertiary)' }}>
                  {t('upload.result.urlLabel')}
                </span>{' '}
                <a
                  href={uploadResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: 'var(--glass-tone-info-fg)' }}
                >
                  {uploadResult.url}
                </a>
              </div>
              <div
                className="text-sm"
                style={{ color: 'var(--glass-text-tertiary)' }}
              >
                {(uploadResult.sizeBytes / 1024 / 1024).toFixed(2)} MB · {uploadResult.contentType}
              </div>
              <video controls src={uploadResult.url} className="w-full mt-2 rounded" />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  full,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="glass-field-label block">{label}</span>
      {hint && <span className="glass-field-hint block mb-1">{hint}</span>}
      {children}
    </label>
  )
}
