# services/api

The flux API. A modular monolith over PostgreSQL where **tenant isolation is
enforced by row-level security, not by `WHERE` clauses** — every query goes
through `withTenant()`, and a handler that forgets to scope itself gets no rows
rather than everyone's.

The design lives in [`docs/specs/api/README.md`](../../docs/specs/api/README.md)
and the ten module specs beside it. This file is the other half: the decisions
that only exist because this code had to run, and the things measured while
making it run that are not visible from reading it.

Read [`AGENTS.md`](../../AGENTS.md) before changing anything here.

---

## Running it

```bash
pnpm db:up                                   # Postgres + Redis, bootstrap mounted
pnpm db:migrate                              # 0001–0017
cp services/api/.env.example services/api/.env
pnpm --filter @flux/api dev                  # tsx watch, http://127.0.0.1:3000
```

`GET /health` answers without touching the database; `GET /ready` acquires a
connection and reads `schema_migrations`. Both are outside `/api/v1` and outside
authentication, which is [§3](../../docs/specs/api/README.md).

### The database this was verified against

Everything in this service was verified against **the container `pnpm db:up`
starts, or an equivalent one on a different port**, never against a mock.

`docker-compose.yml` publishes `5432:5432` and is frozen. On a machine where
5432 is already bound — a system Postgres, another project's compose file —
`pnpm db:up` fails to bind and there is no override flag. The workaround is a
container with the same image and the same `db/bootstrap` mount on another port,
with `DATABASE_URL` pointed at it. That is what the migrations and the
`postgres:17-alpine` measurements in `tenant.ts` were run against here, on port
55444.

This is written down because "verified against a real Postgres" is a claim about
the bootstrap as much as the server: `db/bootstrap/00-roles.sql` is what creates
the unprivileged `flux_app` role, and **the bootstrap is the isolation
boundary**. A container started without it has a superuser where the tests
expect a role that cannot bypass RLS, and every isolation assertion in the suite
would pass for the wrong reason.

## Environment

`src/config.ts` parses `process.env` once, at boot, before the HTTP server
exists, and reports every problem rather than the first. Nothing else in this
service reads `process.env`.

[`.env.example`](.env.example) documents every variable. Two rules the file
exists to enforce:

- **No value from the environment is reproduced in a failure message.**
  `DATABASE_URL` carries a password and the message goes to a log. `z.string()
  .url()` would embed the value it rejected; `z.enum` echoes `received 'prod'`;
  and `integerVar` echoed without bound, which matters because the realistic
  wrong value for `PORT` is not a typo but *another variable's value pasted one
  line off*. `config.test.ts` sweeps **every key in `EnvSchema.shape`** with a
  credential-shaped value rather than checking a list of "the secret ones", so a
  variable added next year is covered the day it is added.
- **`describeTarget()` is the only representation of `DATABASE_URL` that may be
  printed.** It rebuilds host, port, database and user field by field rather
  than deleting `password` from a parsed URL and re-serialising, because
  `URL.toString()` preserves what it does not recognise and libpq accepts
  `?password=` as a query parameter.

There is deliberately **no `DATABASE_RELAY_URL`**. The outbox relay needs
`flux_relay`, which holds `BYPASSRLS` because draining the outbox is cross-tenant
by definition, and it is a separate deployable for exactly that reason. If this
process held those credentials, every isolation guarantee in the product would
rest on no code path in a large API ever reaching the wrong pool — a promise
about future code, which is the weakest kind there is.

## The build

`pnpm --filter @flux/api build` runs `tsc -p tsconfig.json` for the typecheck and
`tsup` for the artifact: **one ESM file plus a sourcemap**, first-party code
bundled, everything in `dependencies` external. `src/tsup.config.ts` carries the
full reasoning; three consequences are worth having here.

