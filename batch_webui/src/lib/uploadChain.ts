import { ApiError } from '../api/client'

export interface UploadItem {
  file: File
  relative: string
}

export interface UploadChainDeps {
  upload: (files: File[], relativePaths: string[], onProgress?: (fraction: number) => void) => Promise<{ count: number }>
  start: () => Promise<{ started: boolean; documents: number }>
}

export interface UploadChainResult {
  uploaded: number
  started: boolean
  queuedBehindRun: boolean
}

/**
 * The console's single action: choosing documents uploads them and starts the run.
 * A 409 means another run holds the lock — the documents are safely queued, not lost.
 */
export async function runUploadChain(
  items: UploadItem[],
  deps: UploadChainDeps,
  onProgress?: (fraction: number) => void,
): Promise<UploadChainResult> {
  const { count } = await deps.upload(
    items.map((item) => item.file),
    items.map((item) => item.relative),
    onProgress,
  )
  try {
    await deps.start()
    return { uploaded: count, started: true, queuedBehindRun: false }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { uploaded: count, started: false, queuedBehindRun: true }
    }
    throw error
  }
}

/**
 * Whether a run the client was blocked out of should now be started. The caller clears
 * its armed flag before starting, so a batch is started exactly once.
 */
export function shouldStartQueuedRun(armed: boolean, state: string, pendingCount: number): boolean {
  return armed && state !== 'running' && pendingCount > 0
}

/**
 * Split a drop into what the runner can parse and what it will ignore.
 *
 * The runner only picks up known suffixes, so an unsupported file would upload and then
 * silently never appear. Filtering here — against the list the server declares — makes
 * that visible instead.
 */
export function partitionBySuffix(
  items: UploadItem[],
  suffixes: string[],
): { accepted: UploadItem[]; rejected: string[] } {
  // An empty list means the status poll has not landed yet — not that nothing is
  // parseable. Filtering against it would reject an entire drop with a misleading notice.
  if (suffixes.length === 0) return { accepted: items, rejected: [] }
  const allowed = new Set(suffixes.map((suffix) => suffix.toLowerCase()))
  const accepted: UploadItem[] = []
  const rejected: string[] = []
  for (const item of items) {
    const dot = item.relative.lastIndexOf('.')
    const suffix = dot >= 0 ? item.relative.slice(dot).toLowerCase() : ''
    if (allowed.has(suffix)) accepted.push(item)
    else rejected.push(item.relative)
  }
  return { accepted, rejected }
}

/** The notice shown when a drop contained files the parser cannot read. */
export function skippedNotice(rejected: string[]): string | null {
  if (rejected.length === 0) return null
  const shown = rejected.slice(0, 3).join(', ')
  return `Skipped ${rejected.length} file(s) the parser cannot read: ${shown}${rejected.length > 3 ? ', …' : ''}`
}
