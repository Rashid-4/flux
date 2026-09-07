import { createLogger } from '../logger.js'
import type { Config } from '../config.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A child process, because the claim is about what survives one dying.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `logger.ts` writes to **file descriptor 1**, synchronously, and the reason it does
 * is that `pino()` in its default async mode loses the last line written before an
 * abnormal exit. Neither half of that is observable in-process:
 *
 *   • a logger bound to fd 1 cannot be redirected by reassigning `process.stdout`,
 *     because sonic-boom holds the descriptor rather than the stream;
 *   • "the buffer is discarded when the process is terminated by a signal" requires a
 *     process that gets terminated by a signal.
 *
 * So the test spawns this file and reads its stdout. Each scenario is one argument,
 * and each is written to be as close to the real failure as possible — in particular
 * `kill` installs **no** signal handler, because a handler makes the exit ordinary and
 * ordinary exits flush.
 *
 * This file is a fixture, not a test. It is under `src/test/` so `tsconfig.json` sees
 * it and `tsc` typechecks it; the unit tier's `include` is `src/**\/*.test.ts`, so
 * vitest never collects it as a suite.
 */

/**
 * Enough of a `Config` for `createLogger`, which reads two fields.
 *
 * Deliberately not `parseConfig()`: that requires a `DATABASE_URL`, and a fixture
 * that needs a database URL to prove something about logging would be a fixture that
 * fails for an unrelated reason.
 */
const config = { NODE_ENV: 'test', LOG_LEVEL: 'debug' } as unknown as Config