**It is bundled because `@flux/contracts` publishes TypeScript source.** Its
`exports` map points at `./src/index.ts`, which is all `apps/web` ever needed
through Vite. Node cannot load a `.ts` file, so a `tsc`-only build would emit
`import … from '@flux/contracts'` into `dist/` and throw on the first import at
startup. Widening that exports map with a `dist` condition is the correct
long-term fix and is a **change request**, not an edit — `packages/contracts/` is
frozen precisely so a service does not reshape a shared contract to make its own
build work.

**`emitDecoratorMetadata` is not available, and that is load-bearing.** esbuild
implements `experimentalDecorators` but cannot implement
`emitDecoratorMetadata`, which needs the type checker. So Nest's reflection-based
injection — `constructor(private readonly x: Thing)` — does not work in this
build; it fails at boot as `Nest can't resolve dependencies of … (?)`, with an
argument index in place of a name. **Every provider declares its dependencies
with an explicit `@Inject(TOKEN)`**, and the tokens live beside the thing they
name (`CONFIG` in `config.ts`, `LOGGER` in `logger.ts`, `APP_POOL` in
`pool.ts`). This is not a grudging workaround: §1 already requires modules to
talk through typed interfaces, an interface has no runtime value to reflect, so
tokens were required for every cross-module dependency regardless.

**`fastify` is pinned exactly, at `5.12.1`.** Not `^5.12.1`. Nest 12's
`@nestjs/platform-fastify` declares its own `fastify` dependency, and when the
two resolve to different minors the adapter's types and the instance's types are
structurally identical but nominally distinct — a `FastifyInstance` from one tree
is not assignable to a parameter typed by the other, and the error names the same
interface on both sides of "is not assignable to". Two *minors* apart was enough
(5.12.1 against 5.12.3). Changing this pin means checking
`@nestjs/platform-fastify`'s resolved version first.

## HTTP

### Nest owns both of Fastify's error hooks

This service registers **neither** `setErrorHandler` nor `setNotFoundHandler`.
`NestApplication.registerRouterHooks()` calls both, from inside `init()`, which
runs on the first `listen()` or `inject()`. Registering ours first failed the
boot outright:

```
Error: Not found handler already set for Fastify instance with prefix: '/'
```

That is the *good* failure mode, and it was found in eight seconds. The half
worth remembering is the other one: **`setErrorHandler` replaces silently**, so
ours would not have failed — it would have been overwritten during `init()` and
become unreachable code that every test of it passed against, while Nest's
handler produced correct-looking responses beside it.

So both paths converge on one Nest exception filter, `ApiErrorFilter`, and
`mapException` is what brings the pre-handler failures there: anything with
`name === 'FastifyError'` and a numeric `statusCode` becomes an `HttpException`
carrying that status. A malformed body, a body over `bodyLimit`, an unsupported
content type and an unknown path all answer in **our** shape rather than
`{"statusCode":400,"code":"FST_ERR_CTP_INVALID_JSON_BODY",…}`.

### `foreignCode` is structurally empty for pre-handler failures

`mapException` constructs a fresh `HttpException` from a status and a message and
sets no `cause`, so everything the original Fastify error carried is gone before
any filter sees it. Measured against a running service: a `{` body logs
`foreignStatus: 400` and `foreignMessage: "Body is not valid JSON but
content-type is set to 'application/json'"`, **with no `foreignCode` key at
all**.

The field is kept because it is not *always* empty — a library throwing its own
coded exception from inside a handler arrives intact — but **nothing should be
aggregated on it**. `foreignStatus` partitions the pre-handler failures exactly
as finely and `foreignMessage` names the refusal in words. `api-error.test.ts`
pins both directions, so this cannot quietly become true again or quietly stay
false.

### A 413 is answered as a 400, on purpose, and it is the one status that is wrong

`CODE_BY_FOREIGN_STATUS` maps a foreign status to one of our codes, and the code
then determines the status we send. The two agree for every entry except 405 and
413.

