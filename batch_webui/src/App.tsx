import { useMemo, useState } from 'react'
import { downloadResult } from './api/mineru'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DocumentsTable } from './components/DocumentsTable'
import { DropZone } from './components/DropZone'
import { FilterTabs } from './components/FilterTabs'
import { PreviewDrawer } from './components/PreviewDrawer'
import { RunStatusBar } from './components/RunStatusBar'
import { SelectionActions } from './components/SelectionActions'
import { ServerIndicator } from './components/ServerIndicator'
import { SettingsPanel } from './components/SettingsPanel'
import { useBatchApi } from './hooks/useBatchApi'
import { bucketCounts, matchesBucket, type Bucket } from './lib/buckets'
import { downloadBlob } from './lib/download'

export default function App() {
  const { status, documents, error, notice, connected, lastCheck, latencyMs, busy, submit, stop, clear, remove } =
    useBatchApi()
  const [bucket, setBucket] = useState<Bucket>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<null | 'delete' | 'clear'>(null)
  const [showSettings, setShowSettings] = useState(false)

  const allRows = documents?.files ?? []
  const rows = useMemo(() => allRows.filter((row) => matchesBucket(row, bucket)), [allRows, bucket])
  // Counted from the rows, not from the server's raw statuses: the tabs are buckets, and
  // `done` and `skipped` both mean converted.
  const counts = useMemo(() => bucketCounts(allRows), [allRows])

  const toggle = (path: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const download = (path: string) => {
    void downloadResult(path).then((blob) => downloadBlob(blob, path.split('/').pop() ?? 'document.md'))
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">MinerU Batch Console</h1>
      <DropZone onSubmit={submit} busy={busy} />
      {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{notice}</div>}
      <RunStatusBar status={status} onStop={stop} onClear={() => setConfirming('clear')} />
      <button
        type="button"
        onClick={() => setShowSettings((value) => !value)}
        className="self-start text-sm text-blue-700 hover:underline"
      >
        {showSettings ? 'Hide server parameters' : 'Server parameters'}
      </button>
      {showSettings && status && <SettingsPanel records={status.config.records} />}
      <FilterTabs value={bucket} counts={counts} onChange={setBucket} />
      <SelectionActions
        selected={[...selected]}
        onDelete={() => setConfirming('delete')}
        onClearSelection={() => setSelected(new Set())}
      />
      <DocumentsTable
        rows={rows}
        selected={selected}
        onToggle={toggle}
        onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((row) => row.path)) : new Set())}
        onPreview={setPreviewing}
        onDownload={download}
      />
      <PreviewDrawer path={previewing} onClose={() => setPreviewing(null)} />
      <ServerIndicator connected={connected} status={status} lastCheck={lastCheck} latencyMs={latencyMs} />
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'clear' ? 'Clear the input directory?' : `Delete ${selected.size} document(s)?`}
        body={
          confirming === 'clear'
            ? 'Every file in the input directory is removed. Converted Markdown is kept. This cannot be undone.'
            : 'The input file and its converted Markdown are both removed. This cannot be undone.'
        }
        confirmLabel={confirming === 'clear' ? 'Clear input' : 'Delete'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const action = confirming
          setConfirming(null)
          if (action === 'clear') {
            void clear()
          } else if (action === 'delete') {
            void remove([...selected])
            setSelected(new Set())
          }
        }}
      />
    </main>
  )
}
