import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

function withClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })
}

afterEach(() => {
  withClipboard(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('copyText', () => {
  it('uses the async clipboard when the page has one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    withClipboard({ writeText })

    await copyText('hello')

    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('copies over plain HTTP, where navigator.clipboard does not exist', async () => {
    // A LAN origin is not a secure context, so navigator.clipboard is undefined there —
    // which is exactly how this console is reached. The old code silently did nothing.
    withClipboard(undefined)
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })

    await copyText('hello')

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('selects the text it is about to copy', async () => {
    withClipboard(undefined)
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(true), configurable: true })
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {})

    await copyText('selected text')

    expect(select).toHaveBeenCalled()
  })

  it('falls back when the async clipboard refuses', async () => {
    // writeText rejects when the document is not focused.
    withClipboard({ writeText: vi.fn().mockRejectedValue(new Error('Document is not focused')) })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })

    await copyText('hello')

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when there is no clipboard and no execCommand', async () => {
    withClipboard(undefined)
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true })

    await expect(copyText('hello')).rejects.toThrow(/copy/i)
  })

  it('reports a refusal rather than pretending to succeed', async () => {
    withClipboard(undefined)
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true })

    await expect(copyText('hello')).rejects.toThrow(/copy/i)
  })

  it('cleans up the temporary textarea even when the copy is refused', async () => {
    withClipboard(undefined)
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true })

    await expect(copyText('hello')).rejects.toThrow()

    expect(document.querySelector('textarea')).toBeNull()
  })
})