**405 → `not_found`** because a distinct "method not allowed" confirms the path
exists, which is the disclosure `not_found` refuses for a row the caller may not
see.

**413 → `malformed_query`, so a 413 leaves as a 400.** There is no 413 code in
the closed enum and inventing one is a contract change, not a decision made in a
handler.
[`docs/change-requests/010-payload-too-large-error-code.md`](../../docs/change-requests/010-payload-too-large-error-code.md)
asks for `payload_too_large`. Until it resolves, the status is wrong by one hop
and the *message* is right, which is the trade the quality bar §13 rule 2 asks
for — and it is written in three places rather than being a surprise in a network
panel.

### `reply.sent` does not mean `send()` was called

`reply.sent` is `(hijacked || raw.writableEnded) === true` (`fastify@5.12.1/
lib/reply.js:107`) — **the socket must have ended**. A handler that writes
`reply.raw` directly and then throws reaches the error path with `sent === false`
and `raw.headersSent === true`. The guard in `error-reporting.ts` used to read
`sent` alone, and let that case straight through into `reply.send`.

Its own comment said writing again throws `FST_ERR_REP_ALREADY_SENT` and the
request hangs. Both halves are false. `reply.js:161` shows a `send()` on a sent
reply is a `log.warn` and a no-op — that error is only ever constructed as the
warning's `err` field, never thrown. And the real chain is worse than a hang:
`reply.send` → `safeWriteHead` rethrows Node's `ERR_HTTP_HEADERS_SENT`
(`reply.js:583`) → `handleError`'s `catch` calls `reply.send(err)` → the chain
walks to `fallbackErrorHandler`, whose callback (`error-handler.js:35-42`) calls
`raw.writeHead` inside a `try`, logs the failure, **and then calls `raw.writeHead`
again outside it**. That second one is uncaught. **The worker process exits**,
taking every other in-flight request with it, from inside the function documented
as "never throws".

The guard now reads `reply.sent || reply.raw.headersSent`, logs which of the two
fired because the remedies differ, and — this is the second half —
`reply.raw.end()`s an abandoned socket. Returning alone is not enough: Fastify's
`handleError` does nothing further when the error handler returns `undefined`
(`error-handler.js:60-72`), so the connection stays open until a proxy times it
out, which under load is a connection leak rather than one bad response.

Two limits are recorded in that file's `WHAT THIS DOES NOT CHECK`, both measured:
a **hijacked** reply that then throws never invokes the error handler at all, so
a handler that hijacks owns its own failure path; and a **custom per-reply
serialiser** stays attached across the error path, so it throws again on our
error body and Fastify answers in its own shape. Nothing here hijacks or calls
`reply.serializer` today.

### Quiet routes are keyed on the route *pattern*

`bootstrap.ts` sets `routerOptions.ignoreTrailingSlash`, so `/health/` is
answered by the `/health` route. A `QUIET_ROUTES` keyed on the request *path*
therefore missed the trailing-slash variant and logged a probe at `info` — 86,400
lines a day in front of the lines that carry information. One variant of one path
was enough.

The option lives in `bootstrap.ts` and the keying lives in `request-context.ts`,
which is why the *pairing* is asserted end-to-end in the integration tier rather
than only in the unit test.

### `Retry-After` and its body field come from one predicate

A retryable failure carries the hint in a header a CDN obeys automatically *and*
in a body field a client reads. Two derivations of one value is a divergence
waiting to happen, so both read the same predicate. `error-reporting.test.ts`
asserts the header and the body in the same test for that reason.

## Logging

`src/logger.ts`: pino, NDJSON on fd 1, level as a word, ISO-8601 timestamps,
`service` and `env` on every line, and a `redact` list covering credentials at
the top level and one level deep.

### The destination must stay `sync: true`

