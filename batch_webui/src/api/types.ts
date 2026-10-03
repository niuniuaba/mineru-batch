export type DocStatus = 'pending' | 'queued' | 'running' | 'done' | 'skipped' | 'failed' | 'converted'
export type RunState = 'idle' | 'running' | 'done' | 'failed'

export interface DocRow {
  path: string
  status: DocStatus
  pages: number | null
  seconds: number | null
  rate: number | null
  bytes: number | null
  error: string | null
  has_input: boolean
  has_result: boolean
}

export interface DocumentsResponse {
  state: RunState
  counts: Record<string, number>
  files: DocRow[]
}

export interface ConfigRecord {
  key: string
  label: string
  value: string | number | boolean | null
  source: 'default' | 'file' | 'env' | 'runtime'
  env_var: string | null
  config_file: string | null
  effect: 'restart' | 'next_run' | 'read_only'
}

export interface StatusResponse {
  state: RunState
  pid: number | null
  current_file: string | null
  window: string
  message: string
  returncode: number | null
  total: number
  started_at: number | null
  ended_at: number | null
  counts: Record<string, number>
  files: DocRow[]
  config: {
    records: ConfigRecord[]
    input_dir: string
    output_dir: string
    queued_in_input: number
    supported_suffixes: string[]
    environment: Record<string, string>
    disk: { free: number; total: number }
  }
}
