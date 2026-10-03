interface Props {
  theme: 'light' | 'dark'
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: Props) {
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="rounded border border-slate-300 px-3 py-1.5 dark:border-slate-600"
    >
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  )
}
