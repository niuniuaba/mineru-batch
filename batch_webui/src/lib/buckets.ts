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
  return BY_STATUS[status]
}

export function matchesBucket(row: DocRow, bucket: Bucket): boolean {
  return bucket === 'all' || bucketOf(row.status) === bucket
}
