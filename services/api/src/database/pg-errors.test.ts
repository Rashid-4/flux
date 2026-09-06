import { FluxError, HTTP_STATUS_BY_CODE, RETRYABLE_CODES } from '@flux/contracts'
import { describe, expect, it } from 'vitest'
import {
  isPgError,
  mapPgError,
  MAPPED_SQLSTATE_CLASSES,
  MAPPED_SQLSTATES,
  type PgError,
} from './pg-errors.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The three rules in `pg-errors.ts`, asserted over the whole table.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Its header states three rules, and each one is a property of *every* entry
 * rather than of the entries someone thought to test:
 *
 *   1. nothing from the driver reaches the client;
 *   2. a SQLSTATE meaning "we have a bug" is a 5xx, never a 4xx;
 *   3. the class fallback is recorded, so an unlisted code can be added
 *      deliberately instead of silently inheriting a neighbour's meaning.
 *
 * So the sweeps below run over `MAPPED_SQLSTATES` — the table's own keys — for the
 * reason `config.test.ts` sweeps `EnvSchema.shape`. A copied list of "the
 * interesting SQLSTATEs" would still pass on the day someone adds a 4xx mapping for
 * an RLS rejection, which is the mistake rule 2 exists to prevent.
 *
 * The individual cases after the sweeps are the ones where the *choice* is the
 * thing under test — 42501 above all, where this file deliberately diverges from
 * what migration 0014 suggested.
 */

/**
 * The driver's own text, containing everything §7 says must not be returned:
 * another tenant's id, a real column value, and the internal table name.
 */
const DRIVER_MESSAGE =
  'duplicate key value violates unique constraint "issues_org_key_unique" on table "issues"'
const DRIVER_DETAIL =
  'Key (organization_id, key)=(0191c8f0-1111-7000-8000-000000000001, PAY-1) already exists.'

function pgError(overrides: Partial<PgError> & { code?: string } = {}): PgError {
  const err = new Error(overrides.message ?? DRIVER_MESSAGE) as PgError
  err.name = 'error'
  err.code = 'code' in overrides ? overrides.code : '23505'
  err.detail = overrides.detail ?? DRIVER_DETAIL
  if (overrides.constraint !== undefined) err.constraint = overrides.constraint
  if (overrides.table !== undefined) err.table = overrides.table
  if (overrides.column !== undefined) err.column = overrides.column
  if (overrides.routine !== undefined) err.routine = overrides.routine
  return err
}

/** Everything a client would receive, as one string, for negative assertions. */
function clientVisible(error: FluxError): string {
  return JSON.stringify({
    code: error.code,
    message: error.message,
    fields: error.fields,
    meta: error.meta,
  })
}

describe('rule 1 — nothing from the driver reaches the client', () => {
  it.each([...MAPPED_SQLSTATES])('holds for %s', (code) => {
    const err = pgError({
      code,
      constraint: 'issues_org_key_unique',
      table: 'issues',
      column: 'key',
    })
    const mapped = mapPgError(err, { constraintFields: { issues_org_key_unique: 'key' } })

    const visible = clientVisible(mapped.error)
    expect(visible).not.toContain(DRIVER_MESSAGE)
    expect(visible).not.toContain(DRIVER_DETAIL)
    // The two fragments that make the detail dangerous, checked separately: a
    // future truncation that kept "the first 60 characters" would defeat the
    // whole-string assertions above and still leak the tenant id.
    expect(visible).not.toContain('0191c8f0-1111-7000-8000-000000000001')
    expect(visible).not.toContain('PAY-1')
    // The table and column names are schema internals, and the constraint name is
    // the one piece of driver data that is *used* — mapped to a body path, never
    // reproduced.
    expect(visible).not.toContain('issues_org_key_unique')
    expect(visible).not.toContain('unique constraint')
    // The SQLSTATE itself is a database identifier, not an error vocabulary.
    expect(visible).not.toContain(code)
  })

  it('keeps the driver error as the cause, because that is where the log reads it', () => {
    const err = pgError()
    const mapped = mapPgError(err)

    // Not a copied message — the same object. `api-error.ts` walks `cause` into
    // its operator-only `detail`, so this is the whole path by which a SQLSTATE
    // survives an error that travelled further than expected.
    expect(mapped.error.cause).toBe(err)
    expect(mapped.error.message).not.toContain(DRIVER_MESSAGE)
  })

  it('gathers the unsafe fields into detail, which the filter never serialises', () => {
    const err = pgError({
      code: '23505',
      constraint: 'issues_org_key_unique',
      table: 'issues',
      column: 'key',
      routine: '_bt_check_unique',
    })
    const mapped = mapPgError(err)

    expect(mapped.detail).toEqual({
      pgCode: '23505',
      constraint: 'issues_org_key_unique',
      table: 'issues',
      column: 'key',
      routine: '_bt_check_unique',
      driverMessage: DRIVER_MESSAGE,
      driverDetail: DRIVER_DETAIL,
      matchedByClass: false,
    })
  })
})

