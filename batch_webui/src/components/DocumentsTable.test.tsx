import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DocRow } from '../api/types'
import { DocumentsTable } from './DocumentsTable'

const row = (over: Partial<DocRow>): DocRow => ({
  path: 'a.md',
  status: 'converted',
  pages: 2,
  seconds: 1,
  rate: 2,
  bytes: 10,
  error: null,
  has_input: true,
  has_result: true,
  ...over,
})

const props = {
  selected: new Set<string>(),
  onToggle: () => {},
  onToggleAll: () => {},
  onPreview: () => {},
}

describe('DocumentsTable', () => {
  it('renders a row per document', () => {
    render(<DocumentsTable rows={[row({}), row({ path: 'b.md' })]} {...props} />)
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2
  })

  it('asks to preview when a converted row is clicked', async () => {
    const onPreview = vi.fn()
    render(<DocumentsTable rows={[row({})]} {...props} onPreview={onPreview} />)
    await userEvent.click(screen.getByText('a.md'))
    expect(onPreview).toHaveBeenCalledWith('a.md')
  })

  it('does not preview a row with no result', async () => {
    const onPreview = vi.fn()
    render(<DocumentsTable rows={[row({ status: 'pending', has_result: false })]} {...props} onPreview={onPreview} />)
    await userEvent.click(screen.getByText('a.md'))
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('shows a failure reason', () => {
    render(<DocumentsTable rows={[row({ status: 'failed', error: 'ValueError: bad pdf' })]} {...props} />)
    expect(screen.getByText(/ValueError/)).toBeInTheDocument()
  })

  it('reports a toggled row', async () => {
    const onToggle = vi.fn()
    render(<DocumentsTable rows={[row({})]} {...props} onToggle={onToggle} />)
    await userEvent.click(screen.getByLabelText('Select a.md'))
    expect(onToggle).toHaveBeenCalledWith('a.md')
  })

  it('selects every visible row from the header box', async () => {
    const onToggleAll = vi.fn()
    render(<DocumentsTable rows={[row({}), row({ path: 'b.md' })]} {...props} onToggleAll={onToggleAll} />)
    await userEvent.click(screen.getByLabelText('Select all'))
    expect(onToggleAll).toHaveBeenCalledWith(true)
  })

  it('shows the selection state on a row box', () => {
    render(<DocumentsTable rows={[row({})]} {...props} selected={new Set(['a.md'])} />)
    expect(screen.getByLabelText('Select a.md')).toBeChecked()
  })
})

describe('per-row download', () => {
  it('offers a download for a converted row', async () => {
    const onDownload = vi.fn()
    render(<DocumentsTable rows={[row({})]} {...props} onDownload={onDownload} />)
    await userEvent.click(screen.getByRole('button', { name: /download a.md/i }))
    expect(onDownload).toHaveBeenCalledWith('a.md')
  })

  it('offers no download for a row without a result', () => {
    render(<DocumentsTable rows={[row({ status: 'pending', has_result: false })]} {...props} onDownload={() => {}} />)
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
  })
})
