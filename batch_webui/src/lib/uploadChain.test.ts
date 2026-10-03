import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { partitionBySuffix, runUploadChain, shouldStartQueuedRun } from './uploadChain'

const file = () => new File(['x'], 'a.pdf')

describe('runUploadChain', () => {
  it('uploads then starts', async () => {
    const upload = vi.fn().mockResolvedValue({ count: 1 })
    const start = vi.fn().mockResolvedValue({ started: true, documents: 1 })
    const result = await runUploadChain([{ file: file(), relative: 'a.pdf' }], { upload, start })
    expect(result).toEqual({ uploaded: 1, started: true, queuedBehindRun: false })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('treats a 409 on start as queued, not as a failure', async () => {
    const upload = vi.fn().mockResolvedValue({ count: 1 })
    const start = vi.fn().mockRejectedValue(new ApiError('a run is already in progress', 409))
    const result = await runUploadChain([{ file: file(), relative: 'a.pdf' }], { upload, start })
    expect(result).toEqual({ uploaded: 1, started: false, queuedBehindRun: true })
  })

  it('propagates upload failures', async () => {
    const upload = vi.fn().mockRejectedValue(new ApiError('exceeds the limit', 413))
    const start = vi.fn()
    await expect(runUploadChain([{ file: file(), relative: 'a.pdf' }], { upload, start })).rejects.toThrow(
      'exceeds the limit',
    )
    expect(start).not.toHaveBeenCalled()
  })
})

describe('shouldStartQueuedRun', () => {
  it('starts only when armed, idle, and something is waiting', () => {
    expect(shouldStartQueuedRun(true, 'idle', 3)).toBe(true)
  })

  it('does not start while another run holds the lock', () => {
    expect(shouldStartQueuedRun(true, 'running', 3)).toBe(false)
  })

  it('does not start when nothing is pending', () => {
    expect(shouldStartQueuedRun(true, 'idle', 0)).toBe(false)
  })

  it('does not start unless a 409 armed it', () => {
    expect(shouldStartQueuedRun(false, 'idle', 3)).toBe(false)
  })
})

describe('partitionBySuffix', () => {
  const item = (relative: string) => ({ file: file(), relative })

  it('keeps what the runner can parse and names what it cannot', () => {
    const result = partitionBySuffix([item('a.pdf'), item('notes.txt')], ['.pdf', '.docx'])
    expect(result.accepted.map((i) => i.relative)).toEqual(['a.pdf'])
    expect(result.rejected).toEqual(['notes.txt'])
  })

  it('matches the suffix case-insensitively', () => {
    expect(partitionBySuffix([item('A.PDF')], ['.pdf']).accepted).toHaveLength(1)
  })

  it('rejects a file with no extension', () => {
    expect(partitionBySuffix([item('README')], ['.pdf']).rejected).toEqual(['README'])
  })

  it('rejects everything when the server declares nothing', () => {
    expect(partitionBySuffix([item('a.pdf')], []).rejected).toEqual(['a.pdf'])
  })
})
