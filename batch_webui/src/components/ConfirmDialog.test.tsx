import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

const base = {
  title: 'Delete 2 document(s)?',
  body: 'The input file and its converted Markdown are both removed. This cannot be undone.',
  confirmLabel: 'Delete',
  onConfirm: () => {},
  onCancel: () => {},
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ConfirmDialog open={false} {...base} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('states what will happen, not just asks', () => {
    render(<ConfirmDialog open {...base} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })

  it('confirms', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open {...base} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels without confirming', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open {...base} onConfirm={onConfirm} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
