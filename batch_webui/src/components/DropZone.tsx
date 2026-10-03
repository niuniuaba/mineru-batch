import { useEffect, useRef, useState } from 'react'
import type { UploadItem } from '../lib/uploadChain'

interface Props {
  onSubmit: (items: UploadItem[]) => void
  busy: boolean
}

interface FileSystemEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  file: (resolve: (file: File) => void, reject: (error: unknown) => void) => void
  createReader: () => {
    readEntries: (resolve: (entries: FileSystemEntryLike[]) => void, reject: (error: unknown) => void) => void
  }
}

/** Walk a dropped directory entry, preserving each file's path relative to the drop. */
async function fromEntry(entry: FileSystemEntryLike, prefix: string, out: UploadItem[]): Promise<void> {
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject))
    out.push({ file, relative: `${prefix}${file.name}` })
    return
  }
  if (entry.isDirectory) {
    const reader = entry.createReader()
    const nested = `${prefix}${entry.name}/`
    // The reader hands back entries in batches and signals the end with an empty batch.
    // Reading it once silently truncates any folder with more than a batch of files.
    for (;;) {
      const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) break
      for (const child of batch) await fromEntry(child, nested, out)
    }
  }
}

export function DropZone({ onSubmit, busy }: Props) {
  const [dragging, setDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const collect = (input: HTMLInputElement | null) => {
    if (!input?.files?.length) return
    const items = Array.from(input.files).map((file) => ({
      file,
      relative: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }))
    onSubmit(items)
    input.value = ''
  }

  const pick = (input: HTMLInputElement | null) => {
    setMenuOpen(false)
    input?.click()
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const items: UploadItem[] = []
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => (item.webkitGetAsEntry ? (item.webkitGetAsEntry() as unknown as FileSystemEntryLike | null) : null))
      .filter((entry): entry is FileSystemEntryLike => entry !== null)
    if (entries.length) {
      for (const entry of entries) await fromEntry(entry, '', items)
    } else {
      for (const file of Array.from(event.dataTransfer.files)) items.push({ file, relative: file.name })
    }
    if (items.length) onSubmit(items)
  }

  return (
    <div>
      <section
        data-testid="dropzone"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          // Moving onto a child fires dragleave on the section; only a real exit counts.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${
          dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        <p className="text-slate-600 dark:text-slate-300">Drop files or a folder here — conversion starts immediately.</p>
        <div ref={menu} className="relative mt-3 inline-block">
          <button
            type="button"
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            Upload
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute left-1/2 z-10 mt-1 w-44 -translate-x-1/2 rounded border bg-white py-1 text-left shadow-lg dark:border-slate-600 dark:bg-slate-800"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => pick(fileInput.current)}
                className="block w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Choose files…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => pick(folderInput.current)}
                className="block w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Choose folder…
              </button>
            </div>
          )}
        </div>
      </section>
      {/* Tailwind's `hidden` rather than the HTML attribute, so the control is reachable
          by assistive tech and by tests. */}
      <input
        ref={fileInput}
        data-testid="file-input"
        type="file"
        multiple
        className="hidden"
        onChange={(event) => collect(event.target)}
      />
      <input
        ref={folderInput}
        data-testid="folder-input"
        type="file"
        multiple
        // @ts-expect-error non-standard but universally supported
        webkitdirectory=""
        className="hidden"
        onChange={(event) => collect(event.target)}
      />
    </div>
  )
}
