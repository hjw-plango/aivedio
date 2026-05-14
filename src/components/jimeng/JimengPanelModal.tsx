'use client'

import { useState, useEffect } from 'react'
import { JIMENG_WEBSITE_URL } from '@/lib/studio-tools/jimeng-prompt'
import { copyTextToClipboard } from '@/lib/browser/clipboard'

interface JimengReferenceItem {
  kind: string
  label: string
  url: string
}

interface JimengGuidanceText {
  durationSummary: string
  durationNote: string
  firstLastFrameSummary: string
  firstLastFrameNote: string
}

interface JimengPanelPackage {
  prompt: string
  negative?: string
  references: JimengReferenceItem[]
  packageText: string
  guidance?: {
    text?: JimengGuidanceText
  }
}

export interface JimengPanelModalProps {
  open: boolean
  onClose: () => void
  panelId: string
  /**
   * Initial video prompt text. Usually the panel.videoPrompt (or imagePrompt)
   * from waoowaoo. The user can still edit before copying to Jimeng.
   */
  initialPrompt: string
  /**
   * Called after the uploaded mp4 is successfully linked to the panel.
   * Caller should refresh panel state so the new videoUrl shows up.
   */
  onLinked?: (mediaUrl: string) => void
  /**
   * Pre-resolved label strings (so this component doesn't need its own
   * translations — caller already lives in a locale tree).
   */
  labels: {
    title: string
    promptLabel: string
    copyPrompt: string
    copyPackage: string
    copied: string
    packageCopied: string
    copyFailed: string
    openJimeng: string
    guidanceTitle: string
    durationAdvice: string
    frameAdvice: string
    referenceTitle: string
    packageLoading: string
    noReferences: string
    uploadHint: string
    uploadLabel: string
    uploading: string
    linkedLabel: string
    closeLabel: string
    errorLabel: string
  }
}

/**
 * Modal for the Jimeng human-in-the-loop video flow on a single panel.
 *
 * 1. Shows the panel's current video prompt (editable)
 * 2. Copy + Open Jimeng website
 * 3. After the user generates and downloads from Jimeng, they upload here
 * 4. POST to /api/studio-tools/jimeng/upload with panelId — server writes
 *    panel.videoUrl + panel.videoMediaId, so the panel card picks it up.
 */