const scenarios: Record<string, () => void> = {
  /**
   * The regression. Two lines, then a signal with no handler installed.
   *
   * In async mode sonic-boom writes `line-one` straight through — its buffer is empty
   * — then buffers `line-two` while that write is in flight and flushes on the write
   * callback, which never arrives. `line-two` is the one that matters: the last line
   * before an abnormal exit is always the one worth having.
   */
  kill: () => {
    const logger = createLogger(config)
    logger.info({ marker: 1 }, 'line-one')
    logger.info({ marker: 2 }, 'line-two')
    process.kill(process.pid, 'SIGTERM')
  },

  /**
   * The shape that found it: an async shutdown hook whose two log lines bracket the
   * work, with the signal sent after the hook resolves — which is what Nest does.
   *
   * The await is a **microtask**, and that is load-bearing rather than lazy. Written
   * with `setTimeout(…, 10)` this scenario survives async mode intact: ten milliseconds
   * is long enough for the first write's callback to arrive, so the buffer is empty
   * again and the second line goes straight through. Measured — it printed both lines
   * with `sync: false` and proved nothing. The real drain of an idle pool finishes
   * inside the same tick as the first write, which is precisely why the second line
   * was the one that vanished.
   */
  shutdown: () => {
    const logger = createLogger(config)
    void (async () => {
      logger.info('draining database pool')
      await Promise.resolve()
      logger.info('database pool drained')
      process.kill(process.pid, 'SIGTERM')
    })()
  },

  /** Many lines, so a partial flush is distinguishable from a lucky one. */
  burst: () => {
    const logger = createLogger(config)
    for (let i = 0; i < 200; i += 1) logger.info({ i }, `line-${i}`)
    process.kill(process.pid, 'SIGTERM')
  },

  /** Every redacted path, at the top level and one deep, in one record. */
  redact: () => {
    const logger = createLogger(config)
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer SECRET-AUTH',
            cookie: 'session=SECRET-COOKIE',
            'proxy-authorization': 'Basic SECRET-PROXY',
            'x-api-key': 'SECRET-APIKEY',
            'user-agent': 'flux-test/1.0',
          },
        },
        res: { headers: { 'set-cookie': 'session=SECRET-SETCOOKIE' } },
        headers: { authorization: 'Bearer SECRET-BARE-AUTH', cookie: 'a=SECRET-BARE-COOKIE' },
        password: 'SECRET-PASSWORD',
        token: 'SECRET-TOKEN',
        accessToken: 'SECRET-ACCESS',
        refreshToken: 'SECRET-REFRESH',
        apiKey: 'SECRET-API',
        secret: 'SECRET-SECRET',
        // Every `SECRET-` value in this file is a planted fixture the test greps
        // the child's stdout for, so the DSN-shaped ones are exempted by hand
        // rather than by teaching `check-secrets` a prefix — a magic string that
        // silences the check is worth strictly less than five visible exemptions.
        DATABASE_URL: 'postgres://flux_app:SECRET-DSN@db.internal:5432/flux', // check-secrets:allow
        connectionString: 'postgres://flux_app:SECRET-CONN@db.internal:5432/flux', // check-secrets:allow
        credentialRef: 'vault://SECRET-REF',
        credential_ref: 'vault://SECRET-SNAKE-REF',
        passphrase: 'SECRET-PASSPHRASE',
        nested: {
          password: 'SECRET-N-PASSWORD',
          token: 'SECRET-N-TOKEN',
          accessToken: 'SECRET-N-ACCESS',
          refreshToken: 'SECRET-N-REFRESH',
          apiKey: 'SECRET-N-API',
          secret: 'SECRET-N-SECRET',
          DATABASE_URL: 'postgres://u:SECRET-N-DSN@h/d', // check-secrets:allow
          connectionString: 'postgres://u:SECRET-N-CONN@h/d', // check-secrets:allow
          credentialRef: 'vault://SECRET-N-REF',
          credential_ref: 'vault://SECRET-N-SNAKE',
          passphrase: 'SECRET-N-PASSPHRASE',
        },
        // Not a secret, and it must survive: a redactor that flattened the record
        // would satisfy every negative assertion and destroy the log.
        issueKey: 'PAY-1',
      },
      'a record full of credentials',
    )
    logger.flush()
  },

  /** A whole `Config`-shaped object, which is the accident redaction exists for. */
  'config-object': () => {
    const logger = createLogger(config)
    // Hoisted so the exemption sits on the line the check flags: it matches per
    // line, and a comment above the match is not an exemption at all.
    const dsn = 'postgres://flux_app:SECRET-PW@db:5432/flux' // check-secrets:allow
    logger.info({ config: { DATABASE_URL: dsn, NODE_ENV: 'test' } }, 'boot configuration')
    logger.flush()
  },

  /** The shape of an ordinary line: level as a word, ISO time, service and env. */
  shape: () => {
    const logger = createLogger(config)
    logger.info({ traceId: 'a'.repeat(32) }, 'ordinary line')
    logger.error({ err: new Error('exploded') }, 'a failure')
    logger.debug('a debug line')
    logger.flush()
  },

  /** `LOG_LEVEL` is honoured: at `warn`, nothing below it is written. */
  'level-filter': () => {
    const logger = createLogger({ ...config, LOG_LEVEL: 'warn' } as unknown as Config)
    logger.trace('trace line')
    logger.debug('debug line')
    logger.info('info line')
    logger.warn('warn line')
    logger.error('error line')
    logger.fatal('fatal line')
    logger.flush()
  },

  /**
   * A secret interpolated into the message, which redaction cannot reach.
   *
   * Asserted so the limitation is a measured fact in the suite rather than a sentence
   * in a comment. `logger.ts`'s "WHAT THIS DOES NOT CHECK" says this; if a future pino
   * ever did redact `msg`, this test failing is how we would find out.
   */
  'message-interpolation': () => {
    const logger = createLogger(config)
    logger.info(`token SECRET-IN-MESSAGE was rejected`)
    logger.flush()
  },
}

const name = process.argv[2] ?? ''
const scenario = scenarios[name]
if (scenario === undefined) {
  process.stderr.write(`unknown scenario ${JSON.stringify(name)}\n`)
  process.exit(2)
}
scenario()
