import type { DocRow } from '../api/types'

interface Props {
  rows: DocRow[]
  selected: Set<string>
  onToggle: (path: string) => void
  onToggleAll: (checked: boolean) => void
  onPreview: (path: string) => void
  onDownload?: (path: string) => void
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  queued: 'bg-amber-100 text-amber-800',
  running: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  skipped: 'bg-slate-100 text-slate-600',
  converted: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export function DocumentsTable({ rows, selected, onToggle, onToggleAll, onPreview, onDownload }: Props) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.path))
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <tr>
          <th className="p-2">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={allSelected}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
          </th>
          <th className="p-2">Document</th>
          <th className="p-2">Status</th>
          <th className="p-2">Pages</th>
          <th className="p-2">Seconds</th>
          <th className="p-2">Page/s</th>
          <th className="p-2">Error</th>
          <th className="p-2">Download</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
            <td className="p-2">
              <input
                type="checkbox"
                aria-label={`Select ${row.path}`}
                checked={selected.has(row.path)}
                onChange={() => onToggle(row.path)}
              />
            </td>
            <td className="p-2">
              <button
                type="button"
                disabled={!row.has_result}
                onClick={() => row.has_result && onPreview(row.path)}
                className={row.has_result ? 'text-blue-700 hover:underline dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}
              >
                {row.path}
              </button>
            </td>
            <td className="p-2">
              <span
                className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[row.status] ?? ''}`}
                title={row.status === 'skipped' ? 'already existed' : undefined}
              >
                {row.status}
              </span>
            </td>
            <td className="p-2">{row.pages ?? '—'}</td>
            <td className="p-2">{row.seconds != null ? row.seconds.toFixed(1) : '—'}</td>
            <td className="p-2">{row.rate ?? '—'}</td>
            <td className="p-2 text-red-700 dark:text-red-400">{row.error ?? ''}</td>
            <td className="p-2">
              {row.has_result && onDownload && (
                <button
                  type="button"
                  aria-label={`Download ${row.path}`}
                  onClick={() => onDownload(row.path)}
                  className="text-blue-700 hover:underline dark:text-blue-300"
                >
                  Download
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
