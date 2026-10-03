import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

const openPicker = async (choice: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name: /^upload$/i }))
  await userEvent.click(screen.getByRole('menuitem', { name: choice }))
}

describe('DropZone', () => {
  it('offers a single upload button, not one per source', () => {
    render(<DropZone onSubmit={vi.fn()} busy={false} />)
    expect(screen.getAllByRole('button', { name: /^upload$/i })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /folder/i })).not.toBeInTheDocument()
  })

  it('reveals the file and folder choices from that one button', async () => {
    render(<DropZone onSubmit={vi.fn()} busy={false} />)
    expect(screen.queryByRole('menuitem', { name: /files/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    expect(screen.getByRole('menuitem', { name: /files/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /folder/i })).toBeInTheDocument()
  })

  it('opens the file picker from the files choice', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await openPicker(/files/i)
    expect(click).toHaveBeenCalled()
  })

  it('opens the folder picker from the folder choice', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const input = screen.getByTestId('folder-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await openPicker(/folder/i)
    expect(click).toHaveBeenCalled()
  })

  it('submits relative paths for a folder selection', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const input = screen.getByTestId('folder-input') as HTMLInputElement
    const file = new File(['x'], 'a.pdf')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'papers/a.pdf' })
    await userEvent.upload(input, file)
    expect(onSubmit).toHaveBeenCalledWith([{ file, relative: 'papers/a.pdf' }])
  })

  it('falls back to the bare filename when no relative path is available', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const file = new File(['x'], 'plain.pdf')
    await userEvent.upload(screen.getByTestId('file-input'), file)
    expect(onSubmit).toHaveBeenCalledWith([{ file, relative: 'plain.pdf' }])
  })

  it('does not submit when the picker returns nothing', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    await userEvent.click(screen.getByRole('button', { name: /^upload$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
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
