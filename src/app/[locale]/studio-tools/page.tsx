'use client'

import Link from 'next/link'

export default function StudioToolsHub() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Studio Tools</h1>
        <p className="text-slate-400 mb-8 text-sm">
          独立工具集 — 旁挂在 waoowaoo 主流程外，用于个人创作工作流。
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <ToolCard
            href="./studio-tools/mimo-tts"
            title="MiMo TTS"
            desc="小米 MiMo 系列 TTS 模型语音合成。粘贴文本，得到 WAV 文件。"
            tag="语音"
          />
          <ToolCard
            href="./studio-tools/jimeng"
            title="即梦手动桥"
            desc="拼装即梦视频提示词，跳转官网生成，完成后回传视频到本地存储。"
            tag="视频"
          />
        </div>

        <p className="text-xs text-slate-500 mt-10">
          这些工具不依赖 waoowaoo 主管道（novel-promotion / 任务队列）。
          API Key 在请求中传递，不持久化到数据库。
        </p>
      </div>
    </div>
  )
}

function ToolCard({
  href,
  title,
  desc,
  tag,
}: {
  href: string
  title: string
  desc: string
  tag: string
}) {
  return (
    <Link
      href={href}
      className="block p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-600 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">{tag}</span>
      </div>
      <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
    </Link>
  )
}
