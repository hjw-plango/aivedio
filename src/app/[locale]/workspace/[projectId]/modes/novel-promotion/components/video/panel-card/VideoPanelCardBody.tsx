import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import { AppIcon } from '@/components/ui/icons'
import JimengPanelModal from '@/components/jimeng/JimengPanelModal'
import type { VideoPanelRuntime } from './hooks/useVideoPanelActions'
import { applyRecommendedVideoDurationOption } from '@/lib/novel-promotion/video-panel-guidance'

interface VideoPanelCardBodyProps {
  runtime: VideoPanelRuntime
}

export default function VideoPanelCardBody({ runtime }: VideoPanelCardBodyProps) {
  const tJimeng = useTranslations('studioTools.panelModal')
  const [jimengOpen, setJimengOpen] = useState(false)
  const {
    t,
    tCommon,
    panel,
    panelIndex,
    panelKey,
    layout,
    actions,
    taskStatus,
    videoModel,
    promptEditor,
    voiceManager,
    lipSync,
    computed,
  } = runtime
  const safeTranslate = (key: string | undefined, fallback = ''): string => {
    if (!key) return fallback
    try {
      return t(key as never)
    } catch {
      return fallback
    }
  }

  const renderCapabilityLabel = (field: {
    field: string
    label: string
    labelKey?: string
    unitKey?: string
  }): string => {
    const labelText = safeTranslate(field.labelKey, safeTranslate(`capability.${field.field}`, field.label))
    const unitText = safeTranslate(field.unitKey)
    return unitText ? `${labelText} (${unitText})` : labelText
  }

  const isFirstLastFrameGenerated = panel.videoGenerationMode === 'firstlastframe' && !!panel.videoUrl
  const showsIncomingLinkBadge = layout.isLastFrame && !!layout.prevPanel
  const showsOutgoingLinkBadge = layout.isLinked && !!layout.nextPanel
  const showsPromptEditor = !layout.isLastFrame || layout.isLinked
  const showsFirstLastFrameActions = layout.isLinked && !!layout.nextPanel
  const tVideo = t as unknown as (key: string, values?: Record<string, string | number>) => string
  const formatSeconds = (value: number | null): string => {
    if (typeof value !== 'number') return ''
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
  const durationGuidance = runtime.guidance.duration
  const firstLastFrameGuidance = runtime.guidance.firstLastFrame
  const durationLabel = tVideo(`guidance.duration.${durationGuidance.bucket}`, {
    seconds: durationGuidance.recommendedSeconds,
    sourceSeconds: formatSeconds(durationGuidance.sourceSeconds),
  })
  const durationReason = tVideo(`guidance.duration.reason.${durationGuidance.bucket}`, {
    seconds: durationGuidance.recommendedSeconds,
    sourceSeconds: formatSeconds(durationGuidance.sourceSeconds),
  })
  const firstLastFrameLabel = layout.isLinked
    ? tVideo(firstLastFrameGuidance.status === 'recommended' || firstLastFrameGuidance.status === 'optional'
      ? 'guidance.firstLastFrame.linked'
      : 'guidance.firstLastFrame.linkedReview')
    : tVideo(`guidance.firstLastFrame.${firstLastFrameGuidance.status}`)
  const firstLastFrameReason = tVideo(`guidance.firstLastFrame.reason.${firstLastFrameGuidance.reason}`)
  const firstLastFrameTone = layout.isLinked
    ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] border-[var(--glass-stroke-focus)]'
    : firstLastFrameGuidance.status === 'recommended'
      ? 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)] border-[var(--glass-stroke-success)]'
      : firstLastFrameGuidance.status === 'optional'
        ? 'bg-[var(--glass-tone-warning-bg)] text-[var(--glass-tone-warning-fg)] border-[var(--glass-stroke-warning)]'
        : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)] border-[var(--glass-stroke-base)]'
  const firstLastFrameIconName =
    layout.isLinked || firstLastFrameGuidance.status === 'recommended' || firstLastFrameGuidance.status === 'optional'
      ? 'link'
      : 'unplug'
  const normalDurationField = videoModel.capabilityFields.find((field) => field.field === 'duration')
  const firstLastFrameDurationField = layout.flCapabilityFields.find((field) => field.field === 'duration')
  const normalGenerationOptions = videoModel.touchedCapabilityFields.has('duration')
    ? videoModel.generationOptions
    : applyRecommendedVideoDurationOption({
      generationOptions: videoModel.generationOptions,
      durationOptions: normalDurationField?.options.filter((option) => !normalDurationField.disabledOptions?.includes(option)),
      guidance: runtime.guidance,
    })
  const firstLastFrameGenerationOptions = layout.flTouchedCapabilityFields.has('duration')
    ? layout.flGenerationOptions
    : applyRecommendedVideoDurationOption({
      generationOptions: layout.flGenerationOptions,
      durationOptions: firstLastFrameDurationField?.options.filter((option) => !firstLastFrameDurationField.disabledOptions?.includes(option)),
      guidance: runtime.guidance,
    })
  const normalDurationMode = videoModel.touchedCapabilityFields.has('duration') ? 'manual' : 'auto'
  const firstLastFrameDurationMode = layout.flTouchedCapabilityFields.has('duration') ? 'manual' : 'auto'

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="px-2 py-0.5 bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] rounded font-medium">{panel.textPanel?.shot_type || t('panelCard.unknownShotType')}</span>
        <span className="inline-flex items-center gap-1 rounded border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-0.5 font-medium text-[var(--glass-text-secondary)]">
          <AppIcon name="clock" className="h-3 w-3" />
          {durationLabel}
        </span>
      </div>

      <p className="text-sm text-[var(--glass-text-secondary)] line-clamp-2">{panel.textPanel?.description}</p>

      <div className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-2.5 py-2 text-[11px]">
        <div className="flex items-start gap-1.5 text-[var(--glass-text-secondary)]">
          <AppIcon name="clock" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">{durationReason}</span>
        </div>
        <div className="mt-1.5 flex items-start gap-1.5">
          <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${firstLastFrameTone}`}>
            <AppIcon name={firstLastFrameIconName} className="h-3 w-3" />
            {firstLastFrameLabel}
          </span>
          <span className="min-w-0 pt-0.5 text-[var(--glass-text-tertiary)]">{firstLastFrameReason}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--glass-stroke-base)]">
        {(showsIncomingLinkBadge || showsOutgoingLinkBadge) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {showsIncomingLinkBadge && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${showsOutgoingLinkBadge
                    ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
                    : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)] border border-[var(--glass-stroke-base)]'
                  }`}
              >
                <AppIcon name={showsOutgoingLinkBadge ? 'link' : 'unplug'} className="w-3 h-3" />
                {t('firstLastFrame.asLastFrameFor', { number: panelIndex })}
              </span>
            )}
            {showsOutgoingLinkBadge && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                <AppIcon name="link" className="w-3 h-3" />
                {t('firstLastFrame.asFirstFrameFor', { number: panelIndex + 2 })}
              </span>
            )}
          </div>
        )}

        {showsPromptEditor && (
          <>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('promptModal.promptLabel')}</span>
              {!promptEditor.isEditing && (
                <button onClick={promptEditor.handleStartEdit} className="text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-info-fg)] transition-colors p-0.5">
                  <AppIcon name="edit" className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {promptEditor.isEditing ? (
              <div className="relative mb-3">
                <textarea
                  value={promptEditor.editingPrompt}
                  onChange={(event) => promptEditor.setEditingPrompt(event.target.value)}
                  autoFocus
                  className="w-full text-xs p-2 pr-16 border border-[var(--glass-stroke-focus)] rounded-lg bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--glass-tone-info-fg)] resize-none"
                  rows={3}
                  placeholder={t('promptModal.placeholder')}
                />
                <div className="absolute right-1 top-1 flex flex-col gap-1">
                  <button onClick={promptEditor.handleSave} disabled={promptEditor.isSavingPrompt} className="px-2 py-1 text-[10px] bg-[var(--glass-accent-from)] text-white rounded">{promptEditor.isSavingPrompt ? '...' : t('panelCard.save')}</button>
                  <button onClick={promptEditor.handleCancelEdit} disabled={promptEditor.isSavingPrompt} className="px-2 py-1 text-[10px] bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] rounded">{t('panelCard.cancel')}</button>
                </div>
              </div>
            ) : (
              <div onClick={promptEditor.handleStartEdit} className="text-xs p-2 border border-[var(--glass-stroke-base)] rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] cursor-pointer">
                {promptEditor.localPrompt || <span className="text-[var(--glass-text-tertiary)] italic">{t('panelCard.clickToEditPrompt')}</span>}
              </div>
            )}

            {showsFirstLastFrameActions ? (() => {
              const linkedNextPanel = layout.nextPanel!
              return (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => actions.onGenerateFirstLastFrame(
                      panel.storyboardId,
                      panel.panelIndex,
                      linkedNextPanel.storyboardId,
                      linkedNextPanel.panelIndex,
                      panelKey,
                      firstLastFrameGenerationOptions,
                      panel.panelId,
                      firstLastFrameDurationMode,
                    )}
                    disabled={
                      taskStatus.isVideoTaskRunning
                      || !panel.imageUrl
                      || !linkedNextPanel.imageUrl
                      || !layout.flModel
                      || layout.flMissingCapabilityFields.length > 0
                    }
                    className="flex-shrink-0 min-w-[120px] py-2 px-3 text-sm font-medium rounded-lg shadow-sm transition-all disabled:opacity-50 bg-[var(--glass-accent-from)] text-white"
                  >
                    {isFirstLastFrameGenerated ? t('firstLastFrame.generated') : taskStatus.isVideoTaskRunning ? taskStatus.taskRunningVideoLabel : t('firstLastFrame.generate')}
                  </button>
                  <div className="flex-1 min-w-0">
                    <ModelCapabilityDropdown
                      compact
                      models={layout.flModelOptions}
                      value={layout.flModel || undefined}
                      onModelChange={actions.onFlModelChange}
                      capabilityFields={layout.flCapabilityFields.map((field) => ({
                        field: field.field,
                        label: field.label,
                        options: field.options,
                        disabledOptions: field.disabledOptions,
                      }))}
                      capabilityOverrides={layout.flGenerationOptions}
                      onCapabilityChange={(field, rawValue) => actions.onFlCapabilityChange(field, rawValue)}
                      placeholder={t('panelCard.selectModel')}
                    />
                  </div>
                </div>
              )
            })() : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      actions.onGenerateVideo(
                        panel.storyboardId,
                        panel.panelIndex,
                        videoModel.selectedModel,
                        undefined,
                        normalGenerationOptions,
                        panel.panelId,
                        normalDurationMode,
                      )}
                    disabled={
                      taskStatus.isVideoTaskRunning
                      || !panel.imageUrl
                      || !videoModel.selectedModel
                      || videoModel.missingCapabilityFields.length > 0
                    }
                    className="flex-shrink-0 min-w-[90px] py-2 px-3 text-sm font-medium rounded-lg shadow-sm transition-all disabled:opacity-50 bg-[var(--glass-accent-from)] text-white"
                  >
                    {panel.videoUrl ? t('stage.hasSynced') : taskStatus.isVideoTaskRunning ? taskStatus.taskRunningVideoLabel : t('panelCard.generateVideo')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setJimengOpen(true)}
                    disabled={!panel.imageUrl || !panel.panelId}
                    title={tJimeng('triggerHint')}
                    className="flex-shrink-0 px-2 py-2 text-xs rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-muted)] disabled:opacity-50 transition-colors"
                  >
                    {tJimeng('triggerButton')}
                  </button>
                  <div className="flex-1 min-w-0">
                    <ModelCapabilityDropdown
                      compact
                      models={videoModel.videoModelOptions}
                      value={videoModel.selectedModel || undefined}
                      onModelChange={(modelKey) => {
                        videoModel.setSelectedModel(modelKey)
                      }}
                      capabilityFields={videoModel.capabilityFields.map((field) => ({
                        field: field.field,
                        label: renderCapabilityLabel(field),
                        options: field.options,
                        disabledOptions: field.disabledOptions,
                      }))}
                      capabilityOverrides={videoModel.generationOptions}
                      onCapabilityChange={(field, rawValue) => videoModel.setCapabilityValue(field, rawValue)}
                      placeholder={t('panelCard.selectModel')}
                    />
                  </div>
                </div>

                {computed.showLipSyncSection && (
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <button
                        onClick={computed.canLipSync ? lipSync.handleStartLipSync : undefined}
                        disabled={!computed.canLipSync || taskStatus.isLipSyncTaskRunning || lipSync.executingLipSync}
                        className="flex-1 py-1.5 text-xs rounded-lg transition-all flex items-center justify-center gap-1 bg-[var(--glass-accent-from)] text-white disabled:opacity-50"
                      >
                        {taskStatus.isLipSyncTaskRunning || lipSync.executingLipSync ? (
                          <TaskStatusInline state={taskStatus.lipSyncInlineState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : (
                          <>{t('panelCard.lipSync')}</>
                        )}
                      </button>

                      {(taskStatus.isLipSyncTaskRunning || panel.lipSyncVideoUrl) && voiceManager.hasMatchedAudio && (
                        <button onClick={lipSync.handleStartLipSync} disabled={lipSync.executingLipSync} className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg bg-[var(--glass-tone-warning-fg)] text-white">
                          {t('panelCard.redo')}
                        </button>
                      )}
                    </div>

                    {voiceManager.audioGenerateError && (
                      <div className="mt-1 p-1.5 bg-[var(--glass-tone-danger-bg)] border border-[var(--glass-stroke-danger)] rounded text-[10px] text-[var(--glass-tone-danger-fg)]">
                        {voiceManager.audioGenerateError}
                      </div>
                    )}

                    {voiceManager.localVoiceLines.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {voiceManager.localVoiceLines.map((voiceLine) => {
                          const isVoiceTaskRunning = voiceManager.isVoiceLineTaskRunning(voiceLine.id)
                          const voiceAudioRunningState = isVoiceTaskRunning
                            ? resolveTaskPresentationState({ phase: 'processing', intent: 'generate', resource: 'audio', hasOutput: !!voiceLine.audioUrl })
                            : null

                          return (
                            <div key={voiceLine.id} className="flex items-start gap-1.5 p-1.5 bg-[var(--glass-bg-muted)] rounded text-[10px]">
                              {voiceLine.audioUrl ? (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    voiceManager.handlePlayVoiceLine(voiceLine)
                                  }}
                                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors bg-[var(--glass-bg-muted)]"
                                  title={voiceManager.playingVoiceLineId === voiceLine.id ? t('panelCard.stopVoice') : t('panelCard.play')}
                                >
                                  <AppIcon name="play" className="w-3 h-3" />
                                </button>
                              ) : (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void voiceManager.handleGenerateAudio(voiceLine)
                                  }}
                                  disabled={isVoiceTaskRunning}
                                  className="flex-shrink-0 px-1.5 py-0.5 bg-[var(--glass-accent-from)] text-white rounded disabled:opacity-50"
                                  title={t('panelCard.generateAudio')}
                                >
                                  {isVoiceTaskRunning ? (
                                    <TaskStatusInline state={voiceAudioRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                                  ) : (
                                    tCommon('generate')
                                  )}
                                </button>
                              )}
                              <div className="flex-1 min-w-0">
                                <span className="text-[var(--glass-text-tertiary)]">{voiceLine.speaker}: </span>
                                <span className="text-[var(--glass-text-secondary)]">&ldquo;{voiceLine.content}&rdquo;</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      <JimengPanelModal
        open={jimengOpen}
        onClose={() => setJimengOpen(false)}
        panelId={panel.panelId || ''}
        initialPrompt={promptEditor.localPrompt || panel.textPanel?.description || ''}
        labels={{
          title: tJimeng('title'),
          promptLabel: tJimeng('promptLabel'),
          copyPrompt: tJimeng('copyPrompt'),
          copyPackage: tJimeng('copyPackage'),
          copied: tJimeng('copied'),
          packageCopied: tJimeng('packageCopied'),
          copyFailed: tJimeng('copyFailed'),
          openJimeng: tJimeng('openJimeng'),
          guidanceTitle: tJimeng('guidanceTitle'),
          durationAdvice: tJimeng('durationAdvice'),
          frameAdvice: tJimeng('frameAdvice'),
          referenceTitle: tJimeng('referenceTitle'),
          packageLoading: tJimeng('packageLoading'),
          noReferences: tJimeng('noReferences'),
          uploadHint: tJimeng('uploadHint'),
          uploadLabel: tJimeng('uploadLabel'),
          uploading: tJimeng('uploading'),
          linkedLabel: tJimeng('linkedLabel'),
          closeLabel: tJimeng('closeLabel'),
          errorLabel: tJimeng('errorLabel'),
        }}
      />
    </div>
  )
}
