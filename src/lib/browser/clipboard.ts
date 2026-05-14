export async function copyTextToClipboard(text: string): Promise<void> {
  const clipboardApi = globalThis.navigator?.clipboard
  if (clipboardApi && typeof clipboardApi.writeText === 'function') {
    try {
      await clipboardApi.writeText(text)
      return
    } catch {
      // Non-HTTPS deployments often reject navigator.clipboard; use DOM fallback.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard unavailable')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  textarea.style.opacity = '0'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('Clipboard fallback failed')
  }
}
