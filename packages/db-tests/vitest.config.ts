import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],

    /**
     * One shared database, so files must not run concurrently.
     *
     * Most tests here roll back, but not all of them can: the audit hash chain
     * is only meaningful across committed rows, and the connection-reuse test
     * needs two sequential transactions on one physical connection. Two files
     * doing that at once would see each other's rows and fail in ways that look
     * like flakiness rather than like a shared-state bug — and a flaky
     * integration suite gets skipped, which returns us to having none.
     */
    fileParallelism: false,

    /** Container start, 16 migrations and a seed all happen before the first
     *  assertion. The default 5s fails on a cold CI runner for no real reason. */
    testTimeout: 30_000,
    hookTimeout: 60_000,

    globalSetup: ['./src/global-setup.ts'],

    /** Vitest hides `console.log` from passing tests by default; these tests
     *  print the schema facts they assert, which is what makes a CI log useful
     *  when something regresses six months from now. */
    disableConsoleIntercept: true,
  },
})
