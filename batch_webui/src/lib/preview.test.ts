import { describe, expect, it, vi } from 'vitest'
import { loadPreview } from './preview'

describe('loadPreview', () => {
  it('renders the markdown, including omitted-figure markers', async () => {
    const fetch = vi.fn().mockResolvedValue('# t\n<!-- figure omitted: ImageBlock -->')
    const state = await loadPreview(fetch, 'a.md')
    expect(state.error).toBeNull()
    expect(state.text).toContain('# t')
    expect(state.text).toContain('figure omitted: ImageBlock')
    expect(fetch).toHaveBeenCalledWith('a.md')
  })

  it('returns the message instead of throwing when the fetch fails', async () => {
    const fetch = () => Promise.reject(new Error('not a converted markdown file: a.md'))
    const state = await loadPreview(fetch, 'a.md')
    expect(state.text).toBeNull()
    expect(state.error).toBe('not a converted markdown file: a.md')
  })

  it('describes a non-Error rejection too', async () => {
    const state = await loadPreview(() => Promise.reject('boom'), 'a.md')
    expect(state.error).toBe('boom')
  })
})
