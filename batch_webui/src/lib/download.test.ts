import { describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

describe('downloadBlob', () => {
  it('saves the blob through an object URL and revokes it', async () => {
    const createObjectURL = vi.fn(() => 'blob:xyz')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    const click = vi.fn()
    const anchor = { href: '', download: '', click }
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement)

    downloadBlob(new Blob(['x']), 'mineru-markdown.zip')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchor.href).toBe('blob:xyz')
    expect(anchor.download).toBe('mineru-markdown.zip')
    expect(click).toHaveBeenCalledOnce()

    // Revoked on the next tick, not synchronously: a browser may not have started the
    // download yet when click() returns.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:xyz')

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
