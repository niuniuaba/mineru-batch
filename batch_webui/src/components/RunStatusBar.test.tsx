import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StatusResponse } from '../api/types'
import { RunStatusBar } from './RunStatusBar'

const bar = (counts: Record<string, number>, total: number) =>
  ({
    state: 'done',
    counts,
    total,
    message: '',
    current_file: null,
    window: '',
  }) as unknown as StatusResponse

describe('RunStatusBar', () => {
  it('counts skipped documents as processed', () => {
    // A resumed run converts nothing but is finished; showing "0/12" misreports it.
    render(<RunStatusBar status={bar({ done: 5, skipped: 7 }, 12)} onStop={() => {}} onClear={() => {}} />)
    expect(screen.getByText(/12\/12 processed/)).toBeInTheDocument()
  })

  it('still reports failures separately', () => {
    render(<RunStatusBar status={bar({ done: 3, failed: 2 }, 5)} onStop={() => {}} onClear={() => {}} />)
    expect(screen.getByText(/5\/5 processed · 2 failed/)).toBeInTheDocument()
  })
})
