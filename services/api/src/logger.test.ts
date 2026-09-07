import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Spawned, because both claims are about a process rather than a logger.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `logger.ts` makes two promises that cannot be checked in-process.
 *
 * **No line is lost.** `destination({ dest: 1, sync: true })` exists because
 * `pino()` in its default mode loses the last line written before an abnormal exit —
 * sonic-boom buffers whatever is written while a write is in flight and flushes on the
 * write callback, and a process terminated by a signal never runs one. That is not an
 * edge case: it is every shutdown, and it is how `DatabaseService`'s "database pool
 * drained" went missing while "draining database pool" appeared, making a drain that
 * worked look like a drain that hung.
 *
 * A logger bound to fd 1 cannot be captured by reassigning `process.stdout` — sonic-boom
 * holds the descriptor, not the stream — and a test cannot signal-kill the worker it
 * is running in. So `src/test/logger-child.ts` is spawned and its stdout is read.
 *
 * **A credential never reaches a log.** §7's second half. Testing it against the real
 * `createLogger` matters more than convenience: pino's `redact` matches *paths*, and
 * the difference between `password` and `*.password` is not visible by reading the
 * array. Both forms of every entry are exercised, and the negative assertion is made
 * against the whole of stdout rather than against the fields a test thought to check.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **Whether `sync: true` is fast enough.** It makes every write a blocking
 *     `writeSync`, which is the trade `logger.ts` names explicitly. Throughput is not
 *     asserted here, and if it ever matters the answer is a real transport rather
 *     than accepting truncated shutdowns.
 *   • **stderr.** Nothing writes there deliberately; a line appearing there would be
 *     Node's own, and the `kill` scenarios assert the exit was by signal so a crash
 *     cannot be mistaken for a clean run.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHILD = fileURLToPath(new URL('./test/logger-child.ts', import.meta.url))
/**
 * pnpm hoists binaries per package, so `tsx` lives under `services/api/node_modules`
 * and not the repository root's — which has no `.bin/tsx` at all. Resolved from this
 * file rather than from `process.cwd()`, since vitest's cwd is not guaranteed.
 */
const TSX_PACKAGE = fileURLToPath(new URL('../node_modules/tsx/package.json', import.meta.url))

interface Run {
  stdout: string
  stderr: string
  lines: Record<string, unknown>[]
  signal: NodeJS.Signals | null
  status: number | null
}

/**
 * `node --import tsx <file>`, and **not** the `tsx` CLI.
 *
 * The CLI installs its own `SIGTERM` handler and forwards the signal, so a child that
 * kills itself exits with status 0 — an ordinary exit, which flushes. Measured: with
 * the CLI, every scenario in this file passed with `sync: false` as well, which is the
 * vacuous-green shape `CLAUDE.md` warns about. `--import` loads the same transform
 * in-process, leaves signal disposition alone, and reports `signal: 'SIGTERM'`.
 */
function run(scenario: string): Run {
  /**
   * A missing `tsx` fails loudly rather than skipping.
   *
   * A skipped test reads as a passing suite, and the property this file protects — no
   * log line is ever lost — is exactly the kind that would then rot unnoticed. If the
   * dependency moves, this message says where to look.
   */
  if (!existsSync(TSX_PACKAGE)) {
    throw new Error(
      `tsx not found at ${TSX_PACKAGE}. logger.test.ts spawns a child process because ` +
        `the sync-destination claim is not observable in-process; it cannot be skipped.`,
    )
  }

  const result = spawnSync(process.execPath, ['--import', 'tsx', CHILD, scenario], {
    encoding: 'utf8',
    timeout: 30_000,
    // `--import tsx` is resolved against the cwd, so it is pinned rather than inherited.
    cwd: PACKAGE_ROOT,
    // Nothing in the fixture reads the environment, and an inherited `LOG_LEVEL` would
    // silently change what the child writes.
    env: { ...process.env, LOG_LEVEL: undefined },
  })

  const stdout = result.stdout ?? ''
  return {
    stdout,
    stderr: result.stderr ?? '',
    lines: stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>),
    signal: result.signal,
    status: result.status,
  }
}

