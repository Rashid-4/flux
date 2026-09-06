import type { ErrorCode } from '@flux/contracts'
import { anApiError } from '@flux/mocks'
import { useMutation } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  createQueryClient,
  DEFAULT_GC_TIME_MS,
  DEFAULT_STALE_TIME_MS,
  MAX_QUERY_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  RETRY_BASE_DELAY_MS,
  retryDelayMs,
  shouldRetryQuery,
} from './client'
import { getBootstrap } from '../api/bootstrap'
import { API_BASE, ApiRequestError, type ApiErrorEnvelope } from '../api/request'
import { errorResponse } from '../test/handlers'
import { renderHookWithProviders } from '../test/render'
import { server } from '../test/server'

/**
 * The retry policy, tested as two pure functions and then once end to end.
 *
 * Both halves are needed and neither is sufficient. The unit tests pin the
 * off-by-one that ./client.ts explicitly defers to this file — `failureCount` is 0
 * on the *first* failure, so `>= MAX_QUERY_ATTEMPTS - 1` is the correct comparison
 * and `>= MAX_QUERY_ATTEMPTS` would silently buy a fourth attempt. The integration
 * test proves TanStack is actually calling these functions, which no amount of
 * unit testing can show: a `retry` key misspelled in the options object leaves the
 * library's own `retry: 3` in place and every unit test here still passes.
 */

/** An `ApiRequestError` as `request.ts` builds one from a real error envelope. */
function anError(code: string, detail: Partial<Omit<ApiErrorEnvelope, 'code'>> = {}) {
  return new ApiRequestError({
    method: 'GET',
    path: '/issues/LOG-101',
    status: 500,
    envelope: 'contract',
    detail: { code, message: 'Something failed.', traceId: 'trace-1', ...detail },
  })
}

/**
 * Install a handler for `GET /bootstrap` that always fails with `code`, and return
 * a counter of how many times it was actually asked. Counting requests is the only
 * honest way to assert an attempt count — asserting on the error the query ends
 * with would be identical for one attempt and for four.
 */
function countingFailure(code: ErrorCode): () => number {
  let calls = 0
  server.use(
    http.get(`${API_BASE}/bootstrap`, () => {
      calls += 1
      return errorResponse(anApiError({ code }))
    }),
  )
  return () => calls
}

describe('shouldRetryQuery', () => {
  /**
   * The three that matter, spelled out rather than looped, because the boundary is
   * the entire content of the function. True at 0 and 1, false at 2 — one initial
   * attempt plus two retries, which is `MAX_QUERY_ATTEMPTS` requests in total.
   */
  it('allows exactly two retries after the first failure', () => {
    const retryable = anError('dependency_unavailable')
    expect(retryable.retryable).toBe(true)
    expect(shouldRetryQuery(0, retryable)).toBe(true)
    expect(shouldRetryQuery(1, retryable)).toBe(true)
    expect(shouldRetryQuery(2, retryable)).toBe(false)
    expect(shouldRetryQuery(3, retryable)).toBe(false)
  })

  it('retries every code in the contract retryable set', () => {
    for (const code of ['rate_limited', 'internal_error', 'dependency_unavailable']) {
      expect(shouldRetryQuery(0, anError(code))).toBe(true)
    }
  })

  /**
   * `validation_failed` is the case the spec names: the same request will fail the
   * same way, so a retry spends two more round trips to reach the answer it already
   * had. `permission_denied` and `version_conflict` are here because they are the
   * two a well-meaning "just retry 5xx-ish things" heuristic gets wrong — one needs
   * an admin, the other needs a re-read, and neither is helped by waiting.
   */
  it('does not retry a failure that will repeat', () => {
    for (const code of [
      'validation_failed',
      'permission_denied',
      'version_conflict',
      'not_found',
      'unauthenticated',
      'invalid_cursor',
    ]) {
      expect(shouldRetryQuery(0, anError(code))).toBe(false)
    }
  })

  /**
   * `import_already_running` is deliberately absent from `RETRYABLE_CODES` even
   * though it reads like a "try again later". Asserted here so a future edit that
   * adds it to the set has to come past a test that says why not: retrying would
   * queue a second import behind the first rather than telling the user one is
   * already going.
   */
  it('does not retry import_already_running', () => {
    expect(shouldRetryQuery(0, anError('import_already_running'))).toBe(false)
  })

  /**
   * A code from a server newer than this build. `request.ts` cannot know it is safe
   * to repeat, so `retryable` is false and this must not second-guess it.
   */
  it('does not retry a code this build does not recognise', () => {
    const unknown = anError('quantum_flux_exceeded')
    expect(unknown.knownCode).toBeNull()
    expect(shouldRetryQuery(0, unknown)).toBe(false)
  })

  /**
   * A `ZodError` means the response did not match its contract — the parse boundary
   * in `src/api/` throwing. Retrying re-fetches the same drifted payload. This is
   * the one non-`ApiRequestError` failure the query layer actually sees, so it is
   * asserted rather than left to the `instanceof` check by implication.
   */
  it('does not retry anything that is not an ApiRequestError', () => {
    expect(shouldRetryQuery(0, new ZodError([]))).toBe(false)
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false)
    expect(shouldRetryQuery(0, 'boom')).toBe(false)
    expect(shouldRetryQuery(0, undefined)).toBe(false)
    expect(shouldRetryQuery(0, null)).toBe(false)
  })

  /** Offline, DNS, TLS, or the client-side deadline: status 0, synthesised envelope. */
  it('retries a transport failure', () => {
    const offline = new ApiRequestError({
      method: 'GET',
      path: '/bootstrap',
      status: 0,
      envelope: 'synthesised',
      detail: {
        code: 'dependency_unavailable',
        message: 'The server could not be reached. Check your connection and try again.',
        traceId: null,
      },
    })
    expect(shouldRetryQuery(0, offline)).toBe(true)
  })
})

