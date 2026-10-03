import type { StatusResponse } from '../api/types'

interface Props {
  status: StatusResponse | null
  onStop: () => void
  onClear: () => void
}

export function RunStatusBar({ status, onStop, onClear }: Props) {
  if (!status) return null
  const running = status.state === 'running'
  const done = status.counts.done ?? 0
  const failed = status.counts.failed ?? 0
  const total = status.total || 0
  return (
    <div className="flex flex-wrap items-center gap-4 rounded border bg-white p-3 text-sm">
      <span className={`rounded px-2 py-0.5 ${running ? 'bg-blue-100 text-blue-800' : 'bg-slate-100'}`}>
        {status.state}
      </span>
      <span>
        {done + failed}/{total} processed · {failed} failed
      </span>
      {status.current_file && (
        <span className="text-slate-600">
          converting {status.current_file} {status.window && `· ${status.window}`}
        </span>
      )}
      {status.message && <span className="text-slate-600">{status.message}</span>}
      <div className="ml-auto flex gap-2">
        <button type="button" disabled={!running} onClick={onStop} className="rounded border px-3 py-1 disabled:opacity-40">
          Stop
        </button>
        <button type="button" disabled={running} onClick={onClear} className="rounded border px-3 py-1 disabled:opacity-40">
          Clear input
        </button>
      </div>
    </div>
  )
}
