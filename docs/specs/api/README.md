# API specs — foundation

Read this before any individual module spec. Everything in `docs/specs/api/` is
written assuming what is here, and none of it is repeated per module.

The build agent creates and owns everything under `services/api/`, including its
`package.json`, tsconfig, and framework wiring. This directory says what that code
must *do*. Where a decision is already made below, it is made — implement it
rather than re-deciding it, because three modules that each chose their own
transaction strategy is not a codebase.

---

## 1. Module layout

```
services/api/src/
  main.ts                  bootstrap
  app.module.ts            wires the modules below
  database/                pool, tenant transaction helper, migrations runner glue
  http/                    filters, interceptors, request context
  auth/                    OIDC verification, session, subject resolution
  identity/                organizations, users, memberships, teams
  projects/                projects, issue types, components, versions, roles
  fields/                  field library, layouts, value read/write
  workflows/               workflow families, versions, transitions, rule engine
  permissions/             grant storage, evaluation, simulation
  issues/                  issues, comments, links, attachments, history
  boards/                  boards, columns, sprints, backlog, ranking
  search/                  FQL compiler, Meilisearch sync, saved views
  events/                  outbox writer, relay, consumer registry
  imports/                 import/export jobs, findings, entity map
```

One module per bounded concept, and modules talk to each other through injected
services with typed interfaces — never by importing each other's repositories.
That is what makes it possible to extract one into its own process later without
rewriting its callers. It is a modular monolith on purpose: the operational cost
of microservices before there are users is real, and the coupling they are
supposed to prevent is prevented here by module boundaries instead.

## 2. Database access — the one non-negotiable primitive

**Every query the API issues goes through one helper.** There is no exported pool,
no `query()` convenience function that skips it, and there must never be one.

```ts
withTenant(pool, { organizationId, actorUserId }, async (client) => {
  // all reads and writes for this request happen here
})
```

What that helper must do, in this order:

1. `pool.connect()` — check out **one** connection and hold it for the whole
   transaction.
2. `BEGIN`.
3. `SELECT set_config('flux.organization_id', $1, true)`.
4. `SELECT set_config('flux.actor_id', $1, true)` — empty string when there is no
   user, because `current_setting` returns `''` for an unset GUC and the audit
   trigger reads `''` as "system".
5. `SET LOCAL statement_timeout = <ms>` — default 10000, and the write path
   should pass lower.
6. Run the callback.
7. `COMMIT`, or `ROLLBACK` on throw. Release the connection in a `finally`.

Four details are load-bearing, and each one is a silent failure if you get it
wrong rather than an error you would notice:

**`SET LOCAL`, never `SET`.** `SET LOCAL` is transaction-scoped and reverts on
COMMIT or ROLLBACK. Plain `SET` persists for the life of the *connection*, and
connections are pooled — so one `SET` leaks the previous request's tenant into
whichever request borrows that connection next. This is the single most dangerous
line of code it is possible to write in this codebase.

**One connection, checked out for the whole transaction.** `pool.query()` picks an
arbitrary idle connection per call, so `SET LOCAL` on one call and a `SELECT` on
the next can land on different connections. The setting would be gone and the
SELECT would run with no tenant context.

**`set_config(..., true)`, not string interpolation.** `SET` does not accept bind
parameters. Interpolating into a `SET` statement would put an injection point on
the one value the entire security model rests on.

**No network I/O inside the callback.** An HTTP call to a webhook while holding a
transaction is how a connection pool gets exhausted under load. Side effects go
to the outbox and happen after commit.

### The relay exception

The outbox relay and the analytics ingester read across every tenant by
definition. They get a **separate pool built from `flux_relay` credentials** and a
separate, deliberately awkward helper name. This is not available to request
handlers. If a request handler appears to need it, either the requirement is wrong
or the query is — one of those two, every time.

It also cannot be abused by accident: `flux_app` is `NOBYPASSRLS`, so calling the
cross-tenant path with the request pool returns nothing rather than everything.
Failing closed is the design, not a happy accident.

### What must be true when you are done

An integration test, against a real Postgres, that:

- two organizations' rows are both present, and a `withTenant` call for org A
  returns only A's rows;
- a query issued outside `withTenant` returns **zero** rows, not all rows;
- an insert with a mismatched `organization_id` raises
  `new row violates row-level security policy`;
- after a transaction that set tenant A commits, the *same pooled connection*
  reused for tenant B sees only B's rows (this is the `SET` vs `SET LOCAL` test,
  and it is the one that matters most — run it by exhausting the pool to size 1);
- a throw inside the callback leaves no rows behind.

## 3. Request lifecycle

### Base path

Every path written in a module spec is relative to **`/api/v1`**. The specs write
`POST /issues`; the route is `POST /api/v1/issues`. Mount the router once at that
prefix rather than repeating it per route, and never let a path in a spec be read
as absolute — the UI agent is reading the same specs and hardcoding a base path in
its request layer, so a mismatch here surfaces as a 404 at integration time
instead of a type error while either side is being written.

Two things sit *outside* the prefix and are not versioned, because they are
operational rather than product surface: `GET /health` (liveness, no auth, no DB)
and `GET /ready` (readiness — checks the pool and the migration head).

`v2` means a second mounted router, not a rewrite. Version the prefix, not
individual endpoints: `/api/v1/issues` and `/api/v2/issues` may coexist, but
`/api/v1/issues/v2` may not.

```
request
  → verify OIDC token            → 401 unauthenticated
  → resolve subject              → SubjectContext (userId, orgRole, teamIds, projectRoleIds)
  → resolve organization         → 403 org_access_denied if not a member
  → parse body with zod          → 422 validation_failed
  → withTenant(...)
      → evaluatePermission(...)  → 403 permission_denied
      → domain work
      → flux_emit_event(...)     same transaction
    COMMIT
  → serialise response through the contract schema
```

