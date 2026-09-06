import { describe, expect, it } from 'vitest'
import { EnvSchema, parseConfig } from './config.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The boot-time contract, and the one rule that is a security property.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `config.ts` makes three promises. Two are ordinary: the defaults are what the
 * header says, and every problem is reported rather than the first. The third is
 * a security property — **no value from the environment is reproduced in the
 * failure message** — and it is the reason this file is longer than the module
 * it tests.
 *
 * That promise is checked by a sweep rather than by a list. Writing it as
 * "assert `DATABASE_URL` is not echoed" would pass today and prove nothing about
 * the variable someone adds next year, and a hand-maintained list of "the
 * secret-bearing ones" is the curated-check shape `CLAUDE.md` warns about: it
 * rots silently, and a check that passes over a blind spot licenses the belief
 * that the whole schema is clean.
 *
 * So the sweep poisons **every key in `EnvSchema.shape`** in turn with a
 * credential-shaped value and asserts no message reproduces it. Writing it found
 * two real leaks, which is the argument for it.
 */

/**
 * The distinctive half of the poison. Long, unmistakable and present nowhere
 * else in the repository, so a `not.toContain` on it cannot pass by accident and
 * a failure names itself in the diff.
 */
const PASSWORD = 'hunter2-must-never-reach-a-log'

const POISON_HOST = 'db.internal.example'

/**
 * A value shaped exactly like the realistic mistake: `DATABASE_URL`'s value in
 * some other variable's slot, because a deploy configuration was one line out of
 * alignment. It is a *valid* connection string, which matters — the two variables
 * that legitimately accept it are identified by the sweep rather than assumed.
 */
const POISON = `postgres://flux_app_svc:${PASSWORD}@${POISON_HOST}:5432/flux`

/** The smallest environment that parses. Everything else has a default. */
function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { DATABASE_URL: 'postgres://flux_app:devpw@127.0.0.1:5432/flux', ...overrides }
}

