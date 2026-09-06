import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: the real browser, the real bundle, the real router.
 *
 * ### What belongs here and what does not
 *
 * Vitest + Testing Library already covers "does this component render the right
 * thing for these props", in jsdom, in milliseconds. Duplicating that here buys
 * nothing and costs a browser launch per file. What only a real browser can check,
 * and therefore what these specs are for:
 *
 * - **Drag and drop.** The board's core interaction is pointer events against real
 *   layout. jsdom has no layout, so `getBoundingClientRect()` returns zeros and a
 *   drag test there asserts nothing.
 * - **Virtualised scrolling.** `@tanstack/react-virtual` measures elements. Same
 *   problem: no layout, no measurement, no windowing.
 * - **Keyboard journeys across routes.** Tab order, focus restoration after a
 *   dialog closes, `⌘K` from anywhere — all of which depend on the browser's own
 *   sequential focus navigation rather than on React.
 * - **The theme applying before first paint.** The pre-paint script in index.html
 *   runs before the bundle; whether it works is a rendering question.
 * - **Axe against a fully composed page.** Per-component axe assertions live in
 *   the unit tests; landmark structure, heading order and duplicate-id violations
 *   only exist once the whole shell is assembled.
 *
 * ### `retries: 0`, deliberately
 *
 * The reflex is `retries: process.env.CI ? 2 : 0`, and it is worth saying why not.
 * These specs talk to MSW in the page, not to a network — there is no upstream to
 * be slow and nothing legitimate to retry *through*. So a spec that passes on
 * attempt two is reporting a real race in the product: a state update that lands
 * after paint, an animation the assertion runs into, a query that refetches when it
 * should not. Retrying hides exactly the class of bug §1 of docs/product-quality-bar.md
 * is about, and hides it behind a green tick. If a spec is flaky, that is the bug.
 *
 * `forbidOnly` in CI is the matching rule for the other direction: a `test.only`
 * left in a commit turns a suite of forty specs into a suite of one, and reports
 * success.
 */
export default defineConfig({
  testDir: './e2e',
  // A spec that needs longer than 15s is not waiting for the product, it is
  // waiting for a selector that will never match.
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Spread rather than `workers: process.env.CI ? 2 : undefined`. Under
  // `exactOptionalPropertyTypes` an explicitly-passed `undefined` is not the same
  // thing as an absent key, and only the absent key means "use Playwright's
  // default" — which locally is half the cores. Two in CI, where the runner has two.
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    // Retained only on failure: a trace is ~2MB and the useful ones are the
    // failing ones. With retries at 0 there is no "on-first-retry" to hook.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * The same specs under `prefers-reduced-motion: reduce`. This is a project
     * rather than a separate suite because the point is that *nothing changes* —
     * `tokens.css` clamps every animation to 1ms with
     * `animation-iteration-count: 1`, so every interaction must still complete and
     * every assertion must still pass. The way reduced-motion support usually
     * breaks is a transitionend handler that never fires, and only running the real
     * journeys with the flag on finds it.
     */
    {
      name: 'chromium-reduced-motion',
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
  ],
  webServer: {
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173',
    // Locally, reuse whatever is already running — waiting 4s for a second vite
    // to boot on every run is how people stop running the suite.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