describe('rule 2 — a bug of ours is a 5xx, never a 4xx', () => {
  it.each([...MAPPED_SQLSTATES])('holds for %s', (code) => {
    const mapped = mapPgError(pgError({ code }))
    const status = HTTP_STATUS_BY_CODE[mapped.error.code]

    if (mapped.alarming) {
      expect(status, `${code} is alarming and must not be a 4xx`).toBeGreaterThanOrEqual(500)
    }
    // Every mapping resolves to a real status. Guaranteed by the types today;
    // asserted because `ErrorCode` and the status table are two hand-maintained
    // lists and this is the seam between them.
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThanOrEqual(599)
  })

  /**
   * `alarming` is deliberately not "is a 5xx", and the two must stay separable —
   * the `Mapping` comment says so and this is what stops the flag being quietly
   * refactored into `status >= 500`. A database being restarted is a 503 that
   * nobody should be paged for.
   */
  it('is not a synonym for 5xx', () => {
    const restarting = mapPgError(pgError({ code: '57P03' }))
    expect(HTTP_STATUS_BY_CODE[restarting.error.code]).toBe(503)
    expect(restarting.alarming).toBe(false)

    const contended = mapPgError(pgError({ code: '55P03' }))
    expect(HTTP_STATUS_BY_CODE[contended.error.code]).toBe(500)
    expect(contended.alarming).toBe(false)
  })

  /**
   * The divergence this file argues for at length. `packages/db-tests`' harness
   * notes that migration 0014 picked 42501 so that "a caller that already maps
   * permission errors handles this without changes" — and this is the caller that
   * deliberately does not.
   *
   * An RLS `WITH CHECK` rejection is this service attempting to write a row
   * stamped with another tenant's `organization_id`. Reported as 403 it is
   * indistinguishable from a user opening a page they lack access to, in the
   * dashboard and in the runbook alike.
   */
  it('maps 42501 to an alarming internal_error rather than to permission_denied', () => {
    const mapped = mapPgError(pgError({ code: '42501' }))

    expect(mapped.error.code).toBe('internal_error')
    expect(mapped.error.code).not.toBe('permission_denied')
    expect(HTTP_STATUS_BY_CODE[mapped.error.code]).toBe(500)
    expect(mapped.alarming).toBe(true)
    expect(mapped.pgCode).toBe('42501')
  })

  /**
   * The same shape one layer up. Every request boundary is parsed by a zod schema
   * before a transaction opens (§3), so a value SQL could not cast means the parse
   * was skipped or is wrong. A 422 here would present a hole in the validation
   * layer as the user's typo.
   */
  it('maps 22P02 to an alarming internal_error rather than to a 422', () => {
    const mapped = mapPgError(pgError({ code: '22P02' }))
    expect(mapped.error.code).toBe('internal_error')
    expect(mapped.alarming).toBe(true)
  })

  it('maps the constraint violations that genuinely are the caller’s doing', () => {
    expect(mapPgError(pgError({ code: '23505' })).error.code).toBe('duplicate_key')
    expect(mapPgError(pgError({ code: '23P01' })).error.code).toBe('duplicate_key')
    expect(mapPgError(pgError({ code: '23503' })).error.code).toBe('invalid_reference')
    expect(mapPgError(pgError({ code: '23502' })).error.code).toBe('required_field_missing')
    expect(mapPgError(pgError({ code: '23514' })).error.code).toBe('field_value_invalid')

    expect(HTTP_STATUS_BY_CODE.duplicate_key).toBe(409)
    expect(HTTP_STATUS_BY_CODE.invalid_reference).toBe(422)
  })

  /**
   * The timeout and contention codes are mapped to `internal_error` *because* it
   * is retryable, which `pg-errors.ts` calls imperfect and chooses anyway rather
   * than inventing a code outside the closed enum. If `internal_error` ever leaves
   * `RETRYABLE_CODES`, that reasoning silently stops holding — so it is pinned
   * here rather than left as a sentence in a comment.
   */
  it('relies on internal_error being retryable, so it asserts that it is', () => {
    expect(RETRYABLE_CODES.has('internal_error')).toBe(true)

    for (const code of ['57014', '55P03', '40001', '40P01']) {
      expect(mapPgError(pgError({ code })).error.code).toBe('internal_error')
    }
  })
})

