'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

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

export default function FourViewPage() {
  const t = useTranslations('studioTools.fourView')
  const tc = useTranslations('studioTools.common')

  const [characterId, setCharacterId] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [source, setSource] = useState<CharacterSource>('project')
  const [data, setData] = useState<FourViewResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyView, setBusyView] = useState<ViewType | null>(null)

  const fetchViews = useCallback(
    async (id: string, src: CharacterSource) => {
      setLoading(true)
      setError(null)
      try {
        const resp = await fetch(
          `/api/studio-tools/character-four-view?characterId=${encodeURIComponent(id)}&source=${src}`,
        )
        const json = await resp.json()
        if (!resp.ok) {
          setError(json?.error || `HTTP ${resp.status}`)
          setData(null)
          return
        }
        setData(json as FourViewResp)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (characterId) void fetchViews(characterId, source)
  }, [characterId, source, fetchViews])

  function onLoad() {
    const id = pendingId.trim()
    if (!id) return
    setCharacterId(id)
  }

  async function uploadView(view: ViewType, file: File) {
    if (!characterId) return
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
      void fetchViews(characterId, source)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyView(null)
    }
  }

  async function clearView(view: ViewType | 'all') {
    if (!characterId) return
    setBusyView(view === 'all' ? 'front' : view)
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
      void fetchViews(characterId, source)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyView(null)
    }
  }

  return (
    <div className="glass-page min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <Link
          href="../studio-tools"
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
          className="text-sm mb-1"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('subtitle')}
        </p>
        <p
          className="text-xs mb-8"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('fieldsHint')}
        </p>

        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as CharacterSource)}
            className="glass-select-base"
            style={{ minWidth: '200px' }}
          >
            <option value="project">{t('controls.sourceProject')}</option>
            <option value="global">{t('controls.sourceGlobal')}</option>
          </select>
          <input
            type="text"
            value={pendingId}
            onChange={(e) => setPendingId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onLoad()
            }}
            placeholder={t('controls.characterIdPlaceholder')}
            className="glass-input-base flex-1 font-mono text-sm"
          />
          <button
            onClick={onLoad}
            disabled={!pendingId.trim() || loading}
            className="glass-btn-base glass-btn-primary px-5 py-2"
          >
            {loading ? tc('loading') : tc('load')}
          </button>
        </div>

        {error && (
          <div
            className="mb-6 p-4 rounded-lg text-sm"
            style={{
              background: 'var(--glass-tone-danger-bg)',
              color: 'var(--glass-tone-danger-fg)',
              border: '1px solid var(--glass-stroke-base)',
            }}
          >
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="flex items-baseline gap-3 mb-6">
              <h2
                className="text-lg font-semibold"
                style={{ color: 'var(--glass-text-primary)' }}
              >
                {data.name}
              </h2>
              <span
                className="text-xs font-mono"
                style={{ color: 'var(--glass-text-tertiary)' }}
              >
                {data.source} · {data.characterId}
              </span>
              <button
                onClick={() => clearView('all')}
                className="glass-btn-base glass-btn-soft px-3 py-1 text-xs ml-auto"
              >
                {tc('clearAll')}
              </button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {VIEW_KEYS.map((view) => (
                <ViewSlot
                  key={view}
                  view={view}
                  label={t(`views.${view}`)}
                  url={data.views[view]}
                  busy={busyView === view}
                  onUpload={(file) => uploadView(view, file)}
                  onClear={() => clearView(view)}
                  notSetLabel={tc('notSet')}
                  uploadLabel={tc('upload')}
                  clearLabel={tc('clear')}
                  busyLabel={tc('processing')}
                />
              ))}
            </div>
          </>
        )}

        {!data && !loading && (
          <div
            className="text-sm"
            style={{ color: 'var(--glass-text-tertiary)' }}
          >
            {t('controls.loadHint')}
          </div>
        )}
      </div>
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
    <div className="glass-surface flex flex-col rounded-xl overflow-hidden">
      <div
        className="aspect-square relative flex items-center justify-center text-xs"
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
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--glass-text-primary)',
            }}
          >
            {busyLabel}
          </div>
        )}
      </div>
      <div className="p-3 flex items-center justify-between gap-2">
        <div>
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--glass-text-primary)' }}
          >
            {label}
          </div>
          <div
            className="text-[10px] font-mono"
            style={{ color: 'var(--glass-text-tertiary)' }}
          >
            {view}
          </div>
        </div>
        <div className="flex gap-1">
          <label className="glass-btn-base glass-btn-primary px-2 py-1 text-xs cursor-pointer">
            {uploadLabel}
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
              onClick={onClear}
              disabled={busy}
              className="glass-btn-base glass-btn-soft px-2 py-1 text-xs"
            >
              {clearLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
