import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { getContent, resultDownloadUrl } from '../api/mineru'
import { loadPreview } from '../lib/preview'

interface Props {
  path: string | null
  onClose: () => void
}

export function PreviewDrawer({ path, onClose }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

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
      className="fixed inset-y-0 right-0 z-20 w-1/2 overflow-y-auto border-l bg-white p-6 shadow-xl"
    >
      <header className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 truncate font-medium">{path}</h2>
        <a href={resultDownloadUrl(path)} className="text-sm text-blue-700 hover:underline">
          Download
        </a>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(text)}
          className="text-sm text-blue-700 hover:underline"
        >
          Copy
        </button>
        <button type="button" onClick={onClose} aria-label="Close preview">
          ✕
        </button>
      </header>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <article className="prose prose-sm max-w-none">
        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {text}
        </Markdown>
      </article>
    </aside>
  )
}
