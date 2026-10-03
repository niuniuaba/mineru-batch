import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as api from '../api/mineru'
import type { DocumentsResponse, StatusResponse } from '../api/types'
import { useBatchApi } from './useBatchApi'

vi.mock('../api/mineru', () => ({
  getStatus: vi.fn(),
  getDocuments: vi.fn(),
  clearInput: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  deleteDocuments: vi.fn(),
  uploadFiles: vi.fn(),
  downloadResult: vi.fn(),
  zipResults: vi.fn(),
  getContent: vi.fn(),
}))

const status = (over: Partial<StatusResponse> = {}): StatusResponse =>
  ({
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
    ...over,
  }) as StatusResponse

const documents = (counts: Record<string, number> = {}): DocumentsResponse =>
  ({ state: 'idle', counts, files: [] }) as DocumentsResponse

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

async function mounted() {
  mockApi.getStatus.mockResolvedValue(status())
  mockApi.getDocuments.mockResolvedValue(documents())
  const view = renderHook(() => useBatchApi())
  await waitFor(() => expect(view.result.current.status).not.toBeNull())
  return view
}

describe('useBatchApi', () => {
  it('keeps a failed action visible instead of clearing it on the next poll', async () => {
    // The poll used to call setError(null) on every success, wiping the banner before it
    // was painted, so a failed delete or clear looked like a silent no-op.
    const { result } = await mounted()
    mockApi.clearInput.mockRejectedValueOnce(new Error('refusing to clear while a run is in progress'))

    await act(async () => {
      await result.current.clear()
    })
    expect(result.current.error).toBe('refusing to clear while a run is in progress')

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBe('refusing to clear while a run is in progress')
  })

  it('clears a connection error once the server answers again', async () => {
    mockApi.getStatus.mockRejectedValueOnce(new Error('Network Error'))
    mockApi.getDocuments.mockRejectedValueOnce(new Error('Network Error'))
    const { result } = renderHook(() => useBatchApi())

    await waitFor(() => expect(result.current.connected).toBe(false))
    expect(result.current.error).toBe('Network Error')

    mockApi.getStatus.mockResolvedValue(status())
    mockApi.getDocuments.mockResolvedValue(documents())
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.connected).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('starts a queued batch once when the blocking run finishes', async () => {
    mockApi.getStatus.mockResolvedValue(status({ state: 'running' }))
    mockApi.getDocuments.mockResolvedValue(documents({ pending: 2 }))
    mockApi.startRun.mockRejectedValue(Object.assign(new Error('a run is already in progress'), { status: 409 }))
    const { result } = renderHook(() => useBatchApi())
    await waitFor(() => expect(result.current.status).not.toBeNull())
    mockApi.startRun.mockReset()

    // The drop is queued behind the running job…
    mockApi.uploadFiles.mockResolvedValue({ count: 2 })
    await act(async () => {
      await result.current.submit([{ file: new File(['x'], 'a.pdf'), relative: 'a.pdf' }])
    })

    // …and starts when the run finishes.
    mockApi.getStatus.mockResolvedValue(status({ state: 'done' }))
    mockApi.getDocuments.mockResolvedValue(documents({ pending: 2 }))
    mockApi.startRun.mockResolvedValue({ started: true, documents: 2 })
    await act(async () => {
      await result.current.refresh()
    })
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockApi.startRun).toHaveBeenCalledTimes(1)
  })

  it('does not filter a drop before the suffix list has arrived', async () => {
    // The realistic case: the tab opens while the server is still starting, so no poll
    // has succeeded and the allowed-suffix list is empty.
    mockApi.getStatus.mockRejectedValue(new Error('still starting'))
    mockApi.getDocuments.mockRejectedValue(new Error('still starting'))
    const { result } = renderHook(() => useBatchApi())
    mockApi.uploadFiles.mockResolvedValue({ count: 1 })
    mockApi.startRun.mockResolvedValue({ started: true, documents: 1 })

    await act(async () => {
      await result.current.submit([{ file: new File(['x'], 'notes.txt'), relative: 'notes.txt' }])
    })

    expect(mockApi.uploadFiles).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBeNull()
  })
})
