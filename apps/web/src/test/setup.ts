import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Runs once per test file, before it (`setupFiles` in vitest.config.ts).
 *
 * `/vitest` on the jest-dom import, not the bare path: that entry point
 * registers the matchers with Vitest's `expect` rather than Jest's, and without
 * it `toHaveAccessibleName()` is a type error and `toBeVisible()` is undefined
 * at run time.
 *
 * The cleanup is explicit because `globals: false`. Testing Library's automatic
 * cleanup hooks itself onto a global `afterEach`, which does not exist here, so
 * without this every test file leaks its mounted trees into the next one — and
 * the symptom is `getByRole` finding two buttons in a test that rendered one.
 */
afterEach(() => {
  cleanup()
})
