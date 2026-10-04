import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

describe('DropZone', () => {
  it('opens the file picker from a single click on the area', async () => {
    render(<DropZone onSubmit={vi.fn()} busy={false} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: /choose files/i }))
    expect(click).toHaveBeenCalled()
  })

  it('opens the picker from the keyboard too', async () => {
    render(<DropZone onSubmit={vi.fn()} busy={false} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    screen.getByRole('button', { name: /choose files/i }).focus()
    await userEvent.keyboard('{Enter}')
    expect(click).toHaveBeenCalled()
  })

  it('offers no menu of upload kinds', async () => {
    render(<DropZone onSubmit={vi.fn()} busy={false} />)
    await userEvent.click(screen.getByRole('button', { name: /choose files/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('still reaches folders, which the platform keeps on a separate input', async () => {
    render(<DropZone onSubmit={vi.fn()} busy={false} />)
    const input = screen.getByTestId('folder-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: /choose a folder/i }))
    expect(click).toHaveBeenCalled()
  })

  it('submits relative paths for a folder selection', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const file = new File(['x'], 'a.pdf')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'papers/a.pdf' })
    await userEvent.upload(screen.getByTestId('folder-input'), file)
    expect(onSubmit).toHaveBeenCalledWith([{ file, relative: 'papers/a.pdf' }])
  })

  it('falls back to the bare filename when no relative path is available', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const file = new File(['x'], 'plain.pdf')
    await userEvent.upload(screen.getByTestId('file-input'), file)
    expect(onSubmit).toHaveBeenCalledWith([{ file, relative: 'plain.pdf' }])
  })

  it('accepts several files at once', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const files = [new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')]
    await userEvent.upload(screen.getByTestId('file-input'), files)
    expect(onSubmit.mock.calls[0][0].map((item: { relative: string }) => item.relative)).toEqual(['a.pdf', 'b.pdf'])
  })

  it('takes files and folders together when they are dropped', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const fileEntry = (name: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (resolve: (file: File) => void) => resolve(new File(['x'], name)),
    })
    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'papers',
      createReader: () => {
        let call = 0
        return {
          readEntries: (resolve: (entries: unknown[]) => void) => resolve(call++ === 0 ? [fileEntry('b.pdf')] : []),
        }
      },
    }
    fireEvent.drop(screen.getByTestId('dropzone'), {
      dataTransfer: {
        items: [{ webkitGetAsEntry: () => fileEntry('a.pdf') }, { webkitGetAsEntry: () => dirEntry }],
        files: [],
      },
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect((onSubmit.mock.calls[0][0] as { relative: string }[]).map((i) => i.relative).sort()).toEqual([
      'a.pdf',
      'papers/b.pdf',
    ])
  })

  it('ignores a drop while an upload is already running', () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy />)
    fireEvent.drop(screen.getByTestId('dropzone'), {
      dataTransfer: { items: [], files: [new File(['x'], 'a.pdf')] },
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('DropZone dropped folders', () => {
  it('drains the directory reader, so a folder is not truncated at one batch', async () => {
    // FileSystemDirectoryReader hands back entries in batches and signals the end with an
    // empty one. Reading only the first batch silently drops everything after ~100 files.
    const fileEntry = (name: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (resolve: (file: File) => void) => resolve(new File(['x'], name)),
    })
    let batch = 0
    const batches = [[fileEntry('a.pdf')], [fileEntry('b.pdf')], []]
    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'papers',
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) => resolve(batches[batch++] ?? []),
      }),
    }
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    fireEvent.drop(screen.getByTestId('dropzone'), {
      dataTransfer: { items: [{ webkitGetAsEntry: () => dirEntry }], files: [] },
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].map((item: { relative: string }) => item.relative)).toEqual([
      'papers/a.pdf',
      'papers/b.pdf',
    ])
  })
})
