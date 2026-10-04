import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectionActions } from './SelectionActions'

const base = {
  selected: ['a.md'],
  resumableCount: 1,
  onResume: () => {},
  onDelete: () => {},
  onClearSelection: () => {},
}

describe('SelectionActions', () => {
  it('offers resume alongside the other bulk actions', () => {
    render(<SelectionActions {...base} />)
    expect(screen.getByRole('button', { name: /^resume 1$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download selected/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument()
  })

  it('says how many documents a resume would actually convert', () => {
    render(<SelectionActions {...base} selected={['a.md', 'b.md', 'c.md']} resumableCount={2} />)
    expect(screen.getByRole('button', { name: /^resume 2$/i })).toBeInTheDocument()
  })

  it('is disabled when every selection already has a result', () => {
    render(<SelectionActions {...base} resumableCount={0} />)
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeDisabled()
  })

  it('resumes when asked', async () => {
    const onResume = vi.fn()
    render(<SelectionActions {...base} onResume={onResume} />)
    await userEvent.click(screen.getByRole('button', { name: /^resume 1$/i }))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('renders nothing with an empty selection', () => {
    const { container } = render(<SelectionActions {...base} selected={[]} resumableCount={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