`destination({ dest: 1, sync: true })` is not a default anyone forgot to change.
sonic-boom buffers whatever is written while a write is in flight and flushes on
the write callback, and **a process terminated by a signal never runs one** — so
pino's default async mode loses the last line before an abnormal exit. That is
not an edge case; it is every shutdown. It is how `DatabaseService`'s "database
pool drained" went missing while "draining database pool" appeared, making a
drain that worked look like a drain that hung.

Re-measured with `sync: false`: `kill` yields 1 of 2 lines, `shutdown` 1 of 2,
`burst` **1 of 200**.

The trade is that every write is a blocking `writeSync`. If throughput ever
matters the answer is a real transport, not accepting truncated shutdowns.

### The `tsx` CLI cannot be used to prove it

`logger.test.ts` spawns `src/test/logger-child.ts`, because neither claim is
observable in-process: sonic-boom holds the descriptor rather than
`process.stdout`, and a test cannot signal-kill the worker it runs in.

It spawns `node --import tsx <file>` and **not** `node_modules/.bin/tsx`. The CLI
installs its own `SIGTERM` handler and forwards the signal, so a child that kills
itself exits **0** — an ordinary exit, which flushes. Measured: under the CLI,
every scenario in that file passed with `sync: false` as well. `--import` loads
the same transform in-process, leaves signal disposition alone, and reports
`signal: 'SIGTERM'`.

The same trap has a timing form. The `shutdown` scenario — the shape that
motivated the sync destination — was originally written with
`setTimeout(…, 10)`, and it printed **both** lines under `sync: false`: ten
milliseconds is long enough for the first write's callback to arrive, so the
buffer is empty again and the second line goes straight through. It is now
`await Promise.resolve()`, a microtask, because the real drain of an idle pool
finishes inside the same tick as the first write — which is precisely why the
second line was the one that vanished.

### Redaction is tested by sweeping stdout, not by checking fields

pino's `redact` matches **paths**, and the difference between `password` and
`*.password` is not visible by reading the array. The fixture plants 29
credential-shaped values at both depths and the load-bearing assertion is
`expect(stdout).not.toContain('SECRET-')` over the whole stream, so a path this
service adds a secret to tomorrow and forgets to list fails without anyone
editing the table. `[redacted]` is asserted present too, because a *missing*
field is ambiguous during an incident.

A secret interpolated into the message string is not reachable by `redact`, and
that limitation is asserted **positively** — if a future pino ever did redact
`msg`, the test failing is how we would learn the caveat had stopped being true.

## Database

Every query goes through `withTenant()`, which opens a transaction, sets four
GUCs with `SET LOCAL`, and runs the callback. The four are
`flux.organization_id`, `flux.actor_id`, `flux.actor_kind` and `flux.trace_id`.

**`SET LOCAL`, never `SET`.** A plain `SET` outlives the transaction and the
connection returns to the pool carrying a tenant, so the next request on that
physical connection reads someone else's rows. The integration tier proves this
against a **pool of size 1** with two sequential committed transactions, which is
the only arrangement where the reuse is observable.

**42501 is `internal_error`, not `permission_denied`, and the divergence is
deliberate.** `insufficient_privilege` arrives from three places: a missing
grant, an RLS `WITH CHECK` rejection, and 0014's append-only guard trigger —
which chose that SQLSTATE explicitly so callers mapping permission errors would
need no changes. Read as events in production, none of the three is a user
without permission. The second one means this service tried to write a row
stamped with **another tenant's** `organization_id`, which is the most serious
event this codebase can produce; mapping it to a tidy 403 would make it
indistinguishable from someone opening a page they are not entitled to, in the
dashboard, in the alerting and in the runbook. Genuine authorization decisions
are made by `evaluatePermission()` before the write and never reach `pg-errors.ts`.

### The guard against raw SQL strips comments the way PostgreSQL does

`withTenant`'s third guard refuses transaction control and session settings by
reading the first real keyword. Getting to the keyword means stripping comments,
and the original implementation was a regex run to a fixpoint whose comment
claimed the loop was what closed a multi-character-sanitization hole. Both halves
of that claim were wrong.

