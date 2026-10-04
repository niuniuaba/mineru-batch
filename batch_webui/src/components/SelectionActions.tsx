import { zipResults } from '../api/mineru'
import { downloadBlob } from '../lib/download'

interface Props {
  selected: string[]
  /** How many of the selected documents have no result yet — the engine's resume set. */
  resumableCount: number
  onResume: () => void
  onDelete: () => void
  onClearSelection: () => void
  onError?: (message: string) => void
}

export function SelectionActions({
  selected,
  resumableCount,
  onResume,
  onDelete,
  onClearSelection,
  onError,
}: Props) {
  if (selected.length === 0) return null

  const downloadSelected = async () => {
    try {
      downloadBlob(await zipResults(selected), 'mineru-markdown.zip')
    } catch (failure) {
      onError?.(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800">
      <span>{selected.length} selected</span>
      <button type="button" onClick={downloadSelected} className="rounded bg-slate-900 px-3 py-1 text-white dark:bg-slate-100 dark:text-slate-900">
        Download selected
      </button>
      <button
        type="button"
        onClick={onResume}
        disabled={resumableCount === 0}
        title={
          resumableCount === 0
            ? 'Every selected document already has a result'
            : 'Converts every document without a result; finished ones are skipped'
        }
        className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
      >
        Resume{resumableCount > 0 ? ` ${resumableCount}` : ''}
      </button>
      <button type="button" onClick={onDelete} className="rounded border border-red-300 px-3 py-1 text-red-700 dark:border-red-800 dark:text-red-300">
        Delete selected
      </button>
      <button type="button" onClick={onClearSelection} className="text-slate-600 hover:underline dark:text-slate-300">
        Clear selection
      </button>
    </div>
  )
}
