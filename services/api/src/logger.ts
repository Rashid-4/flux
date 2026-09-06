/**
 * `destination` is imported by name rather than reached for as `pino.destination`.
 *
 * The named `pino` export is typed as the logger factory alone; the helpers live in the
 * declaration's merged namespace, so `pino.destination(...)` is a `TS2339` even though
 * it exists at runtime. Importing it directly is the form that both the type checker
 * and Node's CJS-named-export interop agree on.
 */
import { destination, pino, type Logger } from 'pino'
import type { Config } from './config.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Structured logging, with redaction that is not a matter of discipline.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §7: "An error must never contain a credential, a
 * token, a connection string, or another tenant's data. The message is for the
 * caller; the detail goes to the log with the trace id."
 *
 * That sentence assigns the *detail* to the log, which makes this file the place
 * where the second half of the rule has to hold. The API handles bearer tokens on
 * every request, a database password in its environment, and — per
 * `docs/specs/api/imports.md` — a `credential_ref` pointing at a Vault entry for
 * third-party imports. Any of those can reach a log the same way: something
 * serialises an object that happens to contain one, three call frames from the
 * code that knew what it was.
 *
 * So redaction is configured on the logger rather than practised at call sites. A
 * call site that forgets is the normal case, not the exceptional one, and a rule
 * enforced only by remembering is not enforced.
 *
 * ### JSON in development too
 *
 * There is no `pino-pretty` transport, and the absence is deliberate rather than
 * an oversight. A prettifier means the log a developer reads and the log an
 * operator greps are different artifacts, and the fields that only exist in the
 * JSON form — the trace id above all — are the ones that stop being reached for.
 * `pnpm dev | pnpm dlx pino-pretty` is available to anyone who wants it, as a
 * choice made at the terminal rather than a divergence baked into the process.
 *
 * ### The destination is synchronous, and that was measured rather than assumed
 *
 * `pino()` with no destination does **not** write synchronously, whatever the
 * ambient belief. Measured, on this Node and this pino:
 *
 *     const log = pino()
 *     log.info('line-one')
 *     log.info('line-two')
 *     process.kill(process.pid, 'SIGTERM')   // no listener → terminated by signal
 *
 * prints `line-one` and loses `line-two`. sonic-boom writes the first line straight
 * through because its buffer is empty, then buffers everything written while that
 * write is in flight and flushes on the write callback — which never arrives, because
 * a process terminated by a signal does not run `exit` handlers.
 *
 * That is not an edge case, it is **every shutdown**. It was found because
 * `DatabaseService.onApplicationShutdown` logged "draining database pool" and then
 * "database pool drained", and only the first ever appeared: Nest awaits the hook and
 * then calls `process.kill(process.pid, signal)` itself, so the second line was
 * written into a buffer that was then discarded. Every read of that log said the pool
 * drain had hung. It had not.
 *
 * The general form is worse than the symptom: **the last line before any abnormal
 * exit is the line most likely to be lost, and it is also the one worth having.** A
 * fatal from `uncaughtException`, the reason a boot failed, the last thing a request
 * did before the process died — all of them are written immediately before an exit.
 *
 * `sync: true` makes every write a blocking `writeSync`, which is the trade being
 * made deliberately: a slow pipe now blocks the event loop, and in exchange no line
 * is ever lost. At flux's scale that is not close. pino's async mode exists for
 * throughput that this service will not see for a long time, and when it does, the
 * decision is to move logs to a real transport with its own buffer — not to accept
 * silently truncated shutdowns.
 *
 * If a transport is ever configured here, this property is gone and
 * `main.ts`'s exit paths need `flushSync()` — which is written down there too,
 * because that file is where the loss would surface.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **A secret at a path not listed below.** `redact` matches paths, so a token
 *     logged as `{ details: { bearer } }` is not covered. The list holds the
 *     places credentials actually arrive — headers, config, the import
 *     credential ref — and `censor` is a visible marker so a redacted field in a
 *     log is evidence the mechanism is working.
 *   • **A secret interpolated into a message string.** `log.info(\`token
 *     ${t}\`)` produces a `msg` that no path can address. Nothing but review
 *     catches that, which is the argument for passing objects rather than
 *     building strings.
 *   • **Another tenant's data.** Redaction is about credentials. Not logging a
 *     row from the wrong organization is a property of `withTenant`, and it is
 *     asserted in `tenant.integration.test.ts` rather than here.
 */

/**
 * Paths whose values are replaced before anything is written.
 *
 * Both the bare name and the nested forms are listed, because pino's `redact`
 * matches a path and not a key name anywhere in the tree. `*` covers one level,
 * which is why the request/response shapes are spelled out.
 */
const REDACTED_PATHS = [
  // ── Request credentials ──
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
  'res.headers["set-cookie"]',

  // ── Anything shaped like a secret, at the top level or one deep ──
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',

  // ── Ours specifically ──
  /**
   * The connection string carries the database password. `config.ts` never hands
   * this out — `describeTarget()` is the only representation it exposes — but a
   * `Config` object passed whole to a log line would otherwise print it.
   */
  'DATABASE_URL',
  '*.DATABASE_URL',
  'connectionString',
  '*.connectionString',
  /**
   * `docs/specs/api/imports.md`: an import job stores a *reference* to a Vault
   * entry and never the credential itself, and that reference is never logged,
   * never in an error body, and never returned to a client. It is listed here so
   * that remains true when someone logs the whole job row while debugging.
   */
  'credentialRef',
  '*.credentialRef',
  'credential_ref',
  '*.credential_ref',
  /** The passphrase for an encrypted export archive, which is never stored. */
  'passphrase',
  '*.passphrase',
] as const

export function createLogger(config: Config): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,

      redact: {
        paths: [...REDACTED_PATHS],
        /**
         * A visible marker rather than removing the key. A missing field is
         * ambiguous — it could mean redaction worked or that nothing was sent —
         * and during an incident that ambiguity costs more than the line is worth.
         */
        censor: '[redacted]',
      },

      /**
       * `level` as a word, not a number. pino's default emits `"level":30`, which
       * every log viewer then has to be taught to decode; the field is read by
       * humans far more often than the two bytes are worth.
       */
      formatters: {
        level: (label) => ({ level: label }),
      },

      /**
       * ISO-8601 rather than pino's epoch milliseconds. Slightly more expensive to
       * produce and vastly cheaper to correlate against a database timestamp, a
       * browser network panel, or a customer saying "around ten past four".
       */
      timestamp: pino.stdTimeFunctions.isoTime,

      base: {
        service: 'flux-api',
        env: config.NODE_ENV,
      },
    },
    /**
     * stdout, written synchronously. See the header — this is the difference
     * between a shutdown that reports its own last step and one that appears to
     * have hung.
     *
     * fd 1 by number rather than `process.stdout`: sonic-boom writes to the
     * descriptor, which is what a container runtime collects, and it does not
     * inherit `process.stdout`'s stream state.
     */
    destination({ dest: 1, sync: true }),
  )
}

/** The injection token for the root `Logger`. */
export const LOGGER = Symbol('flux.Logger')
