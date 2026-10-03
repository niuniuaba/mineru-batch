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
