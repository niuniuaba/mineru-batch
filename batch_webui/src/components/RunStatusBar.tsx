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
  const skipped = status.counts.skipped ?? 0
  const failed = status.counts.failed ?? 0
  const total = status.total || 0
  return (
    <div className="flex flex-wrap items-center gap-4 rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
      <span className={`rounded px-2 py-0.5 ${running ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100' : 'bg-slate-100 dark:bg-slate-700'}`}>
        {status.state}
      </span>
      <span data-testid="run-counts">
        {/* skipped is terminal: a resumed run converts nothing but is finished */}
        {done + skipped + failed}/{total} processed · {failed} failed ·{' '}
        <span title="Documents the runner would pick up from the input directory">
          {status.config.queued_in_input} in input folder
        </span>
      </span>
      {status.current_file && (
        <span className="text-slate-600 dark:text-slate-300">
          converting {status.current_file} {status.window && `· ${status.window}`}
        </span>
      )}
      {status.message && <span className="text-slate-600 dark:text-slate-300">{status.message}</span>}
      <div className="ml-auto flex gap-2">
        <button type="button" disabled={!running} onClick={onStop} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600">
          Stop
        </button>
        <button type="button" disabled={running} onClick={onClear} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600">
          Clear input
        </button>
      </div>
    </div>
  )
}
