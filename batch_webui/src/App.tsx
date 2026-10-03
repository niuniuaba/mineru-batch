import { useMemo, useState } from 'react'
import { DocumentsTable } from './components/DocumentsTable'
import { DropZone } from './components/DropZone'
import { FilterTabs } from './components/FilterTabs'
import { PreviewDrawer } from './components/PreviewDrawer'
import { RunStatusBar } from './components/RunStatusBar'
import { useBatchApi } from './hooks/useBatchApi'
import { matchesBucket, type Bucket } from './lib/buckets'

export default function App() {
  const { status, documents, error, notice, busy, submit, stop, clear } = useBatchApi()
  const [bucket, setBucket] = useState<Bucket>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState<string | null>(null)

  const rows = useMemo(
    () => (documents?.files ?? []).filter((row) => matchesBucket(row, bucket)),
    [documents, bucket],
  )

  const toggle = (path: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">MinerU Batch Console</h1>
      <DropZone onSubmit={submit} busy={busy} />
      {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{notice}</div>}
      <RunStatusBar status={status} onStop={stop} onClear={clear} />
      <FilterTabs value={bucket} counts={documents?.counts ?? {}} onChange={setBucket} />
      <DocumentsTable
        rows={rows}
        selected={selected}
        onToggle={toggle}
        onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((row) => row.path)) : new Set())}
        onPreview={setPreviewing}
      />
      <PreviewDrawer path={previewing} onClose={() => setPreviewing(null)} />
    </main>
  )
}
