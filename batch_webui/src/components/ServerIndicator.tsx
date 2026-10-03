import { useState } from 'react'
import type { StatusResponse } from '../api/types'

interface Props {
  connected: boolean
  status: StatusResponse | null
  lastCheck: Date | null
  latencyMs: number | null
}

/**
 * Always-visible answer to "is this thing alive" — the service is unauthenticated and may
 * be reached across a flaky LAN, so the state should never be a guess. Fed by the poll the
 * console already runs; there is no second timer.
 */
export function ServerIndicator({ connected, status, lastCheck, latencyMs }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed right-4 bottom-4 flex items-center gap-2 text-xs select-none">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center gap-2 opacity-80">
        <span
          className={`h-3 w-3 rounded-full transition-all duration-300 ${
            connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
          }`}
        />
        <span className="text-slate-500">{connected ? 'Connected' : 'Disconnected'}</span>
      </button>
      {open && (
        <div className="absolute right-4 bottom-8 w-80 rounded border bg-white p-3 text-left shadow-lg">
          <p>
            <strong>server</strong> {window.location.origin}
          </p>
          <p>
            <strong>last check</strong> {lastCheck ? lastCheck.toLocaleTimeString() : 'never'}
            {latencyMs != null && ` (${latencyMs} ms)`}
          </p>
          {status && (
            <>
              <p>
                <strong>storage</strong> {status.config.output_dir}
              </p>
              <p>
                <strong>queued</strong> {status.config.queued_in_input}
              </p>
              <p>
                <strong>mineru</strong> {status.config.environment.mineru_version}
              </p>
              <p>
                <strong>device</strong> {status.config.environment.device}
                {status.config.environment.resolved_small_backend &&
                  ` · ${status.config.environment.resolved_small_backend}`}
              </p>
              <p>
                <strong>run</strong> {status.state}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
