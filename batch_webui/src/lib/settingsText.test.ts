import { describe, expect, it } from 'vitest'
import type { ConfigRecord } from '../api/types'
import { describeChange } from './settingsText'

const base: ConfigRecord = {
  key: 'tier',
  label: 'Parse tier',
  value: 'basic',
  source: 'env',
  env_var: 'MINERU_BATCH_TIER',
  config_file: null,
  effect: 'restart',
}

describe('describeChange', () => {
  it('names the env var and the restart for a service parameter', () => {
    const text = describeChange(base)
    expect(text).toContain('MINERU_BATCH_TIER')
    expect(text).toContain('restart')
  })

  it('names the config file and the next-run effect for a MinerU parameter', () => {
    const text = describeChange({
      ...base,
      key: 'small_backend',
      env_var: 'MINERU_MODEL_SMALL_BACKEND',
      config_file: '/home/x/.mineru/config.yaml',
      effect: 'next_run',
    })
    expect(text).toContain('MINERU_MODEL_SMALL_BACKEND')
    expect(text).toContain('/home/x/.mineru/config.yaml')
    expect(text).toContain('next run')
  })

  it('says a detected value is not configurable', () => {
    expect(describeChange({ ...base, effect: 'read_only' })).toMatch(/detected|not configurable/i)
  })

  it('still gives an instruction when the server names no knob', () => {
    const text = describeChange({ ...base, env_var: null, config_file: null })
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('restart')
  })
})
