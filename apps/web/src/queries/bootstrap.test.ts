import type { Bootstrap } from '@flux/contracts'
import { scenario } from '@flux/mocks'
import { waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { ZodError } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOTSTRAP_STALE_TIME_MS,
  bootstrapQueryOptions,
  serverNowMs,
  serverTimeOffsetMs,
  useBootstrap,
  useServerTimeOffsetMs,
} from './bootstrap'
import { keys } from './keys'
import { API_BASE } from '../api/request'
import { returnsGarbage } from '../test/failures'
import { createTestQueryClient, renderHookWithProviders } from '../test/render'
import { server } from '../test/server'

/**
 * Bootstrap is the one request the shell waits on, so the two properties worth
 * testing are that it is *one* request and that the payload reaching a component
 * has been through `BootstrapSchema`. Everything else here is the clock — which is
 * pure arithmetic with two ways to be wrong, both of which render a plausible
 * wrong time rather than an error.
 */

const AN_INSTANT = '2026-09-06T12:00:00.000Z'
const AN_INSTANT_MS = Date.UTC(2026, 8, 6, 12, 0, 0)

/**
 * Serve the real fixture and count the requests. Counting is the assertion for
 * §4's one-request rule: a version of this layer that fetched twice would return
 * identical data and pass every test that only looked at the data.
 */
function countingBootstrap(): () => number {
  let calls = 0
  server.use(
    http.get(`${API_BASE}/bootstrap`, () => {
      calls += 1
      return HttpResponse.json(scenario().bootstrap)
    }),
  )
  return () => calls
}

afterEach(() => {
  vi.useRealTimers()
})

describe('bootstrapQueryOptions', () => {
  it('uses the key from the registry, not a literal of its own', () => {
    expect(bootstrapQueryOptions().queryKey).toEqual(keys.bootstrap())
  })

  it('sets its own staleTime rather than inheriting the shell default', () => {
    expect(bootstrapQueryOptions().staleTime).toBe(BOOTSTRAP_STALE_TIME_MS)
  })

  it('returns the whole payload the shell needs, in one request', async () => {
    const calls = countingBootstrap()
    const client = createTestQueryClient()

    const data = await client.fetchQuery(bootstrapQueryOptions())

    expect(calls()).toBe(1)
    expect(data).toEqual(scenario().bootstrap)
    /**
     * Named individually as well as compared wholesale, because these are the
     * fields §4 says the shell must not go and fetch separately. If one of them
     * ever stops arriving here, the failure should read as "bootstrap lost its
     * project list" rather than as one line of a deep-equal diff.
     */
    expect(data.user.id).toBeTruthy()
    expect(data.organization.id).toBeTruthy()
    expect(data.membership.role).toBeTruthy()
    expect(data.organizations.length).toBeGreaterThan(0)
    expect(data.projects.length).toBeGreaterThan(0)
    expect(Object.keys(data.orgPermissions).length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(data.serverTime))).toBe(false)
  })

  /**
   * The parse boundary, from the query layer's side. A 200 whose body is missing
   * most of the payload must fail here with a path, not four components deep with
   * `undefined`. The assertion is on the path rather than only on the error class:
   * a `ZodError` that named nothing would be no more diagnosable than a crash.
   */
  it('rejects a response that does not match its contract', async () => {
    server.use(returnsGarbage('GET', '/bootstrap', JSON.stringify({ user: {} })))
    const client = createTestQueryClient()

    const error = await client.fetchQuery(bootstrapQueryOptions()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ZodError)
    const paths = (error as ZodError).issues.map((issue) => issue.path.join('.'))
    expect(paths).toContain('user.id')
    expect(paths).toContain('organization')
  })
})

describe('useBootstrap', () => {
  it('serves every consumer from one request', async () => {
    const calls = countingBootstrap()

    const { result } = renderHookWithProviders(() => ({
      first: useBootstrap(),
      second: useBootstrap(),
    }))

    await waitFor(() => {
      expect(result.current.first.data).toBeDefined()
    })
    expect(result.current.second.data).toBe(result.current.first.data)
    expect(calls()).toBe(1)
  })

  /**
   * Mounting the shell twice inside five minutes must not re-request the org list
   * and the permission booleans. Seeded data is fresh under
   * `BOOTSTRAP_STALE_TIME_MS`, and the test client's own `staleTime` is 0 — so this
   * passing is evidence the query's own staleTime is the one in effect, which is
   * the point of setting it there rather than on the client.
   */
  it('does not re-request while the payload is still fresh', async () => {
    const calls = countingBootstrap()
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(keys.bootstrap(), scenario().bootstrap)

    const { result } = renderHookWithProviders(() => useBootstrap(), { queryClient })

    expect(result.current.data).toEqual(scenario().bootstrap)
    await waitFor(() => {
      expect(result.current.isFetching).toBe(false)
    })
    expect(calls()).toBe(0)
  })

  /**
   * The signal is forwarded, so a caller that has already given up never reaches
   * the network. TanStack hands a `queryFn` the signal of a query it has abandoned
   * during a rapid remount, and issuing the request anyway spends a round trip on a
   * result nothing will read.
   */
  it('forwards the abort signal instead of ignoring it', async () => {
    const calls = countingBootstrap()
    const controller = new AbortController()
    controller.abort()

    const queryFn = bootstrapQueryOptions().queryFn as unknown as (context: {
      signal: AbortSignal
    }) => Promise<Bootstrap>

    const rejection: unknown = await queryFn({ signal: controller.signal }).catch(
      (error: unknown) => error,
    )

    /**
     * Asserted by `name`, not by `instanceof DOMException`. Node's
     * `AbortController` constructs its own `DOMException` and jsdom installs a
     * different one as the global, so the two are unrelated classes and an
     * `instanceof` assertion here fails while the code is entirely correct — it
     * would be a test of the environment. `name` is also what actually matters:
     * TanStack Query and React detect a cancellation by that string, which is why
     * `request.ts` rethrows the caller's own reason rather than wrapping it.
     */
    expect((rejection as { name?: unknown }).name).toBe('AbortError')
    expect(calls()).toBe(0)
  })
})

