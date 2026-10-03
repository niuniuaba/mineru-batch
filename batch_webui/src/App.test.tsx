import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import * as api from './api/mineru'

vi.mock('./api/mineru', () => ({
  getStatus: vi.fn(() =>
    Promise.resolve({
      state: 'idle',
      pid: null,
      current_file: null,
      window: '',
      message: '',
      returncode: null,
      total: 0,
      started_at: null,
      ended_at: null,
      counts: {},
      files: [],
      config: {
        records: [],
        input_dir: '/root/ee-in',
        output_dir: '/root/ee-md',
        queued_in_input: 0,
        supported_suffixes: ['.pdf'],
        environment: { mineru_version: '4.0.8', device: 'cpu', resolved_small_backend: 'onnx' },
        disk: { free: 1, total: 2 },
      },
    }),
  ),
  getDocuments: vi.fn(() => Promise.resolve({ state: 'idle', counts: {}, files: [] })),
  clearInput: vi.fn(() => Promise.resolve({ removed: 0 })),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  deleteDocuments: vi.fn(),
  uploadFiles: vi.fn(),
  downloadResult: vi.fn(),
  zipResults: vi.fn(),
  getContent: vi.fn(),
}))

describe('App', () => {
  it('asks before clearing the input directory, and does not clear on cancel', async () => {
    render(<App />)
    const clear = await screen.findByRole('button', { name: /clear input/i })
    await userEvent.click(clear)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.clearInput).not.toHaveBeenCalled()
  })

  it('clears only after the dialog is confirmed', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /clear input/i }))
    // The dialog's confirm button is the second "Clear input" on screen.
    const buttons = screen.getAllByRole('button', { name: /clear input/i })
    await userEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(api.clearInput).toHaveBeenCalled())
  })

  it('shows the server parameters on demand', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /server parameters/i }))
    expect(screen.getByRole('button', { name: /hide server parameters/i })).toBeInTheDocument()
  })
})
