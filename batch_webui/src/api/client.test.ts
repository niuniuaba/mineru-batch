import { describe, expect, it } from 'vitest'
import { ApiError, authHeaders, toApiError } from './client'

const storage = (value: string | null) => ({ getItem: () => value })

describe('toApiError', () => {
  it("surfaces FastAPI's detail string", async () => {
    const error = { response: { status: 404, data: { detail: 'not a converted markdown file: a.md' } } }
    const result = await toApiError(error)
    expect(result).toBeInstanceOf(ApiError)
    expect(result.message).toBe('not a converted markdown file: a.md')
    expect(result.status).toBe(404)
  })

  it('carries the status so a 409 can be told apart from a failure', async () => {
    expect((await toApiError({ response: { status: 409, data: { detail: 'a run is already in progress' } } })).status).toBe(409)
  })

  it('falls back to the transport message when detail is not a string', async () => {
    const error = { message: 'Request failed', response: { status: 500, data: { detail: { nested: true } } } }
    expect((await toApiError(error)).message).toBe('Request failed')
  })

  it('reports a status of 0 when there was no response at all', async () => {
    const result = await toApiError(new Error('Network Error'))
    expect(result.status).toBe(0)
    expect(result.message).toBe('Network Error')
  })
})

describe('authHeaders', () => {
  it('sends nothing when no token is stored', () => {
    expect(authHeaders(storage(null))).toEqual({})
  })

  it('sends a bearer token when one is stored', () => {
    expect(authHeaders(storage('secret'))).toEqual({ Authorization: 'Bearer secret' })
  })
})

describe('toApiError with an unparsed body', () => {
  it("reads FastAPI's detail out of a text response", async () => {
    const error = { response: { status: 400, data: JSON.stringify({ detail: 'provide a non-empty list of paths' }) } }
    expect((await toApiError(error)).message).toBe('provide a non-empty list of paths')
  })

  it("reads FastAPI's detail out of a blob response", async () => {
    const error = {
      response: { status: 401, data: new Blob([JSON.stringify({ detail: 'invalid token' })], { type: 'application/json' }) },
    }
    expect((await toApiError(error)).message).toBe('invalid token')
  })

  it('falls back when the body is not the FastAPI envelope', async () => {
    const error = { message: 'Request failed with status code 500', response: { status: 500, data: '<html>oops</html>' } }
    expect((await toApiError(error)).message).toBe('Request failed with status code 500')
  })
})
