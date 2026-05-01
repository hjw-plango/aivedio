'use client'

import { useState } from 'react'
import Link from 'next/link'

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
      setPromptError('subject (主体描述) 必填')
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
      setUploadError('请选择要上传的视频文件')
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
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <Link href="../studio-tools" className="text-sm text-slate-400 hover:text-slate-200">
          ← Studio Tools
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">即梦手动桥</h1>
        <p className="text-slate-400 text-sm mb-8">
          即梦官网无 API。本工具走"人在回路"流程：
          <br />
          <span className="text-slate-500">
            ① 拼装提示词 → ② 跳转即梦生成 → ③ 下载 mp4 → ④ 回传到本地存储
          </span>
        </p>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-4 text-slate-200">① 拼装提示词</h2>
          <form onSubmit={onComposePrompt} className="grid gap-4 sm:grid-cols-2">
            <Field label="主体 *" hint="例：身着青蓝色长袍的老者">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input"
                required
              />
            </Field>
            <Field label="动作" hint="例：缓缓抬起右手抚摸瓷瓶">
              <input
                type="text"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="镜头语言" hint="例：特写、中景缓推、跟随镜头">
              <input
                type="text"
                value={cameraLanguage}
                onChange={(e) => setCameraLanguage(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="光线" hint="例：暖色侧光、清晨柔光">
              <input
                type="text"
                value={lighting}
                onChange={(e) => setLighting(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="风格" hint="例：纪录片写实、国漫水墨、电影级">
              <input
                type="text"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="时长（秒）">
              <select
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value) as 5 | 10)}
                className="input"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </Field>
            <Field label="补充" hint="额外的氛围 / 细节描述" full>
              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                rows={2}
                className="input font-sans"
              />
            </Field>
            <Field label="负面提示" hint="不希望出现的元素" full>
              <textarea
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                rows={2}
                className="input font-sans"
              />
            </Field>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={promptLoading}
                className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-medium"
              >
                {promptLoading ? '组装中…' : '生成提示词'}
              </button>
            </div>
          </form>

          {promptError && (
            <div className="mt-4 p-4 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-sm">
              {promptError}
            </div>
          )}

          {promptResult && (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400 mb-2">即梦提示词（直接粘贴到官网输入框）</div>
                <div className="text-base leading-relaxed text-slate-100 whitespace-pre-wrap font-sans">
                  {promptResult.prompt}
                </div>
                {promptResult.negative && (
                  <div className="mt-3 pt-3 border-t border-slate-800">
                    <div className="text-xs text-slate-400 mb-1">负面提示</div>
                    <div className="text-sm text-slate-300 font-sans">{promptResult.negative}</div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => onCopy(promptResult.prompt)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
                >
                  {copied ? '已复制' : '复制提示词'}
                </button>
                <a
                  href={promptResult.jimengUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm font-medium"
                >
                  打开即梦官网 ↗
                </a>
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-4 text-slate-200">② 回传 mp4</h2>
          <p className="text-sm text-slate-400 mb-4">
            从即梦官网下载视频后，在这里上传到本地存储（MinIO / local）。
          </p>
          <form onSubmit={onUpload} className="space-y-4">
            <Field label="标签" hint="可选，例：scene-1、panel-abc（限字母数字横线）">
              <input
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="input"
                pattern="[a-zA-Z0-9_-]{0,40}"
              />
            </Field>
            <Field
              label="Panel ID"
              hint="可选；填了之后视频会自动写入该 panel 的 videoUrl/videoMediaId（需登录 + 项目所有权）"
            >
              <input
                type="text"
                value={panelId}
                onChange={(e) => setPanelId(e.target.value)}
                className="input"
                placeholder="NovelPromotionPanel.id"
              />
            </Field>
            <Field label="视频文件 *" hint="支持 mp4 / mov / webm，<= 200MB">
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="input"
                required
              />
            </Field>

            <button
              type="submit"
              disabled={!videoFile || uploadProgress > 0 && uploadProgress < 100}
              className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 font-medium"
            >
              上传到存储
            </button>
          </form>

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mt-4">
              <div className="h-2 bg-slate-800 rounded">
                <div
                  className="h-full bg-emerald-500 rounded transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {uploadError && (
            <div className="mt-4 p-4 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-sm">
              {uploadError}
            </div>
          )}

          {uploadResult && (
            <div className="mt-4 p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="text-sm">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                    uploadResult.mode === 'linked'
                      ? 'bg-emerald-900 text-emerald-200'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {uploadResult.mode === 'linked' ? '已写入面板' : '独立上传'}
                </span>
              </div>
              {uploadResult.mode === 'linked' && uploadResult.panelId && (
                <div className="text-sm text-slate-300">
                  <span className="text-slate-500">panelId:</span>{' '}
                  <span className="font-mono">{uploadResult.panelId}</span>
                </div>
              )}
              <div className="text-sm text-slate-300">
                <span className="text-slate-500">key:</span> {uploadResult.key}
              </div>
              <div className="text-sm text-slate-300">
                <span className="text-slate-500">url:</span>{' '}
                <a
                  href={uploadResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 underline"
                >
                  {uploadResult.url}
                </a>
              </div>
              <div className="text-sm text-slate-400">
                {(uploadResult.sizeBytes / 1024 / 1024).toFixed(2)} MB · {uploadResult.contentType}
              </div>
              <video controls src={uploadResult.url} className="w-full mt-2 rounded" />
            </div>
          )}
        </section>
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
      <span className="text-sm text-slate-300 block">{label}</span>
      {hint && <span className="text-xs text-slate-500 block mb-1">{hint}</span>}
      {children}
    </label>
  )
}
