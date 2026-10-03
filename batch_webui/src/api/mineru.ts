import { http } from './client'
import type { DocumentsResponse, StatusResponse } from './types'

export const getStatus = async (): Promise<StatusResponse> =>
  (await http.get<StatusResponse>('/api/status')).data

export const getDocuments = async (): Promise<DocumentsResponse> =>
  (await http.get<DocumentsResponse>('/api/documents')).data

export const getContent = async (path: string): Promise<string> =>
  (await http.get<string>('/api/results/content', { params: { path }, responseType: 'text' })).data

export async function uploadFiles(
  files: File[],
  relativePaths: string[],
  onProgress?: (fraction: number) => void,
): Promise<{ count: number }> {
  const form = new FormData()
  files.forEach((file) => form.append('files', file, file.name))
  relativePaths.forEach((relative) => form.append('relative_paths', relative))
  const { data } = await http.post<{ count: number }>('/api/upload', form, {
    // No timeout: the poll timeout would abort a large upload on a slow link mid-transfer.
    timeout: 0,
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(event.loaded / event.total)
    },
  })
  return data
}

export const startRun = async (): Promise<{ started: boolean; documents: number }> =>
  (await http.post<{ started: boolean; documents: number }>('/api/start')).data

export const stopRun = async (): Promise<void> => {
  await http.post('/api/stop')
}

export const clearInput = async (): Promise<{ removed: number }> =>
  (await http.post<{ removed: number }>('/api/clear')).data

export const deleteDocuments = async (
  paths: string[],
  deleteResult = true,
): Promise<{ deleted: { path: string; input: boolean; result: boolean }[]; missing: string[] }> =>
  (await http.post('/api/documents/delete', { paths, delete_result: deleteResult })).data

/**
 * Fetch a converted document as a blob. Used instead of a plain link so the request goes
 * through axios and carries any bearer token; a browser navigation would send none.
 */
export async function downloadResult(path: string): Promise<Blob> {
  const response = await http.get('/api/results/download', { params: { path }, responseType: 'blob' })
  return response.data as Blob
}

export async function zipResults(paths: string[]): Promise<Blob> {
  const response = await http.post('/api/results/zip', { paths }, { responseType: 'blob' })
  return response.data as Blob
}