describe('retryDelayMs', () => {
  it('doubles from the base delay', () => {
    const error = anError('internal_error')
    expect(retryDelayMs(0, error)).toBe(RETRY_BASE_DELAY_MS)
    expect(retryDelayMs(1, error)).toBe(RETRY_BASE_DELAY_MS * 2)
    expect(retryDelayMs(2, error)).toBe(RETRY_BASE_DELAY_MS * 4)
  })

  it('caps the exponential curve', () => {
    expect(retryDelayMs(30, anError('internal_error'))).toBe(MAX_RETRY_DELAY_MS)
  })

  it('waits as long as the server asked', () => {
    expect(retryDelayMs(0, anError('rate_limited', { retryAfterSeconds: 4 }))).toBe(4000)
  })

  /**
   * The server's number wins even when it is *shorter* than the backoff this would
   * otherwise compute. A rate limiter knows when its window resets; waiting longer
   * than it asked is a delay the product invented.
   */
  it('honours a server wait shorter than the backoff', () => {
    expect(retryDelayMs(2, anError('rate_limited', { retryAfterSeconds: 1 }))).toBe(1000)
  })

  /**
   * Zero is a value, not an absence. This is the same shape as the `Number('')`
   * bug `retryAfterFrom` in request.ts carries a comment about: a policy that
   * treated `0` as "not sent" would fall back to the exponential curve and make the
   * user wait half a second the server said was unnecessary.
   */
  it('treats a zero-second wait as a real answer', () => {
    expect(retryDelayMs(0, anError('rate_limited', { retryAfterSeconds: 0 }))).toBe(0)
  })

  /**
   * An hour-long `Retry-After` is legitimate for a rate limiter and unusable for a
   * UI — the query would sit pending with a spinner and no explanation. Capped, the
   * retry gives up and the error surfaces with its own `retryAfterSeconds`, which is
   * what the spec's `wait` affordance renders.
   */
  it('caps a server wait it cannot sit through', () => {
    expect(retryDelayMs(0, anError('rate_limited', { retryAfterSeconds: 3600 }))).toBe(
      MAX_RETRY_DELAY_MS,
    )
  })

  it('falls back to the curve for a failure with no envelope of its own', () => {
    expect(retryDelayMs(0, new Error('boom'))).toBe(RETRY_BASE_DELAY_MS)
  })
})

