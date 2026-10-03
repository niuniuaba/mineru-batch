import type { ConfigRecord } from '../api/types'

/** How to change this value, in one line, derived only from what the server declared. */
export function describeChange(record: ConfigRecord): string {
  if (record.effect === 'read_only') {
    return 'Detected at runtime; not configurable here.'
  }
  const knobs: string[] = []
  if (record.env_var) knobs.push(`set ${record.env_var}`)
  if (record.config_file) knobs.push(`or edit ${record.config_file}`)
  const where = knobs.length ? knobs.join(' ') : 'edit the service environment'
  return record.effect === 'next_run'
    ? `${where} — takes effect on the next run`
    : `${where}, then systemctl restart mineru-batch-api`
}