export default function JimengPanelModal({
  open,
  onClose,
  panelId,
  initialPrompt,
  onLinked,
  labels,
}: JimengPanelModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [copied, setCopied] = useState(false)
  const [packageCopied, setPackageCopied] = useState(false)
  const [panelPackage, setPanelPackage] = useState<JimengPanelPackage | null>(null)
  const [packageLoading, setPackageLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [linked, setLinked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt)
      setCopied(false)
      setPackageCopied(false)
      setPanelPackage(null)
      setPackageLoading(false)
      setUploading(false)
      setLinked(null)
      setError(null)
    }
  }, [open, initialPrompt])

  useEffect(() => {
    if (!open || !panelId) return

    let cancelled = false
    async function fetchPackage() {
      setPackageLoading(true)
      try {
        const resp = await fetch(`/api/studio-tools/jimeng/panel-package?panelId=${encodeURIComponent(panelId)}`)
        const json = await resp.json()
        if (cancelled) return
        if (!resp.ok) {
          return
        }
        const nextPackage = json as JimengPanelPackage
        setPanelPackage(nextPackage)
        if (nextPackage.prompt) {
          setPrompt(nextPackage.prompt)
        }
      } catch {
        // The user can still copy/edit the plain prompt.
      } finally {
        if (!cancelled) setPackageLoading(false)
      }
    }

    void fetchPackage()
    return () => {
      cancelled = true
    }
  }, [open, panelId])

  if (!open) return null

  async function copyPrompt() {
    try {
      setError(null)
      await copyTextToClipboard(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(labels.copyFailed)
    }
  }

  async function copyPackage() {
    const text = panelPackage?.packageText || prompt
    try {
      setError(null)
      await copyTextToClipboard(text)
      setPackageCopied(true)
      setTimeout(() => setPackageCopied(false), 1500)
    } catch {
      setError(labels.copyFailed)
    }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('panelId', panelId)
      const resp = await fetch('/api/studio-tools/jimeng/upload', {
        method: 'POST',
        body: form,
      })
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.error || `HTTP ${resp.status}`)
        return
      }
      setLinked(json.url || json.mediaUrl || null)
      if (onLinked && (json.url || json.mediaUrl)) {
        onLinked(json.url || json.mediaUrl)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="glass-surface-modal relative max-w-xl w-full rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--glass-text-primary)' }}>
            {labels.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-2 py-1 rounded hover:bg-[var(--glass-bg-muted)]"
            style={{ color: 'var(--glass-text-tertiary)' }}
          >
            {labels.closeLabel}
          </button>
        </div>

        <label className="block mb-3">
          <span
            className="text-xs block mb-1"
            style={{ color: 'var(--glass-text-secondary)' }}
          >
            {labels.promptLabel}
          </span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="glass-textarea-base w-full font-sans"
          />
        </label>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={copyPrompt}
            className="glass-btn-base glass-btn-soft px-3 py-1.5 text-sm"
          >
            {copied ? labels.copied : labels.copyPrompt}
          </button>
          <button
            type="button"
            onClick={copyPackage}
            className="glass-btn-base glass-btn-soft px-3 py-1.5 text-sm"
          >
            {packageCopied ? labels.packageCopied : labels.copyPackage}
          </button>
          <a
            href={JIMENG_WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            className="glass-btn-base glass-btn-primary px-3 py-1.5 text-sm"
          >
            {labels.openJimeng}
          </a>
        </div>

        {panelPackage?.guidance?.text && (
          <div className="mb-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-3">
            <div className="mb-2 text-xs font-medium" style={{ color: 'var(--glass-text-secondary)' }}>
              {labels.guidanceTitle}
            </div>
            <div className="space-y-2 text-xs" style={{ color: 'var(--glass-text-secondary)' }}>
              <div>
                <span className="font-medium">{labels.durationAdvice}: </span>
                <span>{panelPackage.guidance.text.durationSummary}</span>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--glass-text-tertiary)' }}>
                  {panelPackage.guidance.text.durationNote}
                </div>
              </div>
              <div>
                <span className="font-medium">{labels.frameAdvice}: </span>
                <span>{panelPackage.guidance.text.firstLastFrameSummary}</span>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--glass-text-tertiary)' }}>
                  {panelPackage.guidance.text.firstLastFrameNote}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-3">
          <div className="mb-2 text-xs font-medium" style={{ color: 'var(--glass-text-secondary)' }}>
            {labels.referenceTitle}
          </div>
          {packageLoading ? (
            <div className="text-xs" style={{ color: 'var(--glass-text-tertiary)' }}>
              {labels.packageLoading}
            </div>
          ) : panelPackage?.references?.length ? (
            <div className="grid grid-cols-2 gap-2">
              {panelPackage.references.map((item) => (
                <a
                  key={`${item.kind}:${item.url}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)] p-1.5 text-[11px] hover:bg-[var(--glass-bg-muted)]"
                  style={{ color: 'var(--glass-text-secondary)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.label} className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                  <span className="line-clamp-2">{item.label}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="text-xs" style={{ color: 'var(--glass-text-tertiary)' }}>
              {labels.noReferences}
            </div>
          )}
        </div>

        <div
          className="border-t pt-3"
          style={{ borderColor: 'var(--glass-stroke-soft)' }}
        >
          <p
            className="text-xs mb-2"
            style={{ color: 'var(--glass-text-tertiary)' }}
          >
            {labels.uploadHint}
          </p>
          <label className="glass-btn-base glass-btn-primary px-4 py-2 text-sm cursor-pointer inline-block">
            {uploading ? labels.uploading : labels.uploadLabel}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadFile(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
        </div>

        {error && (
          <div
            className="mt-3 p-2 rounded text-xs"
            style={{
              background: 'var(--glass-tone-danger-bg)',
              color: 'var(--glass-tone-danger-fg)',
            }}
          >
            {labels.errorLabel}: {error}
          </div>
        )}

        {linked && (
          <div
            className="mt-3 p-2 rounded text-xs"
            style={{
              background: 'var(--glass-tone-success-bg)',
              color: 'var(--glass-tone-success-fg)',
            }}
          >
            {labels.linkedLabel}
          </div>
        )}
      </div>
    </div>
  )
}
