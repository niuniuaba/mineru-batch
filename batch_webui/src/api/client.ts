import axios, { type AxiosError } from 'axios'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Turn anything axios throws into an ApiError. FastAPI reports errors as
 * `{"detail": "..."}`, and that sentence is far more useful than "Request failed with
 * status code 409" — the console shows it verbatim.
 */
export function toApiError(error: unknown): ApiError {
  const response = (error as AxiosError | undefined)?.response
  const detail = (response?.data as { detail?: unknown } | undefined)?.detail
  const message =
    typeof detail === 'string' ? detail : ((error as Error | undefined)?.message ?? 'request failed')
  return new ApiError(message, response?.status ?? 0)
}

/**
 * The service is open by default, but a deployment may require a token. Read it from
 * storage rather than baking it into the build, so one build serves either case.
 */
export function authHeaders(storage: Pick<Storage, 'getItem'> = localStorage): Record<string, string> {
  const token = storage.getItem('mineru-batch-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const http = axios.create({ baseURL: '/', timeout: 120_000 })

http.interceptors.request.use((config) => {
  for (const [name, value] of Object.entries(authHeaders())) config.headers.set(name, value)
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toApiError(error)),
)
