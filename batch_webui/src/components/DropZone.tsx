import { useRef, useState } from 'react'
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
  createReader: () => { readEntries: (resolve: (entries: FileSystemEntryLike[]) => void, reject: (error: unknown) => void) => void }
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
    <section
      data-testid="dropzone"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
        dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
      }`}
    >
      <p className="text-slate-600">Drop files or a folder here — conversion starts immediately.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          Upload files
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => folderInput.current?.click()}
          className="rounded border border-slate-300 px-4 py-2 disabled:opacity-50"
        >
          Upload folder
        </button>
      </div>
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
    </section>
  )
}
