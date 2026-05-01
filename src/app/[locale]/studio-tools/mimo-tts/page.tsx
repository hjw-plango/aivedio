'use client'

import { useState } from 'react'
import Link from 'next/link'

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

const MODELS = [
  { id: 'mimo-v2.5-tts', label: 'mimo-v2.5-tts (基础)' },
  { id: 'mimo-v2.5-tts-voiceclone', label: 'mimo-v2.5-tts-voiceclone (声音克隆)' },
  { id: 'mimo-v2.5-tts-voicedesign', label: 'mimo-v2.5-tts-voicedesign (声音设计)' },
  { id: 'mimo-v2-tts', label: 'mimo-v2-tts (旧版)' },
] as const

export default function MimoTTSPage() {
  const [text, setText] = useState('你好，这是一个语音合成测试。')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [model, setModel] = useState<(typeof MODELS)[number]['id']>('mimo-v2.5-tts')
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
      setError('请输入要合成的文本')
      return
    }
    if (!apiKey.trim()) {
      setError('请填写 API Key')
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
      // Build playable blob URL from base64
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
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="../studio-tools" className="text-sm text-slate-400 hover:text-slate-200">
          ← Studio Tools
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">MiMo TTS</h1>
        <p className="text-slate-400 text-sm mb-8">
          调用 OpenAI 兼容协议的小米 MiMo TTS 网关。响应是 base64 WAV，可在线播放或下载。
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="API Key">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="input"
              autoComplete="off"
            />
          </Field>

          <Field label="Base URL">
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL}
              className="input"
            />
          </Field>

          <Field label="模型">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as (typeof MODELS)[number]['id'])}
              className="input"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="文本">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="input font-sans"
              placeholder="要合成的文本"
            />
          </Field>

          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {loading ? '合成中…' : '合成'}
          </button>
        </form>

        {error && (
          <div className="mt-6 p-4 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-sm">
            {error}
          </div>
        )}

        {result && audioUrl && (
          <div className="mt-6 p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-400">
                模型：<span className="text-slate-200">{result.model}</span>
                {result.usage && (
                  <span className="ml-3 text-slate-500">
                    tokens {result.usage.totalTokens}
                  </span>
                )}
              </div>
              <button
                onClick={downloadWav}
                className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
              >
                下载 WAV
              </button>
            </div>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        )}
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          background: rgb(15 23 42);
          border: 1px solid rgb(30 41 59);
          border-radius: 0.5rem;
          color: rgb(241 245 249);
          font-family: ui-monospace, monospace;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: none;
          border-color: rgb(99 102 241);
        }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-300 mb-1 block">{label}</span>
      {children}
    </label>
  )
}
