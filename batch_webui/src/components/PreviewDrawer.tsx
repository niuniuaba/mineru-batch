import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { downloadResult, getContent } from '../api/mineru'
import { copyText } from '../lib/clipboard'
import { downloadBlob } from '../lib/download'
import { loadPreview } from '../lib/preview'

interface Props {
  path: string | null
  onClose: () => void
}

export function PreviewDrawer({ path, onClose }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    copyText(text)
      .then(() => setCopied(true))
      .catch((failure: Error) => setError(`Copy failed: ${failure.message}`))
  }

  // A brief confirmation, so a copy that did nothing cannot look like it worked.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setText('')
    setError(null)
    void loadPreview(getContent, path).then((state) => {
      if (cancelled) return
      setText(state.text ?? '')
      setError(state.error)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return null

  return (
    <aside
      role="complementary"
      aria-label="Preview"
      className="fixed inset-y-0 right-0 z-20 w-1/2 overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <header className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 truncate font-medium dark:text-slate-100">{path}</h2>
        <button
          type="button"
          onClick={() => {
            // Through axios, so a bearer token travels with the request. A plain link
            // would send none and a token-protected server would answer 401.
            downloadResult(path)
              .then((blob) => downloadBlob(blob, path.split('/').pop() ?? 'document.md'))
              .catch((failure: Error) => setError(failure.message))
          }}
          className="text-sm text-blue-700 hover:underline dark:text-blue-300"
        >
          Download
        </button>
        <button type="button" onClick={copy} className="text-sm text-blue-700 hover:underline dark:text-blue-300">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          ✕
        </button>
      </header>
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      <article className="prose prose-sm max-w-none dark:prose-invert">
        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {text}
        </Markdown>
      </article>
    </aside>
  )
}
