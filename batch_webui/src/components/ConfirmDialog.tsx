import { useEffect, useId, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const titleId = useId()
  const bodyId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    // Move focus into the dialog; a modal that leaves focus behind it is announced as
    // hiding the page while still accepting Tab into it.
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className="fixed inset-0 z-30 flex items-center justify-center bg-black/30">
      <div ref={panel} tabIndex={-1} className="w-96 rounded-lg bg-white p-6 shadow-xl outline-none dark:bg-slate-800">
        <h2 id={titleId} className="text-lg font-medium">{title}</h2>
        <p id={bodyId} className="mt-2 text-sm text-slate-600 dark:text-slate-300">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-4 py-2 dark:border-slate-600">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="rounded bg-red-600 px-4 py-2 text-white">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
