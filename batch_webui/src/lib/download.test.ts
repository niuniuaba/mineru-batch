import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('attaches the anchor, saves, and revokes the URL well after the hand-off', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:xyz')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    // A real anchor, so appendChild accepts it; only the side effects are spied.
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const remove = vi.spyOn(anchor, 'remove').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const appendChild = vi.spyOn(document.body, 'appendChild')

    downloadBlob(new Blob(['x']), 'mineru-markdown.zip')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchor.href).toBe('blob:xyz')
    expect(anchor.download).toBe('mineru-markdown.zip')
    // Firefox/Safari need the anchor in the document for `download` to take effect.
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()

    // Not revoked on the next tick: that is early enough to cancel a large save.
    vi.advanceTimersByTime(0)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:xyz')
  })
})
