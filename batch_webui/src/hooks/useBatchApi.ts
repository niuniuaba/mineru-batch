import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api/mineru'
import type { DocumentsResponse, StatusResponse } from '../api/types'
import { runUploadChain, shouldStartQueuedRun, type UploadItem } from '../lib/uploadChain'

const ACTIVE_INTERVAL_MS = 1500
const IDLE_INTERVAL_MS = 5000

export function useBatchApi() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [documents, setDocuments] = useState<DocumentsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [busy, setBusy] = useState(false)
  // Armed by a 409: documents landed while another run held the lock.
  const pendingStart = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDocuments] = await Promise.all([api.getStatus(), api.getDocuments()])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
      setConnected(true)
      setError(null)
      if (shouldStartQueuedRun(pendingStart.current, nextStatus.state, nextDocuments.counts.pending ?? 0)) {
        // Clear the flag first, so a slow start cannot be issued twice.
        pendingStart.current = false
        setBusy(true)
        try {
          await api.startRun()
        } catch {
          // Another client may have won the race; the next poll shows the truth.
        } finally {
          setBusy(false)
        }
      }
    } catch (failure) {
      setConnected(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      if (cancelled) return
      // A background tab must not compete with CPU-bound inference.
      if (document.visibilityState === 'visible') await refresh()
      if (cancelled) return
      const active = status?.state === 'running' || Boolean(documents?.counts.pending)
      timer = window.setTimeout(tick, active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [refresh, status?.state, documents?.counts.pending])

  const submit = useCallback(
    async (items: UploadItem[]) => {
      setBusy(true)
      try {
        const result = await runUploadChain(items, { upload: api.uploadFiles, start: api.startRun })
        pendingStart.current = result.queuedBehindRun
        await refresh()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const stop = useCallback(async () => {
    try {
      await api.stopRun()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    await refresh()
  }, [refresh])

  const clear = useCallback(async () => {
    try {
      await api.clearInput()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    await refresh()
  }, [refresh])

  const remove = useCallback(
    async (paths: string[]) => {
      try {
        await api.deleteDocuments(paths)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
      await refresh()
    },
    [refresh],
  )

  return { status, documents, error, connected, busy, refresh, submit, stop, clear, remove }
}
