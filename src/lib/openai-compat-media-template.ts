export type TemplateHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type TemplateContentType =
  | 'application/json'
  | 'multipart/form-data'
  | 'application/x-www-form-urlencoded'

export type TemplateHeaderMap = Record<string, string>

export type TemplateBodyValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: TemplateBodyValue }
  | TemplateBodyValue[]

export interface TemplateEndpoint {
  method: TemplateHttpMethod
  path: string
  contentType?: TemplateContentType
  headers?: TemplateHeaderMap
  bodyTemplate?: TemplateBodyValue
  multipartFileFields?: string[]
}

export interface TemplateResponseMap {
  taskIdPath?: string
  statusPath?: string
  outputUrlPath?: string
  outputUrlsPath?: string
  /** JSONPath to a base64-encoded image string. Used by GPT Image series (gpt-image-1/1.5/2)
   * which always return `data[0].b64_json` and never expose URLs. Will be wrapped to a
   * `data:<mime>;base64,...` URL downstream. */
  outputBase64Path?: string
  /** MIME type for outputBase64Path. Defaults to image/png. */
  outputMimeType?: string
  errorPath?: string
}

export interface TemplatePollingConfig {
  intervalMs: number
  timeoutMs: number
  doneStates: string[]
  failStates: string[]
}

export interface OpenAICompatMediaTemplate {
  version: 1
  mediaType: 'image' | 'video'
  mode: 'sync' | 'async'
  create: TemplateEndpoint
  status?: TemplateEndpoint
  content?: TemplateEndpoint
  response: TemplateResponseMap
  polling?: TemplatePollingConfig
}

export type OpenAICompatMediaTemplateSource = 'ai' | 'manual'

export const TEMPLATE_PLACEHOLDER_ALLOWLIST = new Set([
  'model',
  'prompt',
  'image',
  'images',
  'aspect_ratio',
  'duration',
  'resolution',
  'size',
  'task_id',
])
