import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import * as api from '../api/mineru'
import type { DocumentsResponse, StatusResponse } from '../api/types'
import { partitionBySuffix, runUploadChain, shouldStartQueuedRun, skippedNotice, type UploadItem } from '../lib/uploadChain'

const ACTIVE_INTERVAL_MS = 1500
const IDLE_INTERVAL_MS = 5000

export function useBatchApi() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [documents, setDocuments] = useState<DocumentsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  // Counted, not boolean: the poll's auto-start and a user action can be in flight at
  // once, and one must not clear the other's busy state.
  const [inFlight, setInFlight] = useState(0)

  const suffixes = useRef<string[]>([])
  const pendingStart = useRef(false)
  const runState = useRef<string>('idle')
  const pendingCount = useRef(0)
  const polling = useRef(false)
  const connectionError = useRef(false)

  const refresh = useCallback(async () => {
    // A slow poll must not stack up behind the next tick on a CPU-bound server.
    if (polling.current) return
    polling.current = true
    const startedAt = performance.now()
    try {
      const [nextStatus, nextDocuments] = await Promise.all([api.getStatus(), api.getDocuments()])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
      suffixes.current = nextStatus.config.supported_suffixes ?? []
      runState.current = nextStatus.state
      pendingCount.current = nextDocuments.counts.pending ?? 0
      setLastCheck(new Date())
      setLatencyMs(Math.round(performance.now() - startedAt))
      setConnected(true)
      // Clear only the error this poll is responsible for. Wiping it unconditionally
      // erased action failures before they could be painted, so a failed delete looked
      // like a silent no-op.
      if (connectionError.current) {
        connectionError.current = false
        setError(null)
      }
      if (shouldStartQueuedRun(pendingStart.current, nextStatus.state, nextDocuments.counts.pending ?? 0)) {
        // Clear the flag first, so a slow start cannot be issued twice.
        pendingStart.current = false
        setInFlight((count) => count + 1)
        try {
          await api.startRun()
        } catch (failure) {
          // A 409 means another client won the race; the next poll shows the truth.
          if (!(failure instanceof ApiError && failure.status === 409)) {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        } finally {
          setInFlight((count) => count - 1)
        }
      }
    } catch (failure) {
      connectionError.current = true
      setConnected(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      polling.current = false
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
      // Read the throttle from the refs: this effect no longer re-runs on every poll, so
      // values captured in the closure would be stale.
      const active = runState.current === 'running' || pendingCount.current > 0
      timer = window.setTimeout(tick, active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS)
    }

    void tick()
    // Coming back to the tab should not wait out a whole idle interval.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) window.clearTimeout(timer)
    }
  }, [refresh])

  const submit = useCallback(
    async (items: UploadItem[]) => {
      const { accepted, rejected } = partitionBySuffix(items, suffixes.current)
      setNotice(skippedNotice(rejected))
      if (accepted.length === 0) return
      setInFlight((count) => count + 1)
      try {
        const result = await runUploadChain(accepted, { upload: api.uploadFiles, start: api.startRun })
        pendingStart.current = result.queuedBehindRun
        await refresh()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setInFlight((count) => count - 1)
      }
    },
    [refresh],
  )

  const act = useCallback(
    async (operation: () => Promise<unknown>) => {
      setInFlight((count) => count + 1)
      try {
        await operation()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setInFlight((count) => count - 1)
        await refresh()
      }
    },
    [refresh],
  )

  const stop = useCallback(() => act(api.stopRun), [act])
  const clear = useCallback(() => act(api.clearInput), [act])
  const remove = useCallback((paths: string[]) => act(() => api.deleteDocuments(paths)), [act])

  return {
    status,
    documents,
    error,
    notice,
    connected,
    lastCheck,
    latencyMs,
    busy: inFlight > 0,
    refresh,
    submit,
    stop,
    clear,
    remove,
    reportError: setError,
  }
}
