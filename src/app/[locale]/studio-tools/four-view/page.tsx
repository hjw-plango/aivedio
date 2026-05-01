'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type ViewType = 'front' | 'threeQuarter' | 'side' | 'back'

interface ViewState {
  front: string | null
  threeQuarter: string | null
  side: string | null
  back: string | null
}

interface FourViewResp {
  characterId: string
  name: string
  views: ViewState
}

const VIEW_LABELS: Record<ViewType, string> = {
  front: '正面',
  threeQuarter: '四分之三',
  side: '侧面',
  back: '背面',
}

export default function FourViewPage() {
  const [characterId, setCharacterId] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [data, setData] = useState<FourViewResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyView, setBusyView] = useState<ViewType | null>(null)

  const fetchViews = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`/api/studio-tools/character-four-view?characterId=${encodeURIComponent(id)}`)
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
  }, [])

  useEffect(() => {
    if (characterId) void fetchViews(characterId)
  }, [characterId, fetchViews])

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
      void fetchViews(characterId)
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
        `/api/studio-tools/character-four-view?characterId=${encodeURIComponent(characterId)}&viewType=${view}`,
        { method: 'DELETE' },
      )
      const json = await resp.json()
      if (!resp.ok) {
        setError(json?.error || `HTTP ${resp.status}`)
        return
      }
      void fetchViews(characterId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyView(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <Link href="../studio-tools" className="text-sm text-slate-400 hover:text-slate-200">
          ← Studio Tools
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">角色四视图管理</h1>
        <p className="text-slate-400 text-sm mb-8">
          来自 AIComicBuilder 设计——为角色管理 4 张参考图（正/四分之三/侧/背），用作分镜面板生成时的角色一致性锚点。
          <br />
          <span className="text-slate-500">
            字段映射：referenceFrontUrl / referenceThreeQuarterUrl / referenceSideUrl / referenceBackUrl
          </span>
        </p>

        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={pendingId}
            onChange={(e) => setPendingId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onLoad()
            }}
            placeholder="输入 characterId（NovelPromotionCharacter.id）"
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-100 font-mono text-sm focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={onLoad}
            disabled={!pendingId.trim() || loading}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-medium"
          >
            {loading ? '加载中…' : '加载'}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-sm">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="flex items-baseline gap-3 mb-6">
              <h2 className="text-lg font-semibold text-slate-200">{data.name}</h2>
              <span className="text-xs text-slate-500 font-mono">{data.characterId}</span>
              <button
                onClick={() => clearView('all')}
                className="ml-auto px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                清空全部
              </button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(VIEW_LABELS) as ViewType[]).map((view) => (
                <ViewSlot
                  key={view}
                  view={view}
                  label={VIEW_LABELS[view]}
                  url={data.views[view]}
                  busy={busyView === view}
                  onUpload={(file) => uploadView(view, file)}
                  onClear={() => clearView(view)}
                />
              ))}
            </div>
          </>
        )}

        {!data && !loading && (
          <div className="text-slate-500 text-sm">
            提示：characterId 可在工作区角色管理页找到，或通过 Prisma Studio
            （<span className="font-mono">npx prisma studio</span>）查询 <span className="font-mono">novel_promotion_characters</span> 表。
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
}: {
  view: ViewType
  label: string
  url: string | null
  busy: boolean
  onUpload: (file: File) => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      <div className="aspect-square bg-slate-800 relative flex items-center justify-center text-slate-500 text-xs">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} reference`} className="w-full h-full object-contain" />
        ) : (
          <span>未设置</span>
        )}
        {busy && (
          <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center text-xs text-slate-300">
            处理中…
          </div>
        )}
      </div>
      <div className="p-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-slate-200">{label}</div>
          <div className="text-[10px] text-slate-500 font-mono">{view}</div>
        </div>
        <div className="flex gap-1">
          <label className="px-2 py-1 text-xs rounded bg-indigo-700 hover:bg-indigo-600 cursor-pointer">
            上传
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
              className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
            >
              清除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
