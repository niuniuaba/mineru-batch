import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from './client'

describe('toApiError', () => {
  it("surfaces FastAPI's detail string", () => {
    const error = { response: { status: 404, data: { detail: 'not a converted markdown file: a.md' } } }
    const result = toApiError(error)
    expect(result).toBeInstanceOf(ApiError)
    expect(result.message).toBe('not a converted markdown file: a.md')
    expect(result.status).toBe(404)
  })

  it('carries the status so a 409 can be told apart from a failure', () => {
    expect(toApiError({ response: { status: 409, data: { detail: 'a run is already in progress' } } }).status).toBe(409)
  })

  it('falls back to the transport message when detail is not a string', () => {
    const error = { message: 'Request failed', response: { status: 500, data: { detail: { nested: true } } } }
    expect(toApiError(error).message).toBe('Request failed')
  })

  it('reports a status of 0 when there was no response at all', () => {
    const result = toApiError(new Error('Network Error'))
    expect(result.status).toBe(0)
    expect(result.message).toBe('Network Error')
  })
})
