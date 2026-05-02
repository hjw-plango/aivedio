'use client'

import { useState, useEffect } from 'react'
import { JIMENG_WEBSITE_URL } from '@/lib/studio-tools/jimeng-prompt'

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
    copied: string
    openJimeng: string
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
  const [uploading, setUploading] = useState(false)
  const [linked, setLinked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt)
      setCopied(false)
      setUploading(false)
      setLinked(null)
      setError(null)
    }
  }, [open, initialPrompt])

  if (!open) return null

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
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
          <a
            href={JIMENG_WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            className="glass-btn-base glass-btn-primary px-3 py-1.5 text-sm"
          >
            {labels.openJimeng}
          </a>
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
