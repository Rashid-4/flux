# AGENTS.md — read this before writing any code

This repository is built by **several AI agents that never talk to each other**,
coordinated by one human. This file is the shared contract between them. GitHub
Copilot, Claude Code, and Cursor all read it automatically.

If you are an agent working in this repo: read the whole file. It is short, and
every rule in it exists because breaking it costs a day of rework.

---

## 1. Who owns what

Ownership is enforced by CI (`.github/workflows/ci.yml` → `frozen-paths`), not by
trust. A pull request that edits a path it does not own **fails the build**.

| Path | Owner | Everyone else |
| --- | --- | --- |
| `db/migrations/**` | Architecture (Claude Opus) | **read-only** |
| `db/bootstrap/**` | Architecture | **read-only** |
| `packages/contracts/**` | Architecture | **read-only** |
| `packages/db-tests/**` | Architecture | **read-only** |
| `scripts/**` | Architecture | **read-only** |
| `docs/adr/**` | Architecture | **read-only** |
| `docs/specs/**` | Architecture | **read-only** |
| `.github/**` | Architecture | **read-only** |
| `AGENTS.md`, `CLAUDE.md` | Architecture | **read-only** |
| `services/api/**` | Backend build agent | read |
| `services/worker/**` | Backend build agent | read |
| `apps/web/**` | UI agent | read |
| `apps/marketing/**` | UI agent | read |
| `docs/change-requests/**` | **anyone** — see §2 | — |

Backend and UI trees are disjoint on purpose: two agents can work in parallel on
separate branches and their merges cannot conflict.

`services/` and `apps/` are created *entirely* by the agents that own them,
including their `package.json`, tsconfig, and framework wiring. The architecture
layer does not put code there — it specifies, in `docs/specs/`, what that code
has to do. Specs and code are kept in separate trees on purpose: a file one agent
owns sitting inside a directory another agent owns is precisely the ambiguity this
table exists to remove.

## 2. When a contract is wrong, do not fix it — report it

You *will* hit cases where a type in `packages/contracts` or a column in
`db/migrations` is missing something you need. That means the spec was wrong,
which is normal and expected.

**Do not edit it.** Instead:

1. Create `docs/change-requests/NNN-short-title.md` (next free number).
2. State: what you were implementing, what the contract says, why it does not
   work, and the minimum change you need.
3. Stop work on that specific piece and continue with the rest.

The human takes it back to the architecture agent, the contract is amended, you
pull. This is slower than editing it yourself by about ten minutes, and it is the
entire difference between one coherent architecture and three forked ones.

Template: `docs/change-requests/TEMPLATE.md`.

## 3. The module specs are the source of truth for behaviour

Every backend module has a spec at `docs/specs/api/<module>.md`. It specifies the
transaction boundaries, which events to emit, which error codes to return, and
the tests that must pass. UI surfaces have specs at `docs/specs/web/<surface>.md`.

- Build to the spec, not to your instincts about how a Jira clone should work.
- If the spec and the code disagree, the spec wins.
- If the spec is silent on something, that is a change request (§2), not a
  licence to improvise.
- Each spec ends with a **Definition of done** checklist. Tick it in your PR
  description. The review agent verifies against that checklist, so a module
  without it ticked cannot be reviewed properly.

## 4. Non-negotiable architecture rules

These are not style preferences. Each one is load-bearing, and each has an ADR in
`docs/adr/` explaining what breaks without it.

**Multi-tenancy**
- Tenant isolation is enforced by PostgreSQL Row-Level Security, *not* by
  `WHERE organization_id = ?` in application code.
- Every request opens a transaction and issues
  `SET LOCAL flux.organization_id = $1` before any query. No exceptions, no
  "internal" queries that skip it.
- The API connects as the `flux_app` role, which is `NOBYPASSRLS`. Never connect
  as `flux_migrator` or `flux_relay` from request-handling code.
- Never add `bypassrls` or superuser to an application role to make a test pass.

**The write path is sacred**
- Issue create/update/transition has a **150ms p95 budget**. Everything that is
  not required for correctness happens off the event stream.
- Do NOT do these synchronously inside a write: search indexing, analytics,
  notification fanout, webhook delivery, automation rules, email.
- Side effects are triggered by publishing to `event_outbox` **in the same
  transaction as the domain write** (`flux_emit_event()`), never by calling
  another service inline. Write-then-publish as two operations is not atomic and
  produces permanent silent divergence.

**Events**
- Delivery is at-least-once. Every consumer must be idempotent on `event_id`
  (`dedupeKey()` in `@flux/contracts`).
- Ordering is guaranteed per aggregate only. Never assume global ordering.
- Event payloads evolve additively. Removing or retyping a field is a new
  `version`, and old versions stay supported until every consumer has drained.