/** A scenario that exits cleanly, with its line count pinned. */
function record(scenario: string, expected = 1): Run & { line: Record<string, unknown> } {
  const result = run(scenario)
  // A child that crashed would otherwise satisfy a `not.toContain` assertion by
  // writing nothing at all.
  expect(result.stderr, result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(result.lines).toHaveLength(expected)
  return { ...result, line: result.lines[0] as Record<string, unknown> }
}

describe('no line is lost when the process is killed', () => {
  it('keeps the line written immediately before a signal', () => {
    const result = run('kill')

    // The regression, in one assertion. In pino's default async mode this is
    // `['line-one']`: the first write goes straight through and the second is
    // buffered behind it forever.
    expect(result.lines.map((line) => line.msg)).toEqual(['line-one', 'line-two'])
    // And it really was killed by a signal — an ordinary exit flushes, so a scenario
    // that exited cleanly would pass for the wrong reason.
    expect(result.signal).toBe('SIGTERM')
  })

  it('keeps both halves of a shutdown that logs before and after its work', () => {
    // The exact shape that found this: Nest awaits `onApplicationShutdown` and then
    // calls `process.kill(process.pid, signal)` itself. Every read of that log said
    // the pool drain had hung. It had not.
    const result = run('shutdown')

    expect(result.lines.map((line) => line.msg)).toEqual([
      'draining database pool',
      'database pool drained',
    ])
    expect(result.signal).toBe('SIGTERM')
  })

  it('keeps all two hundred lines of a burst', () => {
    // A single surviving second line could be luck — a timing window where the first
    // write had already completed. Two hundred cannot be, and a partial flush is
    // distinguishable from a complete one by the count.
    const result = run('burst')

    expect(result.lines).toHaveLength(200)
    expect(result.lines[0]?.msg).toBe('line-0')
    expect(result.lines[199]?.msg).toBe('line-199')
    expect(result.signal).toBe('SIGTERM')
  })
})

describe('every line is a single JSON object', () => {
  it('writes newline-delimited JSON with nothing else on stdout', () => {
    const result = run('burst')

    // `parse` in `run` would already have thrown on a prettifier's output, but the
    // assertion is worth stating: there is deliberately no `pino-pretty` transport,
    // so what a developer reads and what an operator greps are the same artifact.
    expect(result.lines).toHaveLength(200)
    expect(result.stdout.endsWith('\n')).toBe(true)
    expect(result.stdout).not.toContain('\n\n')
  })
})

describe('the shape of a line', () => {
  it('spells the level as a word', () => {
    const { lines } = record('shape', 3)

    // pino's default is `"level":30`, which every log viewer then has to be taught to
    // decode. The field is read by humans far more often than two bytes are worth.
    expect(lines.map((line) => line.level)).toEqual(['info', 'error', 'debug'])
  })

  it('timestamps in ISO-8601', () => {
    const { line } = record('shape', 3)

    // Correlating against a database timestamp, a browser network panel, or "around
    // ten past four" is the whole reason. Epoch milliseconds require a conversion
    // step at exactly the moment nobody wants one.
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(line.time as string).getTime()).toBeGreaterThan(0)
  })

  it('carries the service and environment on every line', () => {
    const { lines } = record('shape', 3)

    for (const line of lines) {
      expect(line.service).toBe('flux-api')
      expect(line.env).toBe('test')
    }
  })

  it('keeps the caller’s own fields', () => {
    const { line } = record('shape', 3)

    expect(line.traceId).toBe('a'.repeat(32))
    expect(line.msg).toBe('ordinary line')
  })

  it('serialises an Error with its stack', () => {
    const { lines } = record('shape', 3)
    const err = lines[1]?.err as { message: string; stack: string; type: string }

    // The operator's half of §13. A logged Error that serialised to `{}` — which is
    // what `JSON.stringify` does with one — would leave a 5xx with no cause anywhere.
    expect(err.message).toBe('exploded')
    expect(err.stack).toContain('logger-child')
    expect(err.type).toBe('Error')
  })

  it('honours LOG_LEVEL', () => {
    const result = run('level-filter')

    // At `warn`, the three below it are not written at all. A logger that ignored the
    // configured level would put debug output into production, which is both a cost
    // and, given how much of this service logs whole rows, a disclosure risk.
    expect(result.lines.map((line) => line.msg)).toEqual(['warn line', 'error line', 'fatal line'])
  })
})

