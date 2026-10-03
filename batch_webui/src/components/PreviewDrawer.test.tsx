import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreviewDrawer } from './PreviewDrawer'

const getContent = vi.fn()
vi.mock('../api/mineru', () => ({
  getContent: (path: string) => getContent(path),
  downloadResult: () => Promise.resolve(new Blob(['x'])),
}))

describe('PreviewDrawer', () => {
  it('renders nothing without a path', () => {
    getContent.mockClear()
    const { container } = render(<PreviewDrawer path={null} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    expect(getContent).not.toHaveBeenCalled()
  })

  it('renders the converted markdown', async () => {
    getContent.mockClear()
    getContent.mockResolvedValue('# Title\n\nbody text')
    render(<PreviewDrawer path="a.md" onClose={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('body text')).toBeInTheDocument()
    expect(getContent).toHaveBeenCalledWith('a.md')
  })

  it('makes an omitted figure visible instead of dropping it', async () => {
    getContent.mockClear()
    getContent.mockResolvedValue('before\n<!-- figure omitted: ImageBlock -->\nafter')
    render(<PreviewDrawer path="a.md" onClose={() => {}} />)
    expect(await screen.findByText(/figure omitted: ImageBlock/)).toBeInTheDocument()
  })

  it('offers a download for the same document', async () => {
    getContent.mockClear()
    getContent.mockResolvedValue('# t')
    render(<PreviewDrawer path="papers/a b.md" onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: /download/i })).toBeInTheDocument()
  })

  it('surfaces a fetch failure', async () => {
    getContent.mockClear()
    getContent.mockImplementation(() => Promise.reject(new Error('not a converted markdown file: a.md')))
    render(<PreviewDrawer path="a.md" onClose={() => {}} />)
    expect(await screen.findByText(/not a converted markdown file/)).toBeInTheDocument()
  })

  it('closes when asked', async () => {
    getContent.mockResolvedValue('# t')
    const onClose = vi.fn()
    render(<PreviewDrawer path="a.md" onClose={onClose} />)
    ;(await screen.findByRole('button', { name: /close preview/i })).click()
    expect(onClose).toHaveBeenCalled()
  })
})
