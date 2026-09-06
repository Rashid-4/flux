import process from 'node:process'
import { z } from 'zod'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Environment, parsed once at boot. Nothing else in this service reads
 * `process.env`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The same parse-at-the-boundary rule the API applies to request bodies applies
 * to its own environment, and for a stronger reason: a malformed request body
 * fails one request, while a malformed `DATABASE_POOL_MAX` fails whichever
 * request happens to arrive when the pool runs out — minutes later, in a
 * different file, as a timeout. Configuration is the one input where "fail on
 * the way in" means "fail before serving traffic at all".
 *
 * So `loadConfig()` runs before the HTTP server is created, reports **every**
 * problem rather than the first, and exits non-zero. A process that starts with
 * half-valid configuration and degrades under load is strictly worse than one
 * that refuses to start, because the second failure is legible.
 *
 * ### Two rules about secrets that this file exists to enforce
 *
 * **A connection string never reaches a log, an error body, or a stack trace.**
 * `DATABASE_URL` carries a password. zod's default error for a bad URL quotes
 * the value it rejected, which would put that password in the boot log of every
 * misconfigured deploy — so the URL fields are validated with a custom issue
 * that names the variable and says nothing about its contents. Tested in
 * `config.test.ts`.
 *
 * **`describeTarget()` is the only thing that may be printed.** It reconstructs
 * host, port, database and user and drops everything else, so a boot log can say
 * *which* database it reached without saying how.
 *
 * ### What is deliberately NOT here: relay credentials
 *
 * `docs/specs/api/README.md` §2 gives the outbox relay a separate pool built
 * from `flux_relay` credentials, because draining the outbox is cross-tenant by
 * definition and `flux_relay` therefore holds BYPASSRLS.
 *
 * There is no `DATABASE_RELAY_URL` in this schema, and its absence is a security
 * boundary rather than an omission. If this process held those credentials, then
 * every tenant-isolation guarantee in the product would rest on no code path in
 * a large API ever reaching the wrong pool — which is a promise about future
 * code, and the weakest kind of guarantee there is. The relay is a separate
 * deployable with its own environment, so the API cannot read across tenants
 * even if someone writes the bug that would.
 *
 * The spec's "deliberately awkward helper name" for cross-tenant access is the
 * in-process version of the same idea. This is the version that survives the
 * helper being renamed.
 */

/**
 * A Postgres URL that is validated without ever quoting itself.
 *
 * `z.string().url()` would be shorter and would embed the rejected value —
 * password included — in the issue message. The rest of the shape (scheme,
 * host, database) is left to `pg`: re-implementing libpq's URL grammar here
 * would give two parsers that disagree, and the one that matters is the one
 * that opens the socket.
 */
function postgresUrl(variable: string) {
  return z.string().superRefine((value, ctx) => {
    if (value.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${variable} is empty`,
      })
      return
    }
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${variable} is not a URL (expected postgres://user:password@host:port/database)`,
      })
      return
    }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${variable} must use the postgres:// or postgresql:// scheme`,
      })
    }
  })
}

/**
 * An integer from a string, with the variable named in the failure.
 *
 * `z.coerce.number()` accepts `''` as 0 and `'12abc'` as NaN-then-fails with a
 * message about types rather than about the variable, which is the difference
 * between a deploy someone fixes in a minute and one they bisect.
 */
