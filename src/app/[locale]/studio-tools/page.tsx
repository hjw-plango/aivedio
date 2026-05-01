'use client'

import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

const HUB_TARGETS = {
  mimoTts: { pathname: '/studio-tools/mimo-tts' as const },
  jimeng: { pathname: '/studio-tools/jimeng' as const },
  fourView: { pathname: '/studio-tools/four-view' as const },
}

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
            target={HUB_TARGETS.mimoTts}
            title={t('cards.mimoTts.title')}
            desc={t('cards.mimoTts.desc')}
            tag={t('cards.mimoTts.tag')}
          />
          <ToolCard
            target={HUB_TARGETS.jimeng}
            title={t('cards.jimeng.title')}
            desc={t('cards.jimeng.desc')}
            tag={t('cards.jimeng.tag')}
          />
          <ToolCard
            target={HUB_TARGETS.fourView}
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
  target,
  title,
  desc,
  tag,
}: {
  target: { pathname: '/studio-tools/mimo-tts' | '/studio-tools/jimeng' | '/studio-tools/four-view' }
  title: string
  desc: string
  tag: string
}): ReactNode {
  return (
    <Link
      href={target}
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
