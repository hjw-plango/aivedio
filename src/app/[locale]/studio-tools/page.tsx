'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

export default function StudioToolsHub() {
  const t = useTranslations('studioTools.hub')

  return (
    <div className="glass-page min-h-screen px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--glass-text-primary)' }}
        >
          {t('title')}
        </h1>
        <p
          className="mb-8 text-sm"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('subtitle')}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <ToolCard
            href="./studio-tools/mimo-tts"
            title={t('cards.mimoTts.title')}
            desc={t('cards.mimoTts.desc')}
            tag={t('cards.mimoTts.tag')}
          />
          <ToolCard
            href="./studio-tools/jimeng"
            title={t('cards.jimeng.title')}
            desc={t('cards.jimeng.desc')}
            tag={t('cards.jimeng.tag')}
          />
          <ToolCard
            href="./studio-tools/four-view"
            title={t('cards.fourView.title')}
            desc={t('cards.fourView.desc')}
            tag={t('cards.fourView.tag')}
          />
        </div>

        <p
          className="text-xs mt-10"
          style={{ color: 'var(--glass-text-tertiary)' }}
        >
          {t('footer')}
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
      className="glass-surface block p-5 rounded-xl transition-colors hover:[border-color:var(--glass-stroke-focus)]"
    >
      <div className="flex items-start justify-between mb-2">
        <h3
          className="text-lg font-semibold"
          style={{ color: 'var(--glass-text-primary)' }}
        >
          {title}
        </h3>
        <span
          className="text-xs px-2 py-0.5 rounded"
          style={{
            background: 'var(--glass-bg-muted)',
            color: 'var(--glass-text-secondary)',
          }}
        >
          {tag}
        </span>
      </div>
      <p
        className="text-sm leading-relaxed"
        style={{ color: 'var(--glass-text-secondary)' }}
      >
        {desc}
      </p>
    </Link>
  )
}
