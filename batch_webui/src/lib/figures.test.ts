import { describe, expect, it } from 'vitest'
import { renderFigureMarkers } from './figures'

describe('renderFigureMarkers', () => {
  it('turns an omitted-figure comment into a visible note', () => {
    const out = renderFigureMarkers('before\n<!-- figure omitted: ImageBlock -->\nafter')
    expect(out).toContain('figure omitted')
    expect(out).not.toContain('<!--')
  })

  it('leaves ordinary text alone', () => {
    expect(renderFigureMarkers('plain **text**')).toBe('plain **text**')
  })

  it('handles several markers', () => {
    const out = renderFigureMarkers('<!-- figure omitted: ImageBlock --><!-- figure omitted: TableBlock -->')
    expect(out.match(/figure omitted/g)).toHaveLength(2)
  })
})
