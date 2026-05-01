import { NextRequest, NextResponse } from 'next/server'
import { uploadObject, generateUniqueKey, getSignedUrl } from '@/lib/storage'

/**
 * POST /api/studio-tools/jimeng/upload
 *
 * Accepts a video file uploaded by the user (downloaded from Jimeng website).
 * Stores it in MinIO/local storage and returns a fetchable URL + storage key.
 *
 * FormData:
 *   file: Blob (mp4/mov/webm, required)
 *   tag?: string (optional grouping tag, e.g. "panel-xxx" or "scene-1")
 *
 * Response 200:
 *   { key: string, url: string, sizeBytes: number, contentType: string }
 *
 * NOTE: This endpoint does NOT yet link the video to a panel/shot in the
 * novel-promotion pipeline. That linkage is a future TODO — for now this is a
 * standalone "upload my Jimeng video" tool. To attach to a panel, the user
 * can copy the URL into the panel's video field manually.
 */

const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // 200 MB
const ACCEPTED_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
])

function pickExtension(file: File): string {
  const name = file.name || ''
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx >= 0) {
    const ext = name.slice(dotIdx + 1).toLowerCase()
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext
  }
  // fallback by mime
  if (file.type === 'video/quicktime') return 'mov'
  if (file.type === 'video/webm') return 'webm'
  return 'mp4'
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 })
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: `file too large (>${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB)` },
      { status: 413 },
    )
  }
  if (file.type && !ACCEPTED_TYPES.has(file.type)) {
    // Don't hard-fail on unknown types — Jimeng outputs are always mp4 in practice.
    // But warn-level: continue.
  }

  const tagRaw = form.get('tag')
  const tag = typeof tagRaw === 'string' && /^[a-zA-Z0-9_-]{0,40}$/.test(tagRaw) ? tagRaw : ''

  const ext = pickExtension(file)
  const prefix = tag ? `jimeng/${tag}` : 'jimeng/manual'
  const key = generateUniqueKey(prefix, ext)

  const buffer = Buffer.from(await file.arrayBuffer())
  const contentType = file.type || 'video/mp4'

  try {
    const storedKey = await uploadObject(buffer, key, 3, contentType)
    return NextResponse.json({
      key: storedKey,
      url: getSignedUrl(storedKey),
      sizeBytes: buffer.length,
      contentType,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `upload failed: ${message}` }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
