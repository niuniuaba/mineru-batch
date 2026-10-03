import { BUCKETS, type Bucket } from '../lib/buckets'

interface Props {
  value: Bucket
  counts: Record<string, number>
  onChange: (bucket: Bucket) => void
}

export function FilterTabs({ value, counts, onChange }: Props) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1">
      {BUCKETS.map((bucket) => (
        <button
          key={bucket}
          type="button"
          role="tab"
          aria-selected={value === bucket}
          onClick={() => onChange(bucket)}
          className={`rounded px-3 py-1 text-sm capitalize ${
            value === bucket
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
          }`}
        >
          {bucket}
          {bucket !== 'all' && counts[bucket] !== undefined ? ` (${counts[bucket]})` : ''}
        </button>
      ))}
    </div>
  )
}
