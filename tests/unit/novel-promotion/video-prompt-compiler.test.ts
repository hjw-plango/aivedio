import { describe, expect, it } from 'vitest'
import { buildPanelVideoGenerationPrompt } from '@/lib/novel-promotion/video-prompt-compiler'

describe('video prompt compiler', () => {
  it('enriches a storyboard video prompt with panel context', () => {
    const prompt = buildPanelVideoGenerationPrompt({
      mode: 'normal',
      basePrompt: '年轻女子缓慢转头看向门口，镜头轻轻推进',
      panel: {
        shotType: '平视近景',
        cameraMove: '缓慢推进',
        description: '她握紧杯子，听见门外脚步声后抬头',
        location: '夜晚书房',
        characters: JSON.stringify([
          { name: '林晚', appearance: '白色衬衫，短发', slot: '画面左侧书桌旁' },
        ]),
        props: JSON.stringify([{ name: '咖啡杯', description: '白色陶瓷杯' }]),
        photographyRules: JSON.stringify({
          lighting: { direction: '左侧窗光', quality: '柔和冷光' },
          depth_of_field: '浅景深T2.8',
          color_tone: '冷暖对比',
        }),
        actingNotes: JSON.stringify([
          { name: '林晚', acting: '眼神闪烁，手指收紧，呼吸放慢' },
        ]),
        imagePrompt: '保持首帧的书房构图和人物服装',
        duration: 5,
      },
    })

    expect(prompt).toContain('年轻女子缓慢转头看向门口')
    expect(prompt).toContain('镜头设计: 平视近景，缓慢推进')
    expect(prompt).toContain('角色保持: 林晚，白色衬衫，短发，位置:画面左侧书桌旁')
    expect(prompt).toContain('摄影质感: 光线:左侧窗光，柔和冷光')
    expect(prompt).toContain('表演细节: 林晚:眼神闪烁，手指收紧，呼吸放慢')
    expect(prompt).toContain('严格保持首帧角色外观')
    expect(prompt.length).toBeLessThanOrEqual(1500)
  })

  it('adds first-last-frame transition constraints and last panel target', () => {
    const prompt = buildPanelVideoGenerationPrompt({
      mode: 'firstlastframe',
      basePrompt: '年轻男子从走廊尽头向窗边走去',
      panel: {
        shotType: '全景',
        cameraMove: '手持跟随',
        location: '医院走廊',
        videoPrompt: '年轻男子快步穿过走廊',
      },
      lastPanel: {
        location: '医院走廊窗边',
        videoPrompt: '年轻男子停在窗边回头',
      },
    })

    expect(prompt).toContain('从首帧自然运动到尾帧')
    expect(prompt).toContain('尾帧动作目标: 年轻男子停在窗边回头')
    expect(prompt).toContain('尾帧场景: 医院走廊窗边')
  })
})