describe('rule 3 — the class fallback is recorded, not silent', () => {
  it.each([...MAPPED_SQLSTATES])('does not report %s as a class match', (code) => {
    expect(mapPgError(pgError({ code })).detail.matchedByClass).toBe(false)
  })

  it.each([...MAPPED_SQLSTATE_CLASSES])('falls back for an unlisted code in class %s', (klass) => {
    // `Z9` cannot collide with a real member of any class, so this exercises the
    // fallback rather than an entry that happens to exist.
    const mapped = mapPgError(pgError({ code: `${klass}Z9` }))

    expect(mapped.detail.matchedByClass).toBe(true)
    expect(mapped.error).toBeInstanceOf(FluxError)
    // The fallback still produces a shaped error, which is the point of having
    // one. What it must not do is look like a deliberate mapping.
    expect(mapped.error.message).not.toBe('')
  })

  it('gives an unrecognised class a bare internal_error, and says it was not a class match', () => {
    const mapped = mapPgError(pgError({ code: 'ZZ999' }))

    expect(mapped.error.code).toBe('internal_error')
    expect(mapped.alarming).toBe(true)
    expect(mapped.pgCode).toBe('ZZ999')
    // False, not true: nothing matched at all. Reporting an unknown code as a
    // class match would put it in the "add an explicit entry" bucket alongside
    // codes that really do have a family, and hide the ones that do not.
    expect(mapped.detail.matchedByClass).toBe(false)
  })
})

describe('what is not a driver error at all', () => {
  it('maps a thrown non-Error to internal_error and keeps its text for the log', () => {
    const mapped = mapPgError('connection reset')

    expect(mapped.error.code).toBe('internal_error')
    expect(mapped.alarming).toBe(true)
    expect(mapped.pgCode).toBeUndefined()
    // `String(err)` rather than `err.message`, because the only evidence about a
    // thrown string is the string. An empty detail object here would be a 500
    // with nothing attached to it.
    expect(mapped.detail.driverMessage).toBe('connection reset')
    expect(mapped.detail.driverDetail).toBeUndefined()
    expect(mapped.detail.constraint).toBeUndefined()
  })

  it('maps a plain Error, which carries no SQLSTATE, to internal_error', () => {
    const mapped = mapPgError(new TypeError('something in our own code'))

    expect(mapped.error.code).toBe('internal_error')
    expect(mapped.pgCode).toBeUndefined()
    // `String(err)`, so the class name is included — `isPgError` rejects an Error
    // with no `code`, which sends it down the same branch as a thrown string.
    // Measured rather than assumed, and kept: for the one failure with no
    // SQLSTATE and no driver fields, "TypeError" is the most useful word in the
    // log line.
    expect(mapped.detail.driverMessage).toBe('TypeError: something in our own code')
  })

  it('does not double-wrap a FluxError, because it has no SQLSTATE to map', () => {
    // Not a passthrough — `mapPgError` is called from a catch block that has
    // already decided the error came from the driver, and `withTenant` is what
    // lets a `FluxError` through untouched. This pins the shape anyway: a
    // `FluxError` reaching here is mapped, not silently returned, so the day one
    // does the log says `internal_error` rather than pretending nothing happened.
    const original = new FluxError('version_conflict', 'That issue changed')
    const mapped = mapPgError(original)

    expect(mapped.error).not.toBe(original)
    expect(mapped.error.code).toBe('internal_error')
    expect(mapped.error.cause).toBe(original)
  })
})

describe('isPgError', () => {
  it('accepts an Error carrying a string code', () => {
    expect(isPgError(pgError({ code: '23505' }))).toBe(true)
  })

  it('accepts an Error whose code property is present but undefined', () => {
    // `pg` constructs its errors in more than one place and a `DatabaseError`
    // built for a protocol failure can carry `code: undefined`. Excluding it
    // would send that error down the "not from the driver" path, where the
    // driver's own fields are dropped from the log.
    const err = new Error('protocol') as PgError
    err.code = undefined
    expect(isPgError(err)).toBe(true)
  })

  it('rejects an Error with no code property at all', () => {
    expect(isPgError(new Error('ours'))).toBe(false)
  })

  it('rejects a numeric code, which is a syscall errno rather than a SQLSTATE', () => {
    // A number sliced to two characters is a nonsense SQLSTATE class, so treating
    // one as a driver error would send it through `BY_CLASS` and hand it a
    // neighbour's meaning.
    const err = new Error('socket') as Error & { code: unknown }
    err.code = 111
    expect(isPgError(err)).toBe(false)
  })

  it.each([null, undefined, 'ECONNREFUSED', 42, { code: '23505' }])(
    'rejects %j, which is not an Error',
    (value) => {
      expect(isPgError(value)).toBe(false)
    },
  )
})

