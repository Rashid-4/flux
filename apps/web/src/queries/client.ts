import { QueryClient } from '@tanstack/react-query'
import { isApiRequestError } from '../api/request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The QueryClient, and the retry policy it exists to get right.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/specs/web/README.md §7: *"`RETRYABLE_CODES` … is the only retry allowlist.
 * Configure TanStack Query's `retry` from it. Retrying anything else is either
 * pointless or actively harmful — a retried `validation_failed` will fail
 * identically, and a retried non-idempotent write can double-apply."*
 *
 * TanStack's default is `retry: 3` for every query regardless of what failed,
 * which means the out-of-the-box behaviour is precisely the one that sentence
 * forbids: a permission error retried three times, a validation error retried
 * three times, and a user waiting seven seconds for an answer that was already
 * final on the first attempt. So the default is replaced, not tuned.
 *
 * The policy lives in two exported functions rather than inline in the object
 * below, for one reason: they are the interesting part and they are directly
 * testable. A policy expressed as a closure inside `new QueryClient({…})` can
 * only be tested by driving a real client through a real failure and counting
 * requests, which is slow, and slow tests of a retry policy get deleted.
 */

/**
 * Total attempts per query, initial included. Three, not TanStack's four.
 *
 * Every code that reaches this policy is one of `rate_limited`,
 * `internal_error` or `dependency_unavailable`, and all three are transient by
 * definition — the first attempt after the cause clears succeeds. What the
 * attempt count actually buys is a bridge over a deploy, a leader election or a
 * dropped connection, and two extra attempts with backoff spans several seconds
 * of that. A fourth mostly extends how long a genuinely-down dependency leaves a
 * skeleton on screen, which §13 of docs/product-quality-bar.md treats as a
 * failure state that must be shown, not hidden behind more waiting.
 */
export const MAX_QUERY_ATTEMPTS = 3

/** First retry waits this long; each subsequent one doubles. */
export const RETRY_BASE_DELAY_MS = 500

/**
 * Ceiling on any single wait, including one the server asked for.
 *
 * A `Retry-After` of an hour is a legitimate thing for a rate limiter to send and
 * an illegitimate thing for a UI to obey silently: the query would sit `pending`
 * with a spinner and no explanation. Capped here, the retry gives up, the error
 * surfaces with its own `retryAfterSeconds`, and §7's `wait` affordance tells the
 * user the real number instead of pretending to be busy.
 */
export const MAX_RETRY_DELAY_MS = 30_000

/**
 * How long fetched data is served without a background refetch.
 *
 * Zero — TanStack's default — refetches on every mount, so navigating away from a
 * board and back re-requests it, and so does every remount React does for its own
 * reasons. Thirty seconds is short enough that returning to a tab after a coffee
 * refetches (`refetchOnWindowFocus` only fires for *stale* data, so this number is
 * also that behaviour's threshold) and long enough that back-navigation inside a
 * task is instant and silent.
 *
 * It is a default, not a rule. A surface with a stricter freshness requirement
 * sets its own `staleTime` in its query options, which is why this constant is
 * exported: so the override reads as a deliberate deviation from a known number.
 */
export const DEFAULT_STALE_TIME_MS = 30_000

/**
 * How long an unused cache entry survives before collection.
 *
 * Five minutes, TanStack's own default, written down rather than inherited
 * because it is the number that decides whether back-navigation paints instantly
 * or shows a skeleton — and an inherited default is a number nobody has decided.
 */
export const DEFAULT_GC_TIME_MS = 5 * 60_000

/**
 * Whether to retry, given how many times this query has already failed.
 *
 * `failureCount` is TanStack's, and it is **0 on the first failure** — the retryer
 * calls `retry(failureCount, error)` before incrementing. So the comparison is
 * against `MAX_QUERY_ATTEMPTS - 1`: it returns true at 0 and 1, false at 2, which
 * is one initial attempt plus two retries. Off by one here is invisible in
 * behaviour and would either double the wait a user sees on a dead dependency or
 * remove the retry entirely, so it is asserted in ./client.test.ts rather than
 * reasoned about.
 *
 * `isApiRequestError` first, and nothing else retried: a `ZodError` means the
 * response did not match the contract, and the same request will produce the same
 * mismatch. An `ApiRequestError` whose code this build does not recognise is not
 * retryable either — `request.ts` derives `retryable` from `RETRYABLE_CODES` and
 * an unknown code cannot be known safe to repeat.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_ATTEMPTS - 1) return false
  return isApiRequestError(error) && error.retryable
}

/**
 * How long to wait before the next attempt.
 *
 * The server's own `retryAfterSeconds` wins when it sent one, because §7 says so
 * in as many words — *"Wait that long. Do not spin."* A rate limiter knows when
 * its window resets and exponential backoff is a guess at the same number; racing
 * it just spends the next attempt on another 429.
 *
 * Everything else is exponential from `RETRY_BASE_DELAY_MS`. `failureCount` is
 * again 0 on the first failure, so the waits are 500ms then 1s — short enough
 * that a transient blip is invisible to the user, rather than a fixed delay long
 * enough to feel like a hang.
 */
export function retryDelayMs(failureCount: number, error: unknown): number {
  const requested = isApiRequestError(error) ? error.detail.retryAfterSeconds : undefined
  if (requested !== undefined) return Math.min(requested * 1000, MAX_RETRY_DELAY_MS)
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** failureCount, MAX_RETRY_DELAY_MS)
}

/**
 * Build the application's QueryClient.
 *
 * A factory rather than a module-level singleton. A singleton is one cache shared
 * by every test in the file, so a test that populates the bootstrap key changes
 * what the next test sees — the CI-ordering-only flake, which is the most
 * expensive kind to diagnose. `main.tsx` calls this once; tests call it per test.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay: retryDelayMs,
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        /**
         * On by default in TanStack and kept, because it is most of why a board
         * left open on a second monitor is not lying. It respects `staleTime`, so
         * the cost is one request per key per thirty seconds of active use, and
         * §8's budgets are per-request rather than per-session.
         */
        refetchOnWindowFocus: true,
        /**
         * A reconnect is the one moment the cache is known to be behind: writes
         * happened while this tab could not see them.
         */
        refetchOnReconnect: true,
        /**
         * Errors are handled where they are rendered, not thrown to the nearest
         * error boundary. §7 needs the error's own fields to build an actionable
         * dialog — `requiredPermission`, `currentVersion`, `blockedBy` — and a
         * boundary can only render one generic screen for all of them. The
         * boundary in `main.tsx` stays for what it is actually for: a render
         * crash, which is a bug rather than a failure the product describes.
         */
        throwOnError: false,
      },
      mutations: {
        /**
         * No retries, stated rather than inherited. §7: *"a retried
         * non-idempotent write can double-apply."* `PATCH /issues/:key` and
         * `POST /issues/:key/transitions` carry no idempotency key, so a retry
         * after a response that was lost in transit applies the change twice —
         * and a transition applied twice moves the issue two columns.
         *
         * A mutation whose request schema *does* carry `idempotencyKey` may
         * override this per-mutation, on one condition: the key must be minted
         * once per intention, as apps/web/src/api/idempotency.ts requires. A
         * retry that re-mints defeats the mechanism and the duplicate is silent.
         */
        retry: false,
      },
    },
  })
}
