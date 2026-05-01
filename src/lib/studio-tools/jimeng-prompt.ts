/**
 * 即梦视频提示词组装器。
 *
 * 即梦官网（dreamina.capcut.com）目前没有开放 API。
 * 本工具模块走"人在回路"方案：
 *   1. 用户在工具页填写场景信息（角色 / 动作 / 镜头 / 风格）
 *   2. 系统拼装出符合即梦提示词规范的文本
 *   3. 用户复制到即梦官网生成视频
 *   4. 用户回传 mp4 到本系统，关联面板/项目
 *
 * 即梦提示词的有效结构（来自实测经验）：
 *   主体 + 动作 + 镜头语言 + 光线 + 风格 + 时长
 *
 * 例：
 *   一位身着青蓝色长袍的老者，正在缓缓抬起右手抚摸瓷瓶，
 *   特写镜头，暖色侧光，纪录片写实风格，5秒。
 */

export interface JimengPromptInput {
  /** 主体描述：角色或物体（必填）。例："一位身着青蓝色长袍的老者" */
  subject: string
  /** 动作描述：主体在做什么。例："缓缓抬起右手抚摸瓷瓶" */
  action?: string
  /** 镜头语言：景别 / 运镜。例："特写镜头" "中景缓推" */
  cameraLanguage?: string
  /** 光线 / 氛围。例："暖色侧光" "清晨柔光" */
  lighting?: string
  /** 视觉风格。例："纪录片写实" "国漫水墨" "电影级" */
  style?: string
  /** 时长（秒），即梦支持 5/10。 */
  durationSec?: 5 | 10
  /** 额外补充：场景细节、氛围等。 */
  extra?: string
  /** 是否包含负面提示。 */
  negative?: string
}

export interface JimengPromptOutput {
  /** 拼接好的中文提示词，直接复制到即梦输入框。 */
  prompt: string
  /** 推荐的负面提示。 */
  negative?: string
  /** 拼装时使用的字段（便于前端展示已填项）。 */
  parts: string[]
}

/**
 * 把结构化字段拼成即梦风格的中文提示词。
 *
 * 设计原则：
 *  - 留白：缺省字段直接跳过，不强行模板化
 *  - 顺序：主体 → 动作 → 镜头 → 光线 → 风格 → 时长 → 补充
 *  - 标点：用中文逗号衔接，符合即梦中文输入习惯
 */
export function composeJimengPrompt(input: JimengPromptInput): JimengPromptOutput {
  const subject = input.subject.trim()
  if (!subject) {
    throw new Error('JIMENG_PROMPT: subject is required')
  }

  const parts: string[] = [subject]

  const action = input.action?.trim()
  if (action) parts.push(action)

  const cam = input.cameraLanguage?.trim()
  if (cam) parts.push(cam)

  const light = input.lighting?.trim()
  if (light) parts.push(light)

  const style = input.style?.trim()
  if (style) parts.push(`${style}风格`)

  if (input.durationSec === 5 || input.durationSec === 10) {
    parts.push(`${input.durationSec}秒`)
  }

  const extra = input.extra?.trim()
  if (extra) parts.push(extra)

  const prompt = parts.join('，') + '。'

  return {
    prompt,
    negative: input.negative?.trim() || undefined,
    parts,
  }
}

/**
 * 即梦官网入口（带新窗口跳转）。
 */
export const JIMENG_WEBSITE_URL = 'https://jimeng.jianying.com/ai-tool/video/generate'
