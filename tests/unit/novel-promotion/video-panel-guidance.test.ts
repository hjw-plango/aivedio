import { describe, expect, it } from 'vitest'
import {
  applyRecommendedVideoDurationOption,
  buildVideoPanelGuidance,
  pickNearestVideoDurationOption,
} from '@/lib/novel-promotion/video-panel-guidance'

describe('video panel guidance', () => {
  it('keeps very short source durations short instead of defaulting to five seconds', () => {
    const guidance = buildVideoPanelGuidance({
      panel: {
        imageUrl: 'https://example.com/first.png',
        duration: 1.4,
        shotType: '眼神特写',
        description: '年轻女子抬眼看向门口',
      },
    })

    expect(guidance.duration.sourceSeconds).toBe(1.4)
    expect(guidance.duration.recommendedSeconds).toBe(1.5)
    expect(guidance.duration.bucket).toBe('short')
    expect(guidance.duration.isEstimated).toBe(false)
  })

  it('estimates missing close-up durations as a short edit target', () => {
    const guidance = buildVideoPanelGuidance({
      panel: {
        imageUrl: 'https://example.com/first.png',
        shotType: '手部特写',
        description: '手指轻轻放下茶杯',
      },
    })

    expect(guidance.duration.sourceSeconds).toBeNull()
    expect(guidance.duration.recommendedSeconds).toBe(1.5)
    expect(guidance.duration.bucket).toBe('default')
    expect(guidance.duration.isEstimated).toBe(true)
  })

  it('corrects old overlong durations when the panel is clearly a brief shot', () => {
    const guidance = buildVideoPanelGuidance({
      panel: {
        imageUrl: 'https://example.com/first.png',
        duration: 5,
        shotType: '眼神特写',
        description: '年轻女子短暂抬眼，手指轻轻收紧',
      },
    })

    expect(guidance.duration.sourceSeconds).toBe(5)
    expect(guidance.duration.recommendedSeconds).toBe(1.5)
    expect(guidance.duration.bucket).toBe('short')
  })

  it('maps recommended edit seconds to the nearest supported provider duration', () => {
    expect(pickNearestVideoDurationOption(1.5, [1, 2, 3, 4, 5])).toBe(2)
    expect(pickNearestVideoDurationOption(1.5, [4, 5, 6, 7, 8])).toBe(4)
    expect(pickNearestVideoDurationOption(8, [5, 10])).toBe(10)
  })

  it('overrides default model duration with panel guidance when auto duration is active', () => {
    const guidance = buildVideoPanelGuidance({
      panel: {
        imageUrl: 'https://example.com/first.png',
        duration: 1.4,
        shotType: '眼神特写',
        description: '年轻女子短暂抬眼',
      },
    })

    const options = applyRecommendedVideoDurationOption({
      generationOptions: { duration: 5, resolution: '720p' },
      durationOptions: [1, 2, 3, 4, 5],
      guidance,
    })

    expect(options).toEqual({ duration: 2, resolution: '720p' })
  })

  it('recognizes Chinese continuous motion as first-last-frame recommended', () => {
    const guidance = buildVideoPanelGuidance({
      panel: {
        imageUrl: 'https://example.com/first.png',
        location: '书房',
        characters: JSON.stringify([{ name: '林晚' }]),
        cameraMove: '缓缓推进',
        description: '年轻女子转头看向门口',
      },
      nextPanel: {
        imageUrl: 'https://example.com/last.png',
        location: '书房',
        characters: JSON.stringify([{ name: '林晚' }]),
        cameraMove: '轻微跟随',
        description: '年轻女子起身走向门口',
      },
    })

    expect(guidance.firstLastFrame.status).toBe('recommended')
    expect(guidance.firstLastFrame.reason).toBe('continuousMotion')
  })
})