describe('serverTimeOffsetMs', () => {
  it('is positive when the server is ahead of this machine', () => {
    expect(serverTimeOffsetMs(AN_INSTANT, AN_INSTANT_MS - 3_600_000)).toBe(3_600_000)
  })

  it('is negative when the server is behind this machine', () => {
    expect(serverTimeOffsetMs(AN_INSTANT, AN_INSTANT_MS + 3_600_000)).toBe(-3_600_000)
  })

  it('is zero when the clocks agree', () => {
    expect(serverTimeOffsetMs(AN_INSTANT, AN_INSTANT_MS)).toBe(0)
  })

  /**
   * `InstantSchema` is `datetime({ offset: true })`, so a server in a non-UTC zone
   * can legitimately send `+02:00`. The offset must be computed from the instant,
   * not from the wall-clock digits — otherwise every user of such a server would
   * see every timestamp shifted by the server's timezone.
   */
  it('reads an instant with a zone offset as the same instant', () => {
    expect(serverTimeOffsetMs('2026-09-06T14:00:00.000+02:00', AN_INSTANT_MS)).toBe(0)
  })

  /**
   * Unreachable through the parsed response, and deliberately survivable anyway:
   * `NaN` would propagate into every rendered date and turn one bad field into a UI
   * that looks entirely broken. No correction is the honest fallback.
   */
  it('falls back to no correction rather than propagating NaN', () => {
    expect(serverTimeOffsetMs('the day before yesterday', AN_INSTANT_MS)).toBe(0)
    expect(serverTimeOffsetMs('', AN_INSTANT_MS)).toBe(0)
  })
})

describe('useServerTimeOffsetMs', () => {
  /**
   * `null` before the payload arrives, and the exact offset after. Exact, because
   * `0` is a meaningful offset: a hook that returned `0` for "not known yet" would
   * make a component render against the local clock and be right almost always,
   * which is how a skew bug survives a test suite.
   */
  it('is null until bootstrap resolves, then the measured offset', async () => {
    countingBootstrap()
    const { result, queryClient } = renderHookWithProviders(() => useServerTimeOffsetMs())

    expect(result.current).toBeNull()

    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    const state = queryClient.getQueryState(keys.bootstrap())
    expect(state).toBeDefined()
    expect(result.current).toBe(
      Date.parse(scenario().bootstrap.serverTime) - (state?.dataUpdatedAt ?? 0),
    )
  })

  /**
   * The receipt time is TanStack's `dataUpdatedAt`, not a `Date.now()` read whenever
   * the hook happens to run — so the offset does not grow as the tab stays open.
   * Advancing the clock an hour after the data landed must not change the answer.
   */
  it('does not drift as time passes after the response', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(keys.bootstrap(), scenario().bootstrap)
    const { result, rerender } = renderHookWithProviders(() => useServerTimeOffsetMs(), {
      queryClient,
    })

    const first = result.current
    expect(first).not.toBeNull()

    const updatedAt = queryClient.getQueryState(keys.bootstrap())?.dataUpdatedAt ?? 0
    vi.useFakeTimers()
    vi.setSystemTime(updatedAt + 3_600_000)
    rerender()

    expect(result.current).toBe(first)
  })
})

describe('serverNowMs', () => {
  it('adds the offset to the local clock', () => {
    expect(serverNowMs(3_600_000, AN_INSTANT_MS)).toBe(AN_INSTANT_MS + 3_600_000)
    expect(serverNowMs(-3_600_000, AN_INSTANT_MS)).toBe(AN_INSTANT_MS - 3_600_000)
    expect(serverNowMs(0, AN_INSTANT_MS)).toBe(AN_INSTANT_MS)
  })

  /**
   * The default argument reads the clock at call time, not at import time — so a
   * relative timestamp re-rendered a minute later says "a minute ago", not "just
   * now" forever.
   */
  it('reads the clock on every call', () => {
    vi.useFakeTimers()
    vi.setSystemTime(AN_INSTANT_MS)
    expect(serverNowMs(1_000)).toBe(AN_INSTANT_MS + 1_000)

    vi.setSystemTime(AN_INSTANT_MS + 60_000)
    expect(serverNowMs(1_000)).toBe(AN_INSTANT_MS + 61_000)
  })
})
