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
