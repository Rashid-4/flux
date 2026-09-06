import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { installJsdomGaps } from './dom'
import { server } from './server'

/**
 * Runs once per test file, before it (`setupFiles` in vitest.config.ts).
 *
 * `/vitest` on the jest-dom import, not the bare path: that entry point
 * registers the matchers with Vitest's `expect` rather than Jest's, and without
 * it `toHaveAccessibleName()` is a type error and `toBeVisible()` is undefined
 * at run time.
 *
 * If every jest-dom matcher is missing at once — `Invalid Chai property:
 * toHaveAttribute`, in dozens of files, with `TS2339` beside it — **this line is
 * almost certainly not the bug.** It happened, and the cause was two majors of
 * vitest installed in the workspace: jest-dom 6 declared no `vitest` at all, so
 * `expect.extend()` resolved through pnpm's hoisted fallback to the *other*
 * major and registered every matcher onto a chai instance no assertion touched.
 * Both halves worked, on different objects. `pnpm check:toolchain` now fails on
 * the version split, `scripts/check-toolchain-versions.mjs` has the measured
 * chain, and jest-dom 7 declares `vitest` as an optional peer so pnpm links it
 * into jest-dom's own dependencies rather than leaving it to the hoist. Do not
 * "fix" this file in response to that symptom.
 *
 * The cleanup is explicit because `globals: false`. Testing Library's automatic
 * cleanup hooks itself onto a global `afterEach`, which does not exist here, so
 * without this every test file leaks its mounted trees into the next one — and
 * the symptom is `getByRole` finding two buttons in a test that rendered one.
 */

/**
 * At module scope, not in `beforeAll`.
 *
 * `@testing-library/user-event` and Radix both feature-detect at *import* time in
 * places — `typeof PointerEvent !== 'undefined'` decides which event constructor a
 * module closes over — and a module imported by a test file is evaluated before any
 * hook this file registers. Installing in `beforeAll` would leave those decisions
 * already made against the unpatched environment.
 *
 * These are `defineProperty`, not `vi.stubGlobal`, so `unstubGlobals` cannot unwind
 * them between tests. ./dom.ts explains why that distinction matters.
 */
installJsdomGaps()

beforeAll(() => {
  /**
   * `onUnhandledRequest: 'error'`, not the default warning.
   *
   * A request with no handler is a test asserting against a network failure it
   * did not mean to cause. Under the default it still fails, but the message is
   * whatever the component did with the error — a missing element, an empty
   * list — and the warning that explains it scrolls past in the run output. As
   * an error, the failure names the method and URL that had no handler.
   *
   * `apps/web/src/api/request.test.ts` is unaffected: it replaces the global
   * `fetch` outright, so MSW never sees those requests.
   */
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  cleanup()
  /**
   * Drop per-test overrides installed with `server.use(...)`.
   *
   * Without this, a test that makes `GET /issues/:key` return `permission_denied`
   * leaves it that way for every later test in the file, and the failures land on
   * whichever test happens to run next — the shape of bug that reproduces only
   * in CI's ordering and never when run alone.
   */
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