function integerVar(variable: string, options: { min: number; max: number; default: number }) {
  return z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === '') return
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${variable} must be a whole number, got ${JSON.stringify(value)}`,
        })
        return
      }
      const parsed = Number(value)
      if (parsed < options.min || parsed > options.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${variable} must be between ${options.min} and ${options.max}, got ${parsed}`,
        })
      }
    })
    .transform((value) => (value === undefined || value === '' ? options.default : Number(value)))
}

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * `0` is accepted and means "let the OS choose", which is what the integration
   * tests use so that a suite and a running dev server do not fight over 3000.
   */
  PORT: integerVar('PORT', { min: 0, max: 65_535, default: 3000 }),

  /**
   * Binds to loopback by default. A service that binds `0.0.0.0` because that is
   * the framework default is exposed on every interface of a developer's laptop
   * the first time they join a coffee-shop network. Containers set this
   * explicitly, which is the point at which someone has thought about it.
   */
  HOST: z.string().min(1).default('127.0.0.1'),

  /** `flux_app`: NOBYPASSRLS, NOSUPERUSER. See the header on relay credentials. */
  DATABASE_URL: postgresUrl('DATABASE_URL'),

  /**
   * Upper bound on pooled connections **per process**. The number that matters
   * is this times the replica count, against Postgres's `max_connections`, and
   * getting it wrong surfaces as `too many connections` under exactly the load
   * where you least want a new failure mode. Kept low on purpose: a request
   * holds its connection for the whole transaction (§2), so a large pool mostly
   * buys the ability to overwhelm the database faster.
   */
  DATABASE_POOL_MAX: integerVar('DATABASE_POOL_MAX', { min: 1, max: 100, default: 10 }),

  /**
   * How long `pool.connect()` waits for a free connection before giving up.
   *
   * Not optional and not infinite. `pg`'s default is 0, meaning wait forever, so
   * a pool exhausted by one slow query turns into a process where every request
   * hangs and no request errors — nothing times out, nothing logs, and the
   * health check keeps passing because it does not touch the pool. Failing at
   * five seconds with `dependency_unavailable` is a legible outage.
   */
  DATABASE_CONNECT_TIMEOUT_MS: integerVar('DATABASE_CONNECT_TIMEOUT_MS', {
    min: 100,
    max: 60_000,
    default: 5_000,
  }),

  /**
   * Default `statement_timeout` for a tenant transaction (§2 step 5). Write
   * paths pass something lower; the issue write path has a 150ms p95 budget
   * (§5), so a query anywhere near this ceiling has already failed that budget
   * and is being killed rather than being waited for.
   */
  STATEMENT_TIMEOUT_MS: integerVar('STATEMENT_TIMEOUT_MS', {
    min: 100,
    max: 120_000,
    default: 10_000,
  }),

  /**
   * `lock_timeout`, and it is deliberately much shorter than the statement
   * timeout. Waiting on a row lock is not the same failure as running a slow
   * query: the query will never get faster by waiting, and two requests dragging
   * the same issue on a board is the *expected* case rather than the exceptional
   * one. A short lock timeout converts contention into a fast, retryable error
   * instead of ten seconds of a held connection.
   */
  LOCK_TIMEOUT_MS: integerVar('LOCK_TIMEOUT_MS', { min: 50, max: 30_000, default: 3_000 }),

  /**
   * `idle_in_transaction_session_timeout`. A transaction left open by a bug
   * holds its locks and its connection indefinitely, and — because
   * `VACUUM` cannot clean up rows newer than the oldest running transaction —
   * degrades the whole database rather than just the one request. This is the
   * backstop for the mistake §2 warns about most: doing network I/O inside the
   * callback.
   */
  IDLE_IN_TRANSACTION_TIMEOUT_MS: integerVar('IDLE_IN_TRANSACTION_TIMEOUT_MS', {
    min: 1_000,
    max: 120_000,
    default: 15_000,
  }),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

export interface Config extends Env {
  readonly isProduction: boolean
  /**
   * Host, port, database and user — never the password. The only
   * representation of `DATABASE_URL` that may be logged.
   */
  describeTarget(): string
}

/**
 * Reconstruct a safe description of the database being addressed.
 *
 * Deliberately built field by field rather than by deleting `password` from a
 * parsed URL and re-serialising it: `URL.toString()` preserves anything it does
 * not recognise, so a credential passed as a query parameter — libpq accepts
 * `?password=` — would survive that approach and reach the log.
 */
function describeTarget(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Unreachable: the schema validated this. Kept because "unreachable" plus
    // a throw in a logging path is how a boot failure becomes a silent crash.
    return '<unparseable>'
  }
  const user = parsed.username === '' ? '<no user>' : decodeURIComponent(parsed.username)
  const database = parsed.pathname.replace(/^\//, '') || '<no database>'
  const port = parsed.port === '' ? '5432' : parsed.port
  return `${database} at ${parsed.hostname}:${port} as ${user}`
}

/**
 * Parse an environment into a `Config`, or throw with every problem listed.
 *
 * Takes the environment as an argument rather than reading `process.env`
 * directly so that `config.test.ts` can assert the failure messages without
 * mutating global state — a test that sets `process.env` and forgets to restore
 * it fails a *different* test file, and the two are hard to associate.
 */
export function parseConfig(source: Record<string, string | undefined>): Config {
  const result = EnvSchema.safeParse(source)

  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const variable = issue.path.join('.')
      // A `custom` issue already names its variable — the helpers above are
      // written that way precisely so no value is interpolated. Anything else
      // (a missing required key, a bad enum) is prefixed here instead.
      return issue.code === z.ZodIssueCode.custom ? `  • ${issue.message}` : `  • ${variable}: ${issue.message}`
    })

    throw new Error(
      `Invalid environment — the API will not start.\n\n${problems.join('\n')}\n\n` +
        `  See services/api/README.md for what each variable does, and\n` +
        `  .env.example for a working development set. No value from the\n` +
        `  environment is reproduced above, deliberately: DATABASE_URL carries\n` +
        `  a password and this message goes to a log.\n`,
    )
  }

  const env = result.data
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    describeTarget: () => describeTarget(env.DATABASE_URL),
  }
}

/** Parse the real process environment. Called once, from `main.ts`. */
export function loadConfig(): Config {
  return parseConfig(process.env)
}

/**
 * The injection token for `Config`.
 *
 * An interface has no runtime value, so it cannot be used as a Nest provider
 * token — and this build cannot fall back on `emitDecoratorMetadata` anyway
 * (see `tsup.config.ts`). Every dependency in this service is injected by an
 * explicit token for that reason, and the tokens live beside the thing they
 * name.
 */
export const CONFIG = Symbol('flux.Config')
