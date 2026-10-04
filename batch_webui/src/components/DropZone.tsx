import { useRef, useState } from 'react'
import type { UploadItem } from '../lib/uploadChain'

const MAX_READER_BATCHES = 10_000

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
    // Bounded: the contract says an empty batch ends the listing, but a reader that never
    // reports one would otherwise spin forever and freeze the tab.
    for (let batches = 0; batches < MAX_READER_BATCHES; batches += 1) {
      const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) return
      for (const child of batch) await fromEntry(child, nested, out)
    }
  }
}

export function DropZone({ onSubmit, busy }: Props) {
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const collect = (input: HTMLInputElement | null) => {
    if (!input?.files?.length) return
    const items = Array.from(input.files).map((file) => ({
      file,
      relative: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }))
    onSubmit(items)
    input.value = ''
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    // A drop carries whatever was dragged — files, folders, or both — because the entry
    // API reports each one. The picker cannot do this: the platform gives a dialog that
    // returns either loose files or one directory's contents, never both.
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

  const openPicker = () => {
    if (!busy) fileInput.current?.click()
  }

  return (
    <div>
      <div
        data-testid="dropzone"
        role="button"
        tabIndex={0}
        aria-label="Choose files, or drop files and folders here"
        aria-disabled={busy}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPicker()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          // Moving onto a child fires dragleave on the container; only a real exit counts.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${
          dragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-slate-300 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-500'
        }`}
      >
        <p className="text-slate-600 dark:text-slate-300">
          Click to choose files, or drop files and folders here.
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Conversion starts immediately — there is no separate start step.
        </p>
      </div>

      {/* One directory needs a distinct input from loose files, so this stays a link
          rather than a second button of equal weight. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => folderInput.current?.click()}
        className="mt-2 text-xs text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-300"
      >
        Choose a folder instead…
      </button>

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
