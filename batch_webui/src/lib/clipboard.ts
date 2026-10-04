/**
 * Copy text to the clipboard, over a plain-HTTP LAN origin where it is not obvious how.
 *
 * `navigator.clipboard` exists only in a secure context. This console is served on
 * 0.0.0.0 and reached as `http://<lan-ip>:8090`, which is not one, so the async API is
 * simply absent there — and optional chaining turns calling it into a silent no-op.
 * The legacy `execCommand` path is not secure-context gated, so it is the fallback.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Refused, most often because the document is not focused. Try the legacy path.
    }
  }

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off-screen rather than hidden: a hidden element cannot hold a selection.
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  document.body.appendChild(area)
  try {
    area.select()
    area.setSelectionRange(0, area.value.length)
    if (!document.execCommand?.('copy')) {
      throw new Error('the browser refused to copy to the clipboard')
    }
  } finally {
    area.remove()
  }
}