describe('a credential never reaches a log', () => {
  /**
   * The values planted in `logger-child.ts`'s `redact` scenario, each at a path
   * `REDACTED_PATHS` claims to cover.
   *
   * The table is the readable half. The assertion that actually holds the property is
   * the sweep below it, which checks the whole of stdout — a per-field check passes
   * for every field nobody thought to plant.
   */
  const planted = [
    ['req.headers.authorization', 'SECRET-AUTH'],
    ['req.headers.cookie', 'SECRET-COOKIE'],
    ['req.headers["proxy-authorization"]', 'SECRET-PROXY'],
    ['req.headers["x-api-key"]', 'SECRET-APIKEY'],
    ['res.headers["set-cookie"]', 'SECRET-SETCOOKIE'],
    ['headers.authorization', 'SECRET-BARE-AUTH'],
    ['headers.cookie', 'SECRET-BARE-COOKIE'],
    ['password', 'SECRET-PASSWORD'],
    ['token', 'SECRET-TOKEN'],
    ['accessToken', 'SECRET-ACCESS'],
    ['refreshToken', 'SECRET-REFRESH'],
    ['apiKey', 'SECRET-API'],
    ['secret', 'SECRET-SECRET'],
    ['DATABASE_URL', 'SECRET-DSN'],
    ['connectionString', 'SECRET-CONN'],
    ['credentialRef', 'SECRET-REF'],
    ['credential_ref', 'SECRET-SNAKE-REF'],
    ['passphrase', 'SECRET-PASSPHRASE'],
    ['*.password', 'SECRET-N-PASSWORD'],
    ['*.token', 'SECRET-N-TOKEN'],
    ['*.accessToken', 'SECRET-N-ACCESS'],
    ['*.refreshToken', 'SECRET-N-REFRESH'],
    ['*.apiKey', 'SECRET-N-API'],
    ['*.secret', 'SECRET-N-SECRET'],
    ['*.DATABASE_URL', 'SECRET-N-DSN'],
    ['*.connectionString', 'SECRET-N-CONN'],
    ['*.credentialRef', 'SECRET-N-REF'],
    ['*.credential_ref', 'SECRET-N-SNAKE'],
    ['*.passphrase', 'SECRET-N-PASSPHRASE'],
  ] as const

  it('redacts every path REDACTED_PATHS names, and nothing on stdout holds a secret', () => {
    const { stdout, line } = record('redact')

    for (const [path, value] of planted) {
      expect(stdout, `${path} leaked ${value}`).not.toContain(value)
    }

    // The sweep is the load-bearing form: `SECRET-` is the prefix on every planted
    // value, so a path this repository adds a secret to tomorrow and forgets to list
    // fails here without anyone editing the table.
    expect(stdout).not.toContain('SECRET-')
    // And the marker is present, because a *missing* field is ambiguous during an
    // incident — it could mean redaction worked or that nothing was sent.
    expect(JSON.stringify(line)).toContain('[redacted]')
  })

  it('leaves everything that is not a credential alone', () => {
    const { line, stdout } = record('redact')

    // A redactor that flattened the record would satisfy every negative assertion
    // above and destroy the log, which is the failure mode worth guarding against.
    expect(line.issueKey).toBe('PAY-1')
    expect(line.msg).toBe('a record full of credentials')
    expect(stdout).toContain('flux-test/1.0')
    const req = line.req as { headers: Record<string, string> }
    expect(req.headers['user-agent']).toBe('flux-test/1.0')
  })

  it('redacts a whole Config object, which is the accident it exists for', () => {
    const { stdout, line } = record('config-object')

    // `config.ts` never hands out `DATABASE_URL` — `describeTarget()` is the only
    // representation it exposes — but a `Config` passed whole to a log line would
    // otherwise print the database password.
    expect(stdout).not.toContain('SECRET-PW')
    expect((line.config as Record<string, string>).DATABASE_URL).toBe('[redacted]')
    // The rest of the object survives, so the line is still worth having.
    expect((line.config as Record<string, string>).NODE_ENV).toBe('test')
  })

  it('cannot reach a secret interpolated into the message, and says so', () => {
    const { line } = record('message-interpolation')

    /**
     * The documented limitation, asserted rather than asserted-about. `redact` matches
     * paths and `msg` is a string, so nothing addresses the inside of it — which is
     * the whole argument for passing objects instead of building strings.
     *
     * Written as a positive assertion on purpose. If a future pino ever did redact
     * `msg`, this failing is how we would learn that the caveat in `logger.ts` had
     * stopped being true.
     */
    expect(line.msg).toBe('token SECRET-IN-MESSAGE was rejected')
  })
})
