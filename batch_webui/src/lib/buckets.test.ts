import { describe, expect, it } from 'vitest'
import { bucketOf } from './buckets'

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

  it('keeps pending and failed distinct', () => {
    expect(bucketOf('pending')).toBe('pending')
    expect(bucketOf('failed')).toBe('failed')
  })
})