The order is deliberate. Authentication before subject resolution, subject
resolution before permissions, validation before the transaction opens (so a
malformed request never holds a connection), and permissions **inside** the
transaction (so the grants you evaluate against cannot change under you between
check and write).

## 4. Permissions

`evaluatePermission()` from `@flux/contracts/permission` is the only place a
permission decision is made. Not "the preferred place" — the only one.

- Never write a second inline check. Two implementations of an authorization rule
  diverge, and the one that diverges upward is a data leak.
- Never cache a decision across requests. Grants change; a cached allow outlives
  the revocation that was supposed to stop it.
- Load the grants for the subject inside the transaction.
- For issue-scoped checks, pass the `IssueContext`. Relative subject kinds
  (`reporter`, `assignee`, `project_lead`, `component_lead`) cannot be evaluated
  without it, and the function is written to **deny** rather than guess — do not
  "helpfully" pass a partial context to make a check pass.

The "view as user" simulator calls this same function with the same arguments.
That is the whole reason it can be trusted: a simulator that reimplements the
rules tells you about the simulator, not about the product.

## 5. Writes

Every write path:

1. Opens exactly one transaction.
2. Validates the request against its zod schema.
3. Checks permission.
4. Checks optimistic concurrency where the entity is versioned: the client sends
   `version`, and a mismatch is `409 version_conflict`. Never last-write-wins —
   silently discarding someone's edit is worse than making them retry.
5. Performs the domain write.
6. Appends history where the entity has a history table.
7. Calls `flux_emit_event(...)` **in the same transaction**.
8. Commits.

**Nothing else happens inline.** Not search indexing, not notification fanout,
not webhook delivery, not automation evaluation, not analytics, not email. The
issue write path has a **150ms p95 budget** and those things cannot fit in it —
but the real reason is correctness: an inline side effect that fails either fails
the user's write or is silently lost, and neither is acceptable.

Issue creation requires an `idempotencyKey`. It is mandatory. A create that
retries after a network timeout must return the original issue, not a duplicate.

## 6. Events

- Emit with the DB function `flux_emit_event(...)`, inside the write transaction.
  Never publish to the broker from application code — write-then-publish is two
  operations and is not atomic, and the divergence it produces is permanent and
  silent.
- Delivery is **at-least-once**. Every consumer must be idempotent on `event_id`;
  use `dedupeKey()` from `@flux/contracts`.
- Ordering is guaranteed **per aggregate** only. Never assume global ordering.
- Payloads evolve additively. Removing or retyping a field means a new `version`,
  and the old version stays supported until every consumer has drained.

## 7. Errors

Throw `FluxError` with a code from `ErrorCodeSchema`. The HTTP status is derived
from the code — never set it by hand, or the same logical failure will return 400
from one module and 422 from another.

**The vocabulary is closed, and it is closed at the contract, not per module.** If
a module needs a code that is not in `ErrorCodeSchema`, that is a change request
against `packages/contracts` — not a new string, and not a neighbouring code
bent to fit. `pnpm check:errors` fails the build if any spec names a code the enum
does not have, or documents one with a status other than the one
`HTTP_STATUS_BY_CODE` assigns it. That check exists because the specs originally
named 45 codes the contract did not have, most of them near-duplicates of one it
did.

A code exists when the *client's* response to it differs, not when the server's
reason differs. That is why there is one `not_found` rather than one per entity,
one `in_use` rather than six `*_in_use`, and one `confirmation_required` rather
than one per thing needing confirmation. What varies goes in the error body:

| Field | On | Carries |
| --- | --- | --- |
| `fields[].path` | any 422, and `not_found` | which reference or input failed |
| `blockedBy`, `blockedByTotal` | `in_use`, `cannot_remove_last` | what is in the way, truncated, plus the true total |
| `confirmField`, `confirmValue` | `confirmation_required` | what to resend, and the value the server computed |
| `currentVersion` | `version_conflict` | the version the server holds |
| `requiredPermission` | `permission_denied` | the permission that was missing |

Populating these is not optional polish. A 409 that says only "in use" is a refusal
the user cannot act on, and the fix they reach for is to stop trusting the check.

The 400/422 line: **400 means the request could not be parsed, 422 means it was
parsed and is wrong.** A zod failure is 422.

An error must never contain a credential, a token, a connection string, or another
tenant's data. The message is for the caller; the detail goes to the log with the
trace id.

## 8. Queries

- All filtering compiles from the FQL AST (`FilterNodeSchema`) to parameterised
  SQL. There is no raw-SQL escape hatch and you must not add one — that AST is
  what makes filters safe, statically analysable, and shareable between search,
  boards, automation conditions, and dashboards.
- Pagination is cursor-based. Never `OFFSET`: it gets slower the deeper you go and
  it silently skips or repeats rows when the underlying data changes mid-scroll.
- Every list endpoint has a hard maximum page size. An unbounded list is a
  denial-of-service vector that arrives as a feature request.
- Watch for N+1. A list of 50 issues must not issue 50 queries for assignees.

## 9. Testing

Three tiers, and a module is not done without all three:

- **Unit** — pure logic, no database. Fast, run on every commit.
- **Integration** — against a real Postgres via Testcontainers. Never a mock:
  the whole point is that RLS, triggers, and constraints are doing work, and a
  mock cannot exercise any of them. Name these `*.integration.test.ts`.
- **Isolation** — for every module that touches tenant data, at least one test
  that proves org A cannot see org B's rows through *that module's own code path*.

Fixtures create two organizations. Always two. A single-tenant fixture cannot
fail the test that matters.