/** The failure message, or `undefined` when the environment parsed. */
function messageFor(env: Record<string, string | undefined>): string | undefined {
  try {
    parseConfig(env)
    return undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** The message, asserting that there was one. Keeps the arrange-act-assert short. */
function reject(env: Record<string, string | undefined>): string {
  const message = messageFor(env)
  expect(message, 'expected this environment to be rejected').toBeDefined()
  return message as string
}

/** How many problems a failure message lists. One bullet per issue. */
function bulletCount(message: string): number {
  return message.split('•').length - 1
}

describe('the failure message reproduces no environment value', () => {
  /**
   * The two variables that accept the poison, and why each one legitimately
   * does. This is an exact set rather than a floor: a new variable that also
   * accepts a credential-shaped string should fail here once, and be added with
   * a reason, rather than sliding in under a `>=` comparison.
   */
  const ACCEPTS_A_CONNECTION_STRING = [
    // Any non-empty string is a valid host. Nothing about the value is wrong.
    'HOST',
    // The poison *is* a connection string, so of course this one takes it.
    'DATABASE_URL',
  ].sort((a, b) => a.localeCompare(b))

  it('holds for every key in EnvSchema.shape', () => {
    const keys = Object.keys(EnvSchema.shape)
    // The sweep is only worth anything if it swept. A schema refactor that broke
    // `.shape` would otherwise turn this whole file into a no-op that passes.
    expect(keys.length).toBeGreaterThanOrEqual(10)

    const accepted: string[] = []
    const rejected: string[] = []

    for (const key of keys) {
      const env = validEnv({ [key]: POISON })

      let message: string | undefined
      try {
        const config = parseConfig(env)
        accepted.push(key)
        // The accepted case is not a free pass. `describeTarget()` is the one
        // representation of `DATABASE_URL` that may be printed, so the poison
        // reaching it must not carry the password through.
        expect(config.describeTarget(), `${key}: describeTarget leaked the password`).not.toContain(
          PASSWORD,
        )
        continue
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }

      rejected.push(key)
      expect(message, `${key}: the failure message echoed the password`).not.toContain(PASSWORD)
      expect(message, `${key}: the failure message echoed the whole value`).not.toContain(POISON)
      expect(message, `${key}: the failure message echoed the host`).not.toContain(POISON_HOST)
      // Saying nothing about the value only helps if it says which variable.
      expect(message, `${key}: the failure message does not name the variable`).toContain(key)
    }

    expect(accepted.sort((a, b) => a.localeCompare(b))).toEqual(ACCEPTS_A_CONNECTION_STRING)
    expect(rejected).toHaveLength(keys.length - ACCEPTS_A_CONNECTION_STRING.length)
  })

  it('says how long the value was, since the length is the diagnosable part', () => {
    const message = reject(validEnv({ PORT: POISON }))
    expect(message).toContain(`a ${String(POISON.length)}-character value`)
    expect(message).toContain('it may hold a credential')
  })
})

describe('describeRejected bounds the echo by shape, not by removing it', () => {
  /**
   * The echo is worth keeping: `PORT must be a whole number, got "3000ms"` is
   * fixed in seconds and `PORT must be a whole number` sends someone to read a
   * deploy manifest. These tests pin both halves of the filter, because dropping
   * either one silently changes a security property into a convenience.
   */
  it('reproduces a short value with no credential punctuation', () => {
    expect(reject(validEnv({ PORT: '3000ms' }))).toContain('got "3000ms"')
  })

  it('reproduces a value of exactly the length limit, and not one longer', () => {
    const atLimit = 'x'.repeat(24)
    expect(reject(validEnv({ PORT: atLimit }))).toContain(`got "${atLimit}"`)

    const overLimit = 'x'.repeat(25)
    const message = reject(validEnv({ PORT: overLimit }))
    expect(message).not.toContain(overLimit)
    expect(message).toContain('a 25-character value')
  })

  it.each([
    [':', 'a scheme or a host:port separator'],
    ['@', 'a userinfo separator'],
    ['/', 'a path separator'],
    ['\\', 'a Windows path or an escape'],
    ['?', 'a query string, which is how libpq accepts ?password='],
    ['#', 'a fragment'],
    [' ', 'a key=value pair or a quoted secret'],
    ['\t', 'a pasted line from a table'],
  ])('withholds a value containing %j, which can appear in %s', (character) => {
    const value = `12${character}34`
    const message = reject(validEnv({ PORT: value }))
    expect(message).not.toContain(value)
    expect(message).toContain('it may hold a credential')
  })
})

describe('one line per problem, in a vocabulary that says what to do', () => {
  it('reports every problem rather than the first', () => {
    const message = reject({ DATABASE_URL: 'not-a-url', NODE_ENV: 'prod', PORT: 'abc' })
    expect(bulletCount(message)).toBe(3)
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('NODE_ENV')
    expect(message).toContain('PORT')
  })

  it('says a missing variable is not set, rather than zod’s "Required"', () => {
    const message = reject({})
    expect(message).toContain('DATABASE_URL is not set')
    expect(message).not.toContain('Required')
    expect(bulletCount(message)).toBe(1)
  })

  it('names the expected type when the variable is present but not a string', () => {
    // A cast, because the signature already forbids this — but `process.env` is
    // typed, not enforced, and a test harness or a config loader that hands over
    // a parsed YAML value produces exactly this.
    const message = reject(validEnv({ HOST: 123 as unknown as string }))
    expect(message).toContain('HOST must be string')
  })

  it('lists an enum’s options and does not echo the value it rejected', () => {
    const message = reject(validEnv({ NODE_ENV: 'prod' }))
    expect(message).toContain('NODE_ENV must be one of development, test, production')
    // zod's own message for this issue ends "…received 'prod'". That is the leak
    // `describeIssue` exists to close; `NODE_ENV` cannot hold a secret, so the
    // sweep above is what makes the case convincing and this is what pins it.
    expect(message).not.toContain("received 'prod'")
    expect(message).not.toContain('Invalid enum value')
  })

  it('lists every log level, so a typo does not require reading the source', () => {
    const message = reject(validEnv({ LOG_LEVEL: 'verbose' }))
    expect(message).toContain('fatal, error, warn, info, debug, trace, silent')
    expect(message).not.toContain('verbose')
  })

  /**
   * `describeIssue`'s default branch, reached by `too_small`. Pinned by the
   * `NAME:` prefix rather than by zod's sentence, because the point of the
   * assertion is *which branch ran* — the sentence is zod's to reword, and it
   * describes the constraint rather than the value either way.
   */
  it('falls through to the variable-prefixed form for a constraint zod words itself', () => {
    const message = reject(validEnv({ HOST: '' }))
    expect(message).toContain('HOST:')
    expect(message).not.toContain('HOST is not set')
  })

  it('opens with a refusal to start and points at the two files that explain it', () => {
    const message = reject({})
    expect(message.startsWith('Invalid environment')).toBe(true)
    expect(message).toContain('the API will not start')
    expect(message).toContain('services/api/README.md')
    expect(message).toContain('.env.example')
  })
})

describe('defaults', () => {
  it('needs only DATABASE_URL, and the rest are the documented values', () => {
    const config = parseConfig({ DATABASE_URL: 'postgres://flux_app:devpw@127.0.0.1:5432/flux' })

    expect(config.NODE_ENV).toBe('development')
    expect(config.PORT).toBe(3000)
    // Loopback, not 0.0.0.0. A container overrides it explicitly, which is the
    // point at which someone has thought about which interfaces are exposed.
    expect(config.HOST).toBe('127.0.0.1')
    expect(config.DATABASE_POOL_MAX).toBe(10)
    expect(config.DATABASE_CONNECT_TIMEOUT_MS).toBe(5_000)
    expect(config.STATEMENT_TIMEOUT_MS).toBe(10_000)
    expect(config.LOCK_TIMEOUT_MS).toBe(3_000)
    expect(config.IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(15_000)
    expect(config.LOG_LEVEL).toBe('info')
    expect(config.isProduction).toBe(false)
  })

  it('treats an empty variable as unset, because a container templates them that way', () => {
    // `PORT=` in a compose file or a Kubernetes env block is an empty string,
    // not an absent key. Rejecting it would fail a deploy over a blank line.
    const config = parseConfig(validEnv({ PORT: '', STATEMENT_TIMEOUT_MS: '' }))
    expect(config.PORT).toBe(3000)
    expect(config.STATEMENT_TIMEOUT_MS).toBe(10_000)
  })

  it('sets isProduction only for production', () => {
    expect(parseConfig(validEnv({ NODE_ENV: 'production' })).isProduction).toBe(true)
    expect(parseConfig(validEnv({ NODE_ENV: 'test' })).isProduction).toBe(false)
    expect(parseConfig(validEnv({ NODE_ENV: 'development' })).isProduction).toBe(false)
  })
})

describe('numeric bounds', () => {
  it('accepts PORT 0, which is how the integration suite avoids fighting for 3000', () => {
    expect(parseConfig(validEnv({ PORT: '0' })).PORT).toBe(0)
  })

  it.each([
    ['PORT', '65535', '65536'],
    ['DATABASE_POOL_MAX', '100', '101'],
    ['DATABASE_CONNECT_TIMEOUT_MS', '60000', '60001'],
    ['STATEMENT_TIMEOUT_MS', '120000', '120001'],
    ['LOCK_TIMEOUT_MS', '30000', '30001'],
    ['IDLE_IN_TRANSACTION_TIMEOUT_MS', '120000', '120001'],
  ])('accepts %s at its maximum and rejects one past it', (variable, max, over) => {
    expect(messageFor(validEnv({ [variable]: max }))).toBeUndefined()
    expect(reject(validEnv({ [variable]: over }))).toContain(`${variable} must be between`)
  })

  it.each([
    ['DATABASE_POOL_MAX', '1', '0'],
    ['DATABASE_CONNECT_TIMEOUT_MS', '100', '99'],
    ['STATEMENT_TIMEOUT_MS', '100', '99'],
    ['LOCK_TIMEOUT_MS', '50', '49'],
    ['IDLE_IN_TRANSACTION_TIMEOUT_MS', '1000', '999'],
  ])('accepts %s at its minimum and rejects one below it', (variable, min, under) => {
    expect(messageFor(validEnv({ [variable]: min }))).toBeUndefined()
    expect(reject(validEnv({ [variable]: under }))).toContain(`${variable} must be between`)
  })

  it.each(['-1', '1.5', '1e3', '0x10', '+1', ' 1', '1 ', 'Infinity'])(
    'rejects %j rather than coercing it',
    (value) => {
      // Every one of these is something `Number()` accepts and a whole number is
      // not. `z.coerce.number()` would have taken four of them.
      expect(reject(validEnv({ DATABASE_POOL_MAX: value }))).toContain(
        'DATABASE_POOL_MAX must be a whole number',
      )
    },
  )
})

describe('DATABASE_URL', () => {
  it.each(['', '   ', '\t\n'])('rejects %j as empty', (value) => {
    expect(reject(validEnv({ DATABASE_URL: value }))).toContain('DATABASE_URL is empty')
  })

  it.each(['flux', '//host/db', 'my db://flux'])('rejects %j as not a URL', (value) => {
    const message = reject(validEnv({ DATABASE_URL: value }))
    expect(message).toContain('DATABASE_URL is not a URL')
    // The expected shape is shown, and it is a placeholder rather than the
    // rejected value — the whole reason this is a custom issue.
    expect(message).toContain('postgres://user:password@host:port/database')
  })

  /**
   * The second and third entries are the surprise, and they are why this is a
   * `.each` rather than three assertions about `http://`.
   *
   * `new URL('localhost:5432/flux')` **succeeds**: WHATWG URL reads `localhost:`
   * as the scheme and `5432/flux` as an opaque path, so a connection string with
   * the scheme left off is not caught by the parse at all — it arrives here. The
   * message is still the right diagnosis (the scheme is indeed missing), which is
   * the only reason this is a documented case rather than a defect.
   */
  it.each([
    'http://host/db',
    'mysql://host/db',
    'file:///tmp/db',
    'localhost:5432/flux',
    'host:5432',
  ])('rejects %j for its scheme', (value) => {
    expect(reject(validEnv({ DATABASE_URL: value }))).toContain(
      'DATABASE_URL must use the postgres:// or postgresql:// scheme',
    )
  })

  it('accepts both spellings of the scheme, because libpq does', () => {
    expect(messageFor(validEnv({ DATABASE_URL: 'postgres://u:p@h:5432/d' }))).toBeUndefined()
    expect(messageFor(validEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d' }))).toBeUndefined()
  })

  it('leaves the rest of the grammar to pg rather than re-implementing libpq', () => {
    // A socket directory in the host position is valid to libpq and meaningless
    // to a hand-written check. Two parsers that disagree is worse than one, and
    // the one that matters is the one that opens the connection.
    expect(messageFor(validEnv({ DATABASE_URL: 'postgres:///flux' }))).toBeUndefined()
  })
})

describe('describeTarget is the only printable form of DATABASE_URL', () => {
  function describeTarget(url: string): string {
    return parseConfig(validEnv({ DATABASE_URL: url })).describeTarget()
  }

  it('names the database, host, port and user', () => {
    expect(describeTarget(`postgres://flux_app:${PASSWORD}@db.example:5433/fluxdb`)).toBe(
      'fluxdb at db.example:5433 as flux_app',
    )
  })

  it('never contains the password', () => {
    expect(describeTarget(`postgres://flux_app:${PASSWORD}@db.example:5433/fluxdb`)).not.toContain(
      PASSWORD,
    )
  })

  /**
   * The case that decided the implementation. Deleting `password` from a parsed
   * URL and re-serialising it would pass every other test in this block and fail
   * this one: `URL.toString()` preserves the query string, and libpq accepts a
   * password there.
   */
  it('drops a password passed as a query parameter', () => {
    const target = describeTarget(`postgres://flux_app@db.example/fluxdb?password=${PASSWORD}`)
    expect(target).not.toContain(PASSWORD)
    expect(target).not.toContain('password=')
    expect(target).toBe('fluxdb at db.example:5432 as flux_app')
  })

  it('drops every other connection parameter too, not just the ones named password', () => {
    // `sslkey`, `sslpassword` and `options` all carry things that must not be
    // logged, and an allowlist of parameter names to strip would need a new
    // entry each time libpq gains one. Nothing is carried across.
    const target = describeTarget(
      `postgres://flux_app@db.example/fluxdb?sslpassword=${PASSWORD}&options=-c%20search_path%3Dsecret`,
    )
    expect(target).toBe('fluxdb at db.example:5432 as flux_app')
  })

  it('assumes 5432 when no port is given, which is what libpq does', () => {
    expect(describeTarget('postgres://flux_app:p@db.example/fluxdb')).toBe(
      'fluxdb at db.example:5432 as flux_app',
    )
  })

  it('says so rather than printing an empty string when there is no user', () => {
    expect(describeTarget('postgres://db.example:5432/fluxdb')).toBe(
      'fluxdb at db.example:5432 as <no user>',
    )
  })

  it('says so rather than printing an empty string when there is no database', () => {
    expect(describeTarget('postgres://flux_app:p@db.example:5432')).toBe(
      '<no database> at db.example:5432 as flux_app',
    )
  })

  it('decodes a percent-encoded user, because an email address is a valid role name', () => {
    expect(describeTarget('postgres://flux%40corp.example:p@db.example/fluxdb')).toBe(
      'fluxdb at db.example:5432 as flux@corp.example',
    )
  })
})
