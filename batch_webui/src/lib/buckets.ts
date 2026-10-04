import type { DocRow, DocStatus } from '../api/types'

export type Bucket = 'all' | 'pending' | 'running' | 'converted' | 'failed'

export const BUCKETS: Bucket[] = ['all', 'pending', 'running', 'converted', 'failed']

const BY_STATUS: Record<DocStatus, Exclude<Bucket, 'all'>> = {
  pending: 'pending',
  queued: 'running',
  running: 'running',
  done: 'converted',
  skipped: 'converted',
  converted: 'converted',
  failed: 'failed',
}

/** The user-facing bucket a raw server status belongs to. */
export function bucketOf(status: DocStatus): Exclude<Bucket, 'all'> {
  // The statuses arrive from the network unchecked; an unrecognised one must still land
  // in a bucket the user can act on rather than becoming NaN in the counts.
  return BY_STATUS[status] ?? 'pending'
}

export function matchesBucket(row: DocRow, bucket: Bucket): boolean {
  return bucket === 'all' || bucketOf(row.status) === bucket
}

/** Counts per filter tab. The tabs are buckets, so raw statuses must not be counted directly. */
export function bucketCounts(rows: DocRow[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { all: rows.length, pending: 0, running: 0, converted: 0, failed: 0 }
  for (const row of rows) counts[bucketOf(row.status)] += 1
  return counts
}

const FINISHED: DocStatus[] = ['done', 'skipped', 'converted']

/**
 * Whether a run would still have work for this document. The engine skips anything whose
 * result already exists, so this is exactly the set a resume would convert.
 */
export function isResumable(row: DocRow): boolean {
  return !FINISHED.includes(row.status)
}
