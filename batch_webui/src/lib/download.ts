/** Save a fetched blob without navigating away, so progress and selection survive. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoke on the next tick: a browser may not have started the download yet when
  // click() returns, and revoking early cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
