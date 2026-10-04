import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StatusResponse } from '../api/types'
import { RunStatusBar } from './RunStatusBar'

const bar = (counts: Record<string, number>, total: number, inInput = 0) =>
  ({
    state: 'done',
    counts,
    total,
    message: '',
    current_file: null,
    window: '',
    config: { queued_in_input: inInput },
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

describe('input folder status', () => {
  it('reports how many files are waiting in the input folder', () => {
    render(<RunStatusBar status={bar({}, 0, 7)} onStop={() => {}} onClear={() => {}} />)
    expect(screen.getByText(/7 in input folder/i)).toBeInTheDocument()
  })

  it('says zero rather than hiding the count', () => {
    render(<RunStatusBar status={bar({}, 0, 0)} onStop={() => {}} onClear={() => {}} />)
    expect(screen.getByText(/0 in input folder/i)).toBeInTheDocument()
  })

  it('shows it beside the processed and failed totals', () => {
    render(<RunStatusBar status={bar({ done: 3, failed: 1 }, 4, 9)} onStop={() => {}} onClear={() => {}} />)
    const line = screen.getByTestId('run-counts').textContent ?? ''
    expect(line).toMatch(/4\/4 processed/)
    expect(line).toMatch(/1 failed/)
    expect(line).toMatch(/9 in input folder/)
  })
})
