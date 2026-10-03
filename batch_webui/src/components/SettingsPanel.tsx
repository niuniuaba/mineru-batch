import type { ConfigRecord } from '../api/types'
import { describeChange } from '../lib/settingsText'

export function SettingsPanel({ records }: { records: ConfigRecord[] }) {
  const tokenRequired = records.find((record) => record.key === 'token_required')?.value === true
  return (
    <section className="rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <tr>
            <th className="p-2">Parameter</th>
            <th className="p-2">Value</th>
            <th className="p-2">Source</th>
            <th className="p-2">How to change it</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.key} className="border-b align-top">
              <td className="p-2 font-medium">{record.label}</td>
              <td className="p-2 font-mono text-xs break-all">{String(record.value)}</td>
              <td className="p-2 text-slate-600 dark:text-slate-300">{record.source}</td>
              <td className="p-2 text-slate-600 dark:text-slate-300">{describeChange(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tokenRequired && (
        <label className="mt-4 flex items-center gap-2 text-sm">
          API token
          <input
            type="password"
            defaultValue={localStorage.getItem('mineru-batch-token') ?? ''}
            onChange={(event) => localStorage.setItem('mineru-batch-token', event.target.value)}
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600"
          />
          <span className="text-slate-500">sent as a bearer token; reload after changing</span>
        </label>
      )}
    </section>
  )
}