**Data**
- Never hard-delete tenant data. Use `deleted_at` / `archived_at`.
- `issue_history_events` and `audit_log` are append-only, enforced by Postgres
  RULES. Do not attempt UPDATE or DELETE on them; it silently affects 0 rows.
- All writes to versioned entities take a `version` and return 409
  `version_conflict` on mismatch. Never last-write-wins.
- Issue creation requires an `idempotencyKey`. It is mandatory, not optional.

**Permissions**
- `evaluatePermission()` in `@flux/contracts/permission` is the ONLY place a
  permission decision is made. Do not write a second check inline, do not
  shortcut it, do not cache its result across requests.
- Deny rules do not exist. Grants are allow-only and effective permissions are a
  union. Do not add a deny concept.

**Shared logic**
- If a rule must give the same answer on the client and the server, it lives in
  `packages/contracts` as a pure function. Never implement it twice.
  Existing examples: `validateWorkflowGraph`, `evaluatePermission`,
  `canBeChildOf`, `valueSchemaFor`, `rank.between`.

**Queries**
- All filtering goes through the FQL AST (`FilterNodeSchema`) compiled to
  parameterised SQL. There is no raw-SQL escape hatch and you must not add one.
- Pagination is cursor-based. Never `OFFSET`.

**Secrets**
- Credentials are never stored in application tables. Store a `*_ref` pointing at
  the secret manager (see `import_jobs.credential_ref`).
- Never commit `.env`. Never put a real secret in `.env.example`, a test fixture,
  a log line, or an error message.

## 5. Conventions

- **TypeScript**: strict, with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`. Optional properties in hand-written types that
  mirror a zod schema need an explicit `| undefined`.
- **Imports**: ESM with `.js` extensions on relative imports
  (`import { x } from './y.js'`), even in `.ts` files.
- **Ids**: branded types from `@flux/contracts/ids`. Generate with `newId<'IssueId'>()`
  (UUIDv7, time-ordered). Do not use `crypto.randomUUID()` for persisted rows.
- **Validation**: every request boundary parses with the zod schema from
  `@flux/contracts`. Never hand-roll a shape check.
- **Errors**: throw `FluxError` with a code from `ErrorCodeSchema`. The HTTP
  status is derived from the code — do not set it manually.
- **Time**: UTC on the wire, ISO-8601 strings. Localise only for display.
- **Money/points**: never floats for currency. Story points may be fractional.
- **Comments**: explain *why*, not *what*. Match the density of the surrounding
  file — the existing code is commented heavily where a decision is non-obvious
  and not at all where it is.
- **No new dependencies** without a change request. A 40-package transitive tree
  for a date helper is a real cost.

## 6. Before you open a PR

Run these locally. CI runs the same commands, so a failure here is a failure
there.

```bash
pnpm typecheck && pnpm lint && pnpm test
```

For anything touching the database, also:

```bash
pnpm db:up && pnpm db:migrate && pnpm check:rls
```

`check:rls` asserts that every tenant table has RLS enabled *and* forced *and*
has a policy, and that `flux_app` holds neither `BYPASSRLS` nor `SUPERUSER`. If
you add a tenant-scoped table, enable RLS in the **same migration** that creates
it — a table that ships without a policy is a silent cross-tenant data leak.

## 7. Branching

- One agent per branch. Never two agents on the same branch.
- `feat/api-<module>` for backend, `feat/ui-<surface>` for UI.
- Merge to `main` only with CI green.
- Never force-push `main`. Never `git checkout .` or `git reset --hard` over work
  you did not write — if you think you need to, stop and ask the human.

## 8. Things that look like bugs and are not

Before "fixing" any of these, read the linked file. They are deliberate, tested,
and load-bearing.

- **`Brand<T,B>` uses a `__brand` phantom property, not `unique symbol`.**
  A `unique symbol` breaks `declaration: true` with TS4023 across ~60 schemas.
  See the comment in `packages/contracts/src/ids.ts`.
- **`users` is not RLS-protected.** Identity is global so one login can belong to
  several organizations. Tenant-specific data lives on `org_memberships`, which
  *is* protected. See `db/migrations/0002_identity.sql`.
- **`event_outbox` has no RLS policy** and `flux_app` has INSERT-only on it. It is
  the one documented exemption in `scripts/check-rls.mjs`.
- **Ranks are opaque base-36 strings, not numbers.** Never parse, compare
  numerically, or generate them client-side. See `packages/contracts/src/rank.ts`.
- **Rich text is a ProseMirror-shaped document, never an HTML string.** Do not add
  an HTML sanitiser; there is nothing to sanitise.
- **A trigger derives `issues.status_category` from `status_id`.** Do not set it
  from application code; it will be overwritten, correctly.
