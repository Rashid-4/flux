import { defineConfig } from 'vitest/config'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Unit tests. No database, no network, no container. Runs on every commit.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §9 splits this suite in three, and the split is by
 * *what the test needs to exist*, not by what it is about. This config owns the
 * tier that needs nothing: pure logic, hand-built inputs, and doubles for
 * anything with I/O. `vitest.integration.config.ts` owns the tier that needs a
 * real Postgres, because RLS, triggers and constraints are the things under test
 * there and no mock can exercise them.
 *
 * ### The exclusion is the whole point of having two configs
 *
 * `src/**\/*.test.ts` matches `src/**\/*.integration.test.ts` as well — the
 * suffix is a longer name, not a different extension. Without the `exclude`
 * below, `pnpm test` would pull the integration suite into the DB-free job,
 * where it fails on a missing `DATABASE_URL` with an error about environment
 * variables rather than about anything a reviewer changed.
 *
 * That failure is the *good* outcome. The bad one is the same mistake in the
 * other direction: a suite that silently runs zero files. `pnpm test` at the
 * repository root is the DB-free job by construction — `packages/db-tests` has
 * no `test` script at all for this reason — and this config is what keeps that
 * true for a service that has both kinds.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules', 'dist'],

    /**
     * Unit tests here have no shared state — no database, no ports, no files —
     * so file-level parallelism is free and worth having.
     */
    fileParallelism: true,

    /**
     * `disableConsoleIntercept` is deliberately NOT set, unlike the integration
     * config. These tests assert on values, not on schema facts printed for a
     * future reader, and a passing unit suite that logs is a suite whose output
     * nobody reads.
     */
    clearMocks: true,
    restoreMocks: true,
  },
})
