'use client'

import { useEffect, useState, useCallback } from 'react'

type ViewType = 'front' | 'threeQuarter' | 'side' | 'back'
type CharacterSource = 'project' | 'global'

interface ViewState {
  front: string | null
  threeQuarter: string | null
  side: string | null
  back: string | null
}

interface FourViewResp {
  characterId: string
  name: string
  source: CharacterSource
  views: ViewState
}

const VIEW_KEYS: ViewType[] = ['front', 'threeQuarter', 'side', 'back']

export interface CharacterFourViewSectionProps {
  characterId: string
  source?: CharacterSource
  /**
   * Translations dictionary so this component can be embedded in any locale
   * tree. The caller supplies the resolved strings — keeps this component
   * locale-agnostic and skill-test-friendly.
   */
  labels: {
    sectionTitle: string
    sectionHint?: string
    front: string
    threeQuarter: string
    side: string
    back: string
    notSet: string
    upload: string
    clear: string
    processing: string
    expand: string
    collapse: string
  }
  /**
   * Initial expanded state. Default false to keep the card lean.
   */
  defaultExpanded?: boolean
}

/**
 * Inline four-view reference manager for a single character.
 *
 * Used inside the project workspace `CharacterCard` so the user does not have
 * to leave the asset view to maintain reference images. The four-view URLs
 * are read by the panel-image prompt builder so storyboard panels stay
 * visually consistent.
 *
 * Self-contained: fetches its own state from
 * `/api/studio-tools/character-four-view` and posts uploads to
 * `/api/studio-tools/character-four-view/upload`.
 */
export default function CharacterFourViewSection({
  characterId,
  source = 'project',
  labels,
  defaultExpanded = false,
}: CharacterFourViewSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [data, setData] = useState<FourViewResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyView, setBusyView] = useState<ViewType | null>(null)

  const fetchViews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(
        `/api/studio-tools/character-four-view?characterId=${encodeURIComponent(characterId)}&source=${source}`,
      )
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.error || `HTTP ${resp.status}`)
        return
      }
      setData(json as FourViewResp)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [characterId, source])

  useEffect(() => {
    if (expanded && !data && !loading) {
      void fetchViews()
    }
  }, [expanded, data, loading, fetchViews])

  async function uploadView(view: ViewType, file: File) {
    setBusyView(view)
    setError(null)
    try {
      const form = new FormData()
      form.append('characterId', characterId)
      form.append('viewType', view)
      form.append('source', source)
      form.append('file', file)
      const resp = await fetch('/api/studio-tools/character-four-view/upload', {
        method: 'POST',
        body: form,
      })
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.error || `HTTP ${resp.status}`)
        return
      }
      void fetchViews()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyView(null)
    }
  }

  async function clearView(view: ViewType) {
    setBusyView(view)
    setError(null)
    try {
      const resp = await fetch(
        `/api/studio-tools/character-four-view?characterId=${encodeURIComponent(characterId)}&viewType=${view}&source=${source}`,
        { method: 'DELETE' },
      )
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.error || `HTTP ${resp.status}`)
        return
      }
      void fetchViews()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyView(null)
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--glass-stroke-soft)] pt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-[var(--glass-bg-muted)] transition-colors"
        style={{ color: 'var(--glass-text-secondary)' }}
      >
        <span className="font-medium">{labels.sectionTitle}</span>
        <span style={{ color: 'var(--glass-text-tertiary)' }}>
          {expanded ? labels.collapse : labels.expand}
        </span>
      </button>

      {expanded && (
        <div className="pt-2">
          {labels.sectionHint && (
            <p
              className="text-[10px] mb-2 px-2"
              style={{ color: 'var(--glass-text-tertiary)' }}
            >
              {labels.sectionHint}
            </p>
          )}

          {error && (
            <div
              className="mb-2 p-2 rounded text-xs"
              style={{
                background: 'var(--glass-tone-danger-bg)',
                color: 'var(--glass-tone-danger-fg)',
              }}
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {VIEW_KEYS.map((view) => {
              const url = data?.views?.[view] ?? null
              return (
                <ViewSlot
                  key={view}
                  view={view}
                  label={labels[view]}
                  url={url}
                  busy={busyView === view}
                  onUpload={(file) => uploadView(view, file)}
                  onClear={() => clearView(view)}
                  notSetLabel={labels.notSet}
                  uploadLabel={labels.upload}
                  clearLabel={labels.clear}
                  busyLabel={labels.processing}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ViewSlot({
  view,
  label,
  url,
  busy,
  onUpload,
  onClear,
  notSetLabel,
  uploadLabel,
  clearLabel,
  busyLabel,
}: {
  view: ViewType
  label: string
  url: string | null
  busy: boolean
  onUpload: (file: File) => void
  onClear: () => void
  notSetLabel: string
  uploadLabel: string
  clearLabel: string
  busyLabel: string
}) {
  return (
    <div className="rounded-md overflow-hidden border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]">
      <div
        className="aspect-square relative flex items-center justify-center text-[10px]"
        style={{
          background: 'var(--glass-bg-muted)',
          color: 'var(--glass-text-tertiary)',
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} reference`} className="w-full h-full object-contain" />
        ) : (
          <span>{notSetLabel}</span>
        )}
        {busy && (
          <div
            className="absolute inset-0 flex items-center justify-center text-xs"
            style={{
              background: 'rgba(0,0,0,0.55)',
              color: 'var(--glass-text-primary)',
            }}
          >
            {busyLabel}
          </div>
        )}
      </div>
      <div className="p-1.5 flex items-center justify-between gap-1">
        <div className="text-[10px] font-medium" style={{ color: 'var(--glass-text-primary)' }}>
          {label} <span className="font-mono opacity-50">·{view}</span>
        </div>
        <div className="flex gap-1">
          <label
            className="glass-btn-base glass-btn-primary px-1.5 py-0.5 text-[10px] cursor-pointer"
            title={uploadLabel}
          >
            ↑
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
                e.currentTarget.value = ''
              }}
              disabled={busy}
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="glass-btn-base glass-btn-soft px-1.5 py-0.5 text-[10px]"
              title={clearLabel}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
