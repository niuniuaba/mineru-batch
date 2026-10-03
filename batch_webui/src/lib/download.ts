/** Save a fetched blob without navigating away, so progress and selection survive. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  // Firefox and Safari have historically needed the anchor in the document for the
  // `download` attribute to take effect; a detached click can silently do nothing.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke well after the hand-off. Next-tick is still effectively immediate, and
  // revoking that early cancels large saves in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