The example was wrong: `/*/* SET ROLE` is unchanged by one pass *or* a hundred
because there is no closing `*/`, and it is not a bypass — PostgreSQL answers
`unterminated /* comment`, measured against `postgres:17-alpine`.

The real bypass was the case neither the regex nor the loop could see:
**PostgreSQL nests block comments.** In `/* a /* b */ c */ SET ROLE x` the whole
prefix is one comment and the statement executed is `SET ROLE x` — verified
against the running container. A non-nesting regex matches only `/* a /* b */`,
leaving `c */ SET ROLE x`, whose first token is `c`, and the guard **allowed it**.
A fixpoint changes nothing; there is no second comment to remove.

So it is a depth-counting scan, which is not a cleverer regex — it is the same
grammar the server uses. Two details that are easy to get backwards, and both
fall out of checking `depth` before the `--` branch: `--` inside a block comment
is ordinary comment text, and `/*` inside a `--` line comment does not open a
block comment. An unterminated comment yields an empty head and the statement
goes through to the server, which rejects it as a syntax error — the right
direction, since text PostgreSQL will not execute is not a bypass.

It is still not a SQL parser. The limits are in the file header.

## Readiness

`/ready` fails when `schema_migrations` is empty: that means the application step
of a deploy reached the cluster before the migration step, and serving traffic
would produce `42P01` on the first request of every endpoint — reported correctly
as an internal error, so the outage would look like a code defect rather than a
deployment ordering problem.

It deliberately does **not** pin the *expected* head. A replica running code
newer than the applied migrations is the other half of the same failure and is
not detected here. Closing it needs the expected version compiled into the build
and checked against `db/migrations/`, which is a separate change with its own CI
check. See "Open" below.

## Tests

Two tiers, split by *what the test needs to exist* rather than by what it is
about.

| Tier | Config | Needs |
| --- | --- | --- |
| unit | `vitest.config.ts` | nothing — no database, no network, no container |
| integration | `vitest.integration.config.ts` | a real Postgres with `db/bootstrap` applied |

`src/**/*.test.ts` matches `*.integration.test.ts` too — the suffix is a longer
name, not a different extension — so the unit config excludes it explicitly.
Without that, `pnpm test` fails on a missing `DATABASE_URL` with an error about
environment variables rather than about anything a reviewer changed.

**613 unit tests in 11 files:**

| Tests | File |
| --- | --- |
| 154 | `src/http/api-error.test.ts` |
| 127 | `src/database/pg-errors.test.ts` |
| 72 | `src/database/tenant.test.ts` |
| 63 | `src/config.test.ts` |
| 42 | `src/http/validate.test.ts` |
| 38 | `src/http/trace.test.ts` |
| 31 | `src/http/error-reporting.test.ts` |
| 30 | `src/http/request-context.test.ts` |
| 26 | `src/database/database.service.test.ts` |
| 16 | `src/database/pool.test.ts` |
| 14 | `src/logger.test.ts` |

**45 integration tests in 3 files**, against a real PostgreSQL:

| Tests | File | What only this tier can answer |
| --- | --- | --- |
| 18 | `src/database/tenant.integration.test.ts` | RLS confines a transaction; `SET LOCAL` does not survive `COMMIT`, proved on a pool of **one**; all seven values land in the GUC they name; the timeouts raise the SQLSTATEs `pg-errors.ts` promises |
| 15 | `src/app.module.integration.test.ts` | every provider resolves *and* is used; `APP_POOL` is unreachable from a module that imports `DatabaseModule`; the probes, the trailing slash, the drain |
| 12 | `src/http/error-reporting.integration.test.ts` | which framework catches which failure — a malformed body, an oversized body, an unknown path and a handler throw all answering in one shape |

Run it with a container up and both URLs exported:

