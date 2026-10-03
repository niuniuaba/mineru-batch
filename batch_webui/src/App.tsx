import { useEffect, useMemo, useState } from 'react'
import { downloadResult } from './api/mineru'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DocumentsTable } from './components/DocumentsTable'
import { FilterTabs } from './components/FilterTabs'
import { PreviewDrawer } from './components/PreviewDrawer'
import { RunStatusBar } from './components/RunStatusBar'
import { SelectionActions } from './components/SelectionActions'
import { ServerIndicator } from './components/ServerIndicator'
import { SettingsPanel } from './components/SettingsPanel'
import { ThemeToggle } from './components/ThemeToggle'
import { UploadDialog } from './components/UploadDialog'
import { useBatchApi } from './hooks/useBatchApi'
import { useTheme } from './hooks/useTheme'
import { bucketCounts, matchesBucket, type Bucket } from './lib/buckets'
import { downloadBlob } from './lib/download'

export default function App() {
  const { status, documents, error, notice, connected, lastCheck, latencyMs, busy, submit, stop, clear, remove, reportError } =
    useBatchApi()
  const { theme, toggle } = useTheme()
  const [bucket, setBucket] = useState<Bucket>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<null | 'delete' | 'clear'>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const allRows = documents?.files ?? []
  const rows = useMemo(() => allRows.filter((row) => matchesBucket(row, bucket)), [allRows, bucket])
  // Counted from the rows, not from the server's raw statuses: the tabs are buckets, and
  // `done` and `skipped` both mean converted.
  const counts = useMemo(() => bucketCounts(allRows), [allRows])

  const toggleRow = (path: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  // A failed download through axios rejects; without this the click does nothing at all.
  const download = (path: string) => {
    downloadResult(path)
      .then((blob) => downloadBlob(blob, path.split('/').pop() ?? 'document.md'))
      .catch((failure: Error) => reportError(failure.message))
  }

  // Drop selections for documents that no longer exist, so a destructive action never
  // targets a path the server would only report as missing.
  useEffect(() => {
    if (!documents) return
    const known = new Set(documents.files.map((row) => row.path))
    setSelected((previous) => {
      const next = new Set([...previous].filter((path) => known.has(path)))
      return next.size === previous.size ? previous : next
    })
  }, [documents])

  const headerButton =
    'rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700'

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">MinerU Batch Console</h1>
        <button type="button" onClick={() => setUploadOpen(true)} className={headerButton}>
          Upload
        </button>
        <button type="button" onClick={() => setShowSettings((value) => !value)} className={headerButton}>
          {showSettings ? 'Hide server parameters' : 'Server parameters'}
        </button>
        <ThemeToggle theme={theme} onToggle={toggle} />
      </header>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </div>
      )}

      <RunStatusBar status={status} onStop={stop} onClear={() => setConfirming('clear')} />

      {showSettings && status && (
        <section className="rounded border border-slate-200 dark:border-slate-700">
          <SettingsPanel records={status.config.records} />
        </section>
      )}

      <FilterTabs value={bucket} counts={counts} onChange={setBucket} />

      <SelectionActions
        selected={[...selected]}
        onDelete={() => setConfirming('delete')}
        onClearSelection={() => setSelected(new Set())}
        onError={reportError}
      />

      <DocumentsTable
        rows={rows}
        selected={selected}
        onToggle={toggleRow}
        onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((row) => row.path)) : new Set())}
        onPreview={setPreviewing}
        onDownload={download}
      />

      <PreviewDrawer path={previewing} onClose={() => setPreviewing(null)} />
      <ServerIndicator connected={connected} status={status} lastCheck={lastCheck} latencyMs={latencyMs} />
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onSubmit={submit} busy={busy} />

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'clear' ? 'Clear the input directory?' : `Delete ${selected.size} document(s)?`}
        body={
          confirming === 'clear'
            ? 'Every file in the input directory is removed. Converted Markdown is kept. This cannot be undone.'
            : 'The input file and its converted Markdown are both removed, along with any folder left empty. This cannot be undone.'
        }
        confirmLabel={confirming === 'clear' ? 'Clear input' : 'Delete'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const action = confirming
          setConfirming(null)
          if (action === 'clear') {
            // Every selected path is gone once the input tree is emptied.
            setSelected(new Set())
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