describe('constraintFields turns a violation into a field error a form can render', () => {
  it('maps a known constraint to its body path', () => {
    const mapped = mapPgError(pgError({ code: '23505', constraint: 'projects_key_unique' }), {
      constraintFields: { projects_key_unique: 'key' },
    })

    expect(mapped.error.fields).toEqual([
      { path: 'key', code: 'duplicate_key', message: 'That value is already taken' },
    ])
  })

  it('uses the FluxError code as the field code, keeping one vocabulary', () => {
    const mapped = mapPgError(pgError({ code: '23514', constraint: 'issues_points_positive' }), {
      constraintFields: { issues_points_positive: 'storyPoints' },
    })

    expect(mapped.error.fields?.[0]?.code).toBe(mapped.error.code)
    expect(mapped.error.fields?.[0]?.path).toBe('storyPoints')
  })

  it('supports the nested path an import needs, which is why the map is per call site', () => {
    // `projects_key_unique` is `key` when creating a project and `project.key`
    // when creating one inside an import. A single global table would have to
    // pick one, and the other endpoint would attach the error to no input.
    const mapped = mapPgError(pgError({ code: '23505', constraint: 'projects_key_unique' }), {
      constraintFields: { projects_key_unique: 'project.key' },
    })

    expect(mapped.error.fields?.[0]?.path).toBe('project.key')
  })

  it('omits fields when the constraint is not in the map', () => {
    const mapped = mapPgError(pgError({ code: '23505', constraint: 'issues_some_other_unique' }), {
      constraintFields: { projects_key_unique: 'key' },
    })

    expect(mapped.error.fields).toBeUndefined()
    // The constraint is still in the operator's detail — it is how someone adds
    // the missing entry.
    expect(mapped.detail.constraint).toBe('issues_some_other_unique')
  })

  it('omits fields when the driver gave no constraint', () => {
    const mapped = mapPgError(pgError({ code: '23505' }), {
      constraintFields: { projects_key_unique: 'key' },
    })

    expect(mapped.error.fields).toBeUndefined()
  })

  it('omits fields when no map was supplied', () => {
    const mapped = mapPgError(pgError({ code: '23505', constraint: 'projects_key_unique' }))
    expect(mapped.error.fields).toBeUndefined()
  })

  /**
   * The defect this test found, kept as a regression rather than rewritten as a
   * statement of the fix.
   *
   * `options.constraintFields?.[constraint]` reads naturally and consults the
   * prototype chain, so a constraint named `constructor` resolved to
   * `Object.prototype.constructor` — a **function** — and the field error was
   * built with `path: [Function Object]`. `ApiErrorSchema` then rejects the body
   * in `api-error.ts`, so a legible 409 arrives at the client as a bare 500.
   *
   * Constraint names come from `db/migrations/`, so nothing here is
   * attacker-influenced. That makes it worse in one way rather than better: it is
   * a landmine with a plausible trigger and a symptom that points nowhere near
   * this file.
   */
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'does not resolve a constraint named %s through the prototype chain',
    (constraint) => {
      const mapped = mapPgError(pgError({ code: '23505', constraint }), {
        constraintFields: { projects_key_unique: 'key' },
      })

      expect(mapped.error.fields).toBeUndefined()
      // And the code stays 409. The failure mode was a status change, not just a
      // missing field, so that is what the regression asserts.
      expect(mapped.error.code).toBe('duplicate_key')
      expect(HTTP_STATUS_BY_CODE[mapped.error.code]).toBe(409)
    },
  )

  it('ignores a non-string path, which the types forbid and an any-typed map allows', () => {
    // The second half of the guard. A constraint map assembled from configuration
    // or spread from a wider object typechecks as `Record<string, string>` and can
    // hold anything, and one bad value must not take the whole error body with it.
    const badMap = { projects_key_unique: 42 } as unknown as Record<string, string>
    const mapped = mapPgError(pgError({ code: '23505', constraint: 'projects_key_unique' }), {
      constraintFields: badMap,
    })

    expect(mapped.error.fields).toBeUndefined()
    expect(mapped.error.code).toBe('duplicate_key')
  })
})