describe('createQueryClient', () => {
  it('gives every caller its own cache', () => {
    const first = createQueryClient()
    const second = createQueryClient()
    first.setQueryData(['shared'], 'from-first')
    expect(second.getQueryData(['shared'])).toBeUndefined()
  })

  /**
   * Three flags whose behaviour needs a focus event, a network event or an error
   * boundary to observe, none of which is worth building in jsdom to learn a
   * boolean. Asserted as configuration on purpose, and narrowly: the point is that
   * an edit to the object has to be deliberate, since all three are silent when
   * wrong — a `throwOnError: true` slipped in here would replace every one of the
   * spec's actionable error surfaces with one generic screen.
   */
  it('configures the three flags whose failure mode is silence', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.refetchOnWindowFocus).toBe(true)
    expect(queries?.refetchOnReconnect).toBe(true)
    expect(queries?.throwOnError).toBe(false)
    expect(queries?.gcTime).toBe(DEFAULT_GC_TIME_MS)
  })
})

describe('createQueryClient — the policy as TanStack applies it', () => {
  /**
   * `retryDelay: 0` is overridden per query so the test does not spend 1.5 seconds
   * proving an attempt count. `retry` is *not* overridden — that is the thing under
   * test, and a test that replaced it would assert only that `fetchQuery` works.
   */
  it('makes exactly MAX_QUERY_ATTEMPTS requests for a retryable failure', async () => {
    const client = createQueryClient()
    const calls = countingFailure('dependency_unavailable')

    await expect(
      client.fetchQuery({
        queryKey: ['retry-probe'],
        queryFn: () => getBootstrap(),
        retryDelay: 0,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError)

    expect(calls()).toBe(MAX_QUERY_ATTEMPTS)
  })

  it('makes exactly one request for a failure that will repeat', async () => {
    const client = createQueryClient()
    const calls = countingFailure('permission_denied')

    await expect(
      client.fetchQuery({
        queryKey: ['no-retry-probe'],
        queryFn: () => getBootstrap(),
        retryDelay: 0,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError)

    expect(calls()).toBe(1)
  })

  /**
   * Contract drift, through the whole stack: a 200 whose body is not the shape
   * `BootstrapSchema` describes. One request, because a `ZodError` is not an
   * `ApiRequestError` and re-fetching would return the same drifted payload.
   */
  it('makes exactly one request when the response fails its contract', async () => {
    const client = createQueryClient()
    let calls = 0
    server.use(
      http.get(`${API_BASE}/bootstrap`, () => {
        calls += 1
        return HttpResponse.json<{ user: Record<string, never> }>({ user: {} })
      }),
    )

    await expect(
      client.fetchQuery({
        queryKey: ['drift-probe'],
        queryFn: () => getBootstrap(),
        retryDelay: 0,
      }),
    ).rejects.toBeInstanceOf(ZodError)

    expect(calls).toBe(1)
  })

  /**
   * `staleTime`, behaviourally. A second `fetchQuery` for a key fetched a moment ago
   * must serve the cache, which is what makes back-navigation instant; the paired
   * assertion with `staleTime: 0` is what stops this passing for a client that never
   * refetches anything.
   */
  it('serves fresh data from the cache instead of refetching', async () => {
    const client = createQueryClient()
    let calls = 0
    const queryFn = () => {
      calls += 1
      return Promise.resolve(calls)
    }

    expect(DEFAULT_STALE_TIME_MS).toBeGreaterThan(0)
    await client.fetchQuery({ queryKey: ['stale-probe'], queryFn })
    await client.fetchQuery({ queryKey: ['stale-probe'], queryFn })
    expect(calls).toBe(1)

    await client.fetchQuery({ queryKey: ['stale-probe'], queryFn, staleTime: 0 })
    expect(calls).toBe(2)
  })

  /**
   * A mutation is not retried even when the failure is one a *query* would retry.
   * The spec's reason is that `PATCH /issues/:key` and
   * `POST /issues/:key/transitions` carry no idempotency key, so a retry after a
   * response lost in transit applies the change twice — and a transition applied
   * twice moves the issue two columns.
   *
   * Driven through `useMutation` rather than read off `getDefaultOptions()`, because
   * the failure being guarded against is a default that exists in the object and is
   * not reaching the mutation.
   */
  it('never retries a mutation, even a retryable failure', async () => {
    let attempts = 0
    const failure = anError('rate_limited', { retryAfterSeconds: 1 })
    expect(failure.retryable).toBe(true)

    const { result } = renderHookWithProviders(
      () =>
        useMutation<never, ApiRequestError, void>({
          mutationFn: async () => {
            attempts += 1
            throw failure
          },
        }),
      { queryClient: createQueryClient() },
    )

    act(() => {
      result.current.mutate()
    })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(attempts).toBe(1)
    expect(result.current.error).toBe(failure)
  })
})
