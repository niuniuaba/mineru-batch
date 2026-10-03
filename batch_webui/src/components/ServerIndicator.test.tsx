import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { StatusResponse } from '../api/types'
import { ServerIndicator } from './ServerIndicator'

const status = {
  state: 'idle',
  counts: {},
  files: [],
  config: {
    records: [],
    input_dir: '/root/ee-in',
    output_dir: '/root/ee-md',
    queued_in_input: 4,
    supported_suffixes: ['.pdf'],
    environment: { mineru_version: '4.0.8', device: 'cpu', resolved_small_backend: 'onnx' },
    disk: { free: 1, total: 2 },
  },
} as unknown as StatusResponse

describe('ServerIndicator', () => {
  it('says it is connected when the server answers', () => {
    render(<ServerIndicator connected status={status} />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('says it is disconnected when the server does not', () => {
    render(<ServerIndicator connected={false} status={status} />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('reveals the server facts on demand', async () => {
    render(<ServerIndicator connected status={status} />)
    expect(screen.queryByText(/4\.0\.8/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /connected/i }))
    expect(screen.getByText(/4\.0\.8/)).toBeInTheDocument()
    expect(screen.getByText('/root/ee-md')).toBeInTheDocument()
    expect(screen.getByText(/queued/)).toBeInTheDocument()
  })
})