```bash
DATABASE_URL='postgres://flux_app:flux_app_dev@127.0.0.1:55444/flux' DATABASE_MIGRATOR_URL='postgres://flux_migrator:flux_migrator_dev@127.0.0.1:55444/flux' pnpm test:integration
```

Two roles, deliberately. Almost every assertion runs as **`flux_app`**, because
that role's `NOBYPASSRLS`/`NOSUPERUSER` *is* the boundary being measured — the
first test pins `current_user` and both flags on the connection the suite
actually uses, since a superuser sees every row by design and "A cannot see B"
would then be measuring nothing. `flux_migrator` appears for the two jobs the app
role cannot do at all: seeding, and reading `event_outbox`, which `flux_app` holds
no `SELECT` on.

**No test at all:** `main.ts`, `core.module.ts`, `nest-logger.ts`, the three
feature modules, and `health/health.controller.ts` — the controller and both
modules are *exercised* by the integration tier through real requests, but
nothing covers them in isolation. `bootstrap.ts` and `app.module.ts` are covered
at the integration tier only, which is the right tier for both: their content is
ordering and wiring, and a unit test of either would assert against a
configuration nobody deploys. `main.ts`'s `listen`, its `HOST` handling and its
signal wiring are outside every automated test here — nothing binds a socket,
because `app.inject()` dispatches the whole Fastify pipeline without one.

### How a test in this tree is expected to fail

Two habits, both of which caught real defects while writing this suite, and
neither of which is optional here.

**Revert the fix and read the messages.** A test that passes against a broken
implementation is worse than no test, because it licenses the belief the property
is held. Every non-obvious assertion in this suite was measured by reverting the
source and recording *which* tests failed and *how* — the counts are in the
commit bodies. Two of them did not fail cleanly: reverting the `reply.sent` guard
made the real-Fastify tests **time out at 5000 ms** alongside
`Unhandled Rejection: ERR_HTTP_HEADERS_SENT`, which is the hang and the crash
together.

**Assert the non-vacuity half.** The `/health/` test asserts
`route === '/health'` alongside the level, so it cannot pass on an instance where
the request 404'd for a different reason. The real-Fastify test asserts
`{ sent: false, headersSent: true }` before asserting the request settles, so it
cannot pass on a Fastify where `sent` did track `headersSent`. `record()` in
`logger.test.ts` asserts `status === 0` and empty stderr, so a crashed child
cannot satisfy a `not.toContain` by writing nothing.

### Two formatting conventions that look like mistakes

- The SQLSTATE table in `pg-errors.ts` is built by a **row factory** rather than
  by object literals, because Prettier's `printWidth: 100` wraps a literal of
  that shape across three lines each and a 40-row table becomes unreadable.
- zod's nested error paths differ **per issue kind within one library**:
  `unionErrors` paths are absolute while `argumentsError` paths are relative.
  `validate.ts` normalises both, and the tests cover each shape separately for
  that reason.

## Open

Written down here rather than left to be rediscovered.

- **`/ready` does not pin the expected migration head.** See above. Needs the
  version compiled into the build plus a CI check.
- **CR-010, `payload_too_large`.** Until it resolves, a 413 answers 400.
- **Widening `@flux/contracts`' `exports` map with a `dist` condition** would let
  this service be built with `tsc` alone. Change request, not an edit.
- **415 and 405 have no integration coverage**, and cannot until a route with a
  request body exists. On an unmatched path Fastify answers 404 for a content type
  it has no parser for — the body is never read, so no 415 is raised — and
  `PUT /health` is a 404 rather than a 405. Both rows of `api-error.ts`'s
  foreign-status tables are unit tested, and the test that measured this says so at
  the assertion rather than leaving it to look like an omission.
- **No coverage of a hijacked reply or a per-reply serialiser that throws.** Both
  defeat the exception filter, both are recorded in `error-reporting.ts`'s header,
  and neither is reachable without a fixture route that does the hijacking. A
  streaming export is the shape that will introduce one.
