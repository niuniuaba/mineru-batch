import { describe, expect, it } from 'vitest'
import { bucketCounts, bucketOf } from './buckets'
import type { DocRow } from '../api/types'

const row = (status: DocRow['status']): DocRow => ({
  path: `${status}.md`,
  status,
  pages: null,
  seconds: null,
  rate: null,
  bytes: null,
  error: null,
  has_input: false,
  has_result: false,
})

describe('bucketOf', () => {
  it('folds both done and skipped into converted', () => {
    expect(bucketOf('done')).toBe('converted')
    expect(bucketOf('skipped')).toBe('converted')
    expect(bucketOf('converted')).toBe('converted')
  })

  it('treats queued as running, because it is behind an active run', () => {
    expect(bucketOf('queued')).toBe('running')
    expect(bucketOf('running')).toBe('running')
  })

  it('falls back to pending for a status the console does not know', () => {
    expect(bucketOf('cancelled' as DocRow['status'])).toBe('pending')
  })

  it('keeps pending and failed distinct', () => {
    expect(bucketOf('pending')).toBe('pending')
    expect(bucketOf('failed')).toBe('failed')
  })
})

describe('bucketCounts', () => {
  it('counts by bucket, not by raw status', () => {
    const counts = bucketCounts([row('done'), row('skipped'), row('queued'), row('pending'), row('failed')])
    expect(counts).toEqual({ all: 5, converted: 2, running: 1, pending: 1, failed: 1 })
  })

  it('reports zero for empty buckets rather than omitting them', () => {
    expect(bucketCounts([row('converted')])).toEqual({ all: 1, converted: 1, running: 0, pending: 0, failed: 0 })
  })
})
