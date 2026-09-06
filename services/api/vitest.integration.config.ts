import { defineConfig } from 'vitest/config'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Integration tests. Real Postgres, real RLS, real triggers.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §9: "Never a mock: the whole point is that RLS,
 * triggers, and constraints are doing work, and a mock cannot exercise any of
 * them." Everything this suite asserts about tenant isolation is a claim about
 * PostgreSQL's behaviour, so a double proves only that the double was written to
 * agree with the assertion.
 *
 * ### No Testcontainers, for the reason `packages/db-tests` gives
 *
 * CI already runs Postgres as a service container and `pnpm db:up` already runs
 * one locally with `db/bootstrap` mounted into the entrypoint — which is where
 * the unprivileged `flux_app` role is created. A third way to obtain a database
 * means this suite can pass against a container CI does not use, and since the
 * bootstrap *is* the isolation boundary, a subtly different container is a suite
 * that proves nothing. So the database is taken as given, through the same two
 * environment variables, and the harness fails loudly when they are absent
 * rather than skipping itself.
 *
 * ### Why this suite does not reuse `@flux/db-tests`
 *
 * It looks like duplication and is not. That package asserts properties of the
 * *schema* — that RLS is forced, that the audit chain detects tampering — and it
 * is frozen so those assertions cannot be relaxed to unblock a feature. This
 * suite asserts that the *service* reaches the schema correctly: that
 * `withTenant` sets four GUCs and not two, that a pooled connection cannot carry
 * a tenant across requests, that a handler which forgets its scope gets nothing.
 * Same database, different subject.
 *
 * The one thing it deliberately shares is the environment contract, so adding
 * this suite required no change to CI.
 *
 * ### Fixtures are created per run, not from fixed ids
 *
 * `@flux/db-tests` seeds constant UUIDs and deletes them on teardown. This suite
 * mints fresh UUIDv7s instead. Two suites with fixed ids against one database is
 * a teardown race that reads as flakiness — and a flaky integration suite gets
 * skipped, which returns the repository to having none.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],

    /**
     * One shared database. Not every test here can roll back — proving that a
     * `SET LOCAL` does not survive into the next transaction requires two
     * sequential *committed* transactions on one physical connection — so two
     * files doing that at once would see each other's rows.
     */
    fileParallelism: false,

    /** A cold CI runner has to start a container and apply 17 migrations before
     *  the first assertion. The 5s default fails on that for no real reason. */
    testTimeout: 30_000,
    hookTimeout: 60_000,

    globalSetup: ['./src/test/global-setup.ts'],

    /** These tests print the facts they assert — pool sizes, GUC values, the
     *  SQLSTATE that came back. That is what makes a CI log useful when
     *  something regresses six months from now. */
    disableConsoleIntercept: true,
  },
})
