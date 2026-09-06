import { FluxError, type ErrorCode } from '@flux/contracts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * PostgreSQL failures → the closed error vocabulary.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §7 says the HTTP status is derived from the code and
 * never set by hand. This file is where that rule meets the database: a driver
 * error is the one input that arrives with no code at all, so every write path
 * would otherwise invent its own mapping and the same constraint violation would
 * be a 409 in one module and a 500 in another.
 *
 * Three rules hold throughout.
 *
 * **Nothing from the driver reaches the client.** `err.detail` on a unique
 * violation is literally `Key (organization_id, key)=(0191…, PAY-1) already
 * exists.` — internal ids, and on other tables the row's actual values, which in
 * this product means another user's PII or another tenant's data. `err.message`
 * names tables and columns. Both go to the log with the trace id (§7: "The
 * message is for the caller; the detail goes to the log"), and the client gets a
 * sentence written here.
 *
 * **A SQLSTATE that means "we have a bug" maps to a 5xx, never to a 4xx.** The
 * temptation runs the other way, because a 4xx makes the graph look better. It is
 * the more expensive choice: a bug reported as the user's fault is a bug nobody
 * is paged for.
 *
 * **The mapping is by explicit code first, then by SQLSTATE class.** The class
 * fallback exists so that an unlisted code in a known family does not become a
 * bare 500 with no shape — but it is a fallback, and `mapPgError` records when it
 * was used so an unrecognised code can be added deliberately instead of silently
 * inheriting a neighbour's meaning.
 *
 * ### The one that is worth arguing about: 42501
 *
 * `42501` is `insufficient_privilege`, and it arrives here from three different
 * places (as `packages/db-tests/src/harness.ts` documents): a missing grant, an
 * RLS `WITH CHECK` rejection, and the append-only guard trigger in migration
 * 0014 — which chose that SQLSTATE explicitly so that, in its own words, "a
 * caller that already maps permission errors handles this without changes".
 *
 * This file does not do that, and the divergence is deliberate. Read the three
 * causes as *events in production*:
 *
 *   • a missing grant means the migration and the running code disagree;
 *   • an RLS `WITH CHECK` rejection means this service tried to write a row
 *     stamped with **another tenant's** `organization_id`;
 *   • the append-only guard firing means it tried to UPDATE `audit_log`.
 *
 * None of those is a thing the caller did, and none is fixable by the caller.
 * The second one is the most serious event this codebase can produce. Mapping it
 * to `permission_denied` would return a tidy 403, the client would render "you do
 * not have permission to do that", and a cross-tenant write attempt would be
 * indistinguishable from a user opening a page they are not entitled to — in the
 * dashboard, in the alerting, and in the on-call runbook.
 *
 * So 42501 is `internal_error`, and `mapPgError` marks it `alarming` so the log
 * line is written at `error` with the SQLSTATE attached. Genuine authorization
 * decisions never reach this file: they are made by `evaluatePermission()`
 * before the write (§4), which is the only place a `permission_denied` is
 * allowed to come from.
 */

/**
 * The shape `pg` gives a database error. The driver types `query` as throwing
 * `unknown`, so without this every catch block casts.
 *
 * Mirrors `packages/db-tests/src/harness.ts`'s `PgError` rather than importing
 * it: that package is a private test package with no exports map, and freezing a
 * runtime dependency on a test package to save eight lines is a worse trade than
 * the duplication.
 */
export interface PgError extends Error {
  /**
   * SQLSTATE. Matched on instead of the message, which is localised and reworded
   * between minor versions.
   *
   * `| undefined` explicitly, and not just `?`. Under `exactOptionalPropertyTypes`
   * those two mean different things: `code?: string` says the property may be
   * absent but never *present and undefined*, which is a claim about the driver
   * that is false — `pg` builds a `DatabaseError` for a protocol-level failure
   * with `code` set to `undefined`, and `isPgError` below accepts exactly that
   * case on purpose. The interface said one thing and the type guard beneath it
   * said another; the guard was right.
   */
  code?: string | undefined
  constraint?: string
  table?: string
  column?: string
  schema?: string
  /** `RAISE ... USING DETAIL`, or the driver's own detail. Contains row values.
   *  **Never sent to a client.** */
  detail?: string
  hint?: string
  routine?: string
}

/**
 * True when `err` came from the driver rather than from our own code.
 *
 * Checks for a string `code` rather than using `instanceof`, because `pg`
 * constructs its errors in more than one place and a value that arrives with a
 * SQLSTATE is a database error whatever its prototype chain says.
 */
export function isPgError(err: unknown): err is PgError {
  return (
    err instanceof Error &&
    'code' in err &&
    (typeof (err as { code?: unknown }).code === 'string' ||
      (err as { code?: unknown }).code === undefined)
  )
}

interface Mapping {
  code: ErrorCode
  message: string
  /**
   * Whether this should be logged at `error` with the SQLSTATE, because it means
   * the service or the schema is wrong rather than the request. Distinct from
   * "is a 5xx": a connection failure is a 503 and is *not* alarming in this
   * sense — it is the database being restarted — whereas an RLS rejection is.
   */
  alarming: boolean
}

/**
 * One row of the tables below.
 *
 * A factory rather than an object literal per row, and the reason is legibility
 * under the formatter: at `printWidth: 100` the literal form wraps a third of these
 * rows onto four lines each, which turns a scannable thirty-row table into a hundred
 * and twenty lines where a SQLSTATE and the code it maps to are no longer on the
 * same line — and makes a one-entry change a four-line diff. A lookup table is only
 * readable as a table while each row is one row.
 *
 * `ALARMING` is passed by name rather than as a bare `true`, and the default is the
 * quiet one, so the rows that will page someone are exactly the rows carrying an
 * extra word. Those are the ones worth spotting while reading the table.
 */
const ALARMING = true

function mapping(code: ErrorCode, message: string, alarming = false): Mapping {
  return { code, message, alarming }
}

/**
 * The messages that repeat, named once.
 *
 * `OURS` covers every SQLSTATE meaning the service or the schema is wrong — eight
 * entries, one sentence, deliberately identical. A client can act on none of them
 * and must not be told which internal failure occurred, so a distinct message per
 * entry would be eight opportunities to leak a detail and eight places to edit when
 * the wording changes. The repetition is the point; naming it makes that explicit
 * rather than accidental.
 */
const OURS = 'The request could not be processed'
const UNAVAILABLE = 'The database is unavailable'
const AT_CAPACITY = 'The database is at capacity'
const RESTARTING = 'The database is restarting'
const CONTENDED = 'That item is being changed by someone else — try again'
const CONCURRENT = 'Conflicting changes were made at the same time — try again'
const NOT_ALLOWED = 'That value is not allowed'

/**
 * `class` here means the two-character SQLSTATE class, which is what makes the
 * fallback meaningful: `08` is always "the connection", `23` is always "a
 * constraint", and an unlisted member of either behaves like its family.
 */
const BY_CODE: Readonly<Record<string, Mapping>> = {
  // ── Class 08 / 53 / 57 — the database is not available to us ────────
  '08000': mapping('dependency_unavailable', UNAVAILABLE),
  '08001': mapping('dependency_unavailable', UNAVAILABLE),
  '08003': mapping('dependency_unavailable', UNAVAILABLE),
  '08004': mapping('dependency_unavailable', UNAVAILABLE),
  '08006': mapping('dependency_unavailable', UNAVAILABLE),
  /** too_many_connections — pool sizing against `max_connections`. */
  '53300': mapping('dependency_unavailable', AT_CAPACITY, ALARMING),
  '53400': mapping('dependency_unavailable', AT_CAPACITY, ALARMING),
  /** admin_shutdown / crash_shutdown / cannot_connect_now — a restart or failover. */
  '57P01': mapping('dependency_unavailable', RESTARTING),
  '57P02': mapping('dependency_unavailable', RESTARTING, ALARMING),
  '57P03': mapping('dependency_unavailable', RESTARTING),

  /**
   * query_canceled — almost always our own `statement_timeout` firing.
   *
   * `internal_error` rather than a 4xx: the request was valid and the server
   * could not answer it in the budget. It is in `RETRYABLE_CODES`, which is
   * imperfect — an identical retry will probably time out identically — but the
   * alternative is a code that does not exist, and inventing one is a change
   * request rather than a decision made here (§7).
   */
  '57014': mapping('internal_error', 'The request took too long and was cancelled', ALARMING),

  /**
   * lock_not_available — our `lock_timeout` firing. Contention, not corruption:
   * two people editing the same issue is the expected case, and retrying may
   * well succeed, which is exactly what `internal_error`'s presence in
   * `RETRYABLE_CODES` tells the client.
   */
  '55P03': mapping('internal_error', CONTENDED),

  /** serialization_failure / deadlock_detected. Retry is the correct response. */
  '40001': mapping('internal_error', CONCURRENT),
  '40P01': mapping('internal_error', CONCURRENT),

  // ── Class 23 — a constraint ─────────────────────────────────────────
  /**
   * unique_violation. The only one of these that is routinely the caller's
   * doing: two projects cannot share a key. `constraintFields` is how a module
   * turns this into a field error the form can attach to an input.
   */
  '23505': mapping('duplicate_key', 'That value is already taken'),
  '23P01': mapping('duplicate_key', 'That value overlaps one that already exists'),
  /**
   * foreign_key_violation → `invalid_reference` (422), which is precisely what
   * that code is for: "a body field names an entity that exists but is not valid
   * in this context", or does not exist at all.
   */
  '23503': mapping('invalid_reference', 'That reference does not exist'),
  '23502': mapping('required_field_missing', 'A required value was missing'),
  '23514': mapping('field_value_invalid', NOT_ALLOWED),

  // ── Class 22 — data exceptions ──────────────────────────────────────
  '22001': mapping('field_value_invalid', 'That value is too long'),
  '22003': mapping('field_value_invalid', 'That number is out of range'),
  '22007': mapping('field_value_invalid', 'That date is not valid'),
  '22008': mapping('field_value_invalid', 'That date is out of range'),
  /**
   * invalid_text_representation — a value that is not a valid UUID, enum member
   * or number reached SQL. Every request boundary is parsed by a zod schema
   * before the transaction opens (§3), so this means the parse was skipped or is
   * wrong. `internal_error`, and alarming: a 422 here would hide a hole in the
   * validation layer behind a message about the user's input.
   */
  '22P02': mapping('internal_error', OURS, ALARMING),

  // ── Ours to fix ─────────────────────────────────────────────────────
  /** See the header. A grant, an RLS WITH CHECK rejection, or 0014's guard. */
  '42501': mapping('internal_error', OURS, ALARMING),
  /** undefined_table / undefined_column / undefined_function — the running code
   *  and the applied migrations disagree. Nothing the caller can do. */
  '42P01': mapping('internal_error', OURS, ALARMING),
  '42703': mapping('internal_error', OURS, ALARMING),
  '42883': mapping('internal_error', OURS, ALARMING),
  /** read_only_sql_transaction — writing against a replica. A routing bug. */
  '25006': mapping('internal_error', OURS, ALARMING),
  /** raise_exception, from one of our own guard triggers with no explicit
   *  SQLSTATE. The trigger's own message is the detail, and it goes to the log. */
  P0001: mapping('internal_error', OURS, ALARMING),
}

const BY_CLASS: Readonly<Record<string, Mapping>> = {
  '08': mapping('dependency_unavailable', UNAVAILABLE),
  '53': mapping('dependency_unavailable', AT_CAPACITY, ALARMING),
  '57': mapping('dependency_unavailable', RESTARTING),
  '22': mapping('field_value_invalid', NOT_ALLOWED),
  '23': mapping('field_value_invalid', NOT_ALLOWED),
}

const UNKNOWN: Mapping = mapping('internal_error', OURS, ALARMING)

/**
 * The keys of the two tables above, exported for `pg-errors.test.ts` and read by
 * nothing in the service.
 *
 * The alternative was a copy of the list inside the test, and a copied list is the
 * curated-check shape `CLAUDE.md` warns about: it keeps passing while the table it
 * mirrors grows an entry that breaks one of the header's three rules. Exporting the
 * keys means "no alarming mapping is a 4xx" and "no client message contains a
 * SQLSTATE" are asserted over whatever is actually in the table, including the
 * entry added next year.
 */
export const MAPPED_SQLSTATES: readonly string[] = Object.keys(BY_CODE)
export const MAPPED_SQLSTATE_CLASSES: readonly string[] = Object.keys(BY_CLASS)

export interface MapPgErrorOptions {
  /**
   * Constraint name → the request-body path that caused it, so a unique or
   * check violation becomes a field error the form can render next to the input
   * rather than a banner saying "that value is already taken" about an
   * unspecified value.
   *
   * A map supplied per call site rather than a table in this file, because the
   * mapping is a property of the endpoint's body shape: `projects_key_unique`
   * is `key` when creating a project and `project.key` when creating one inside
   * an import. One global table would have to pick.
   */
  constraintFields?: Readonly<Record<string, string>>
}

export interface MappedPgError {
  error: FluxError
  /** Log at `error` with the SQLSTATE — the service or schema is wrong. */
  alarming: boolean
  /** The SQLSTATE, for the log. Absent when the driver gave none. */
  pgCode: string | undefined
  /**
   * Everything unsafe to return, gathered for the log line. Separate from
   * `error` so that no code path can accidentally serialise it into a response:
   * the exception filter only ever reads `error`.
   */
  detail: {
    pgCode: string | undefined
    constraint: string | undefined
    table: string | undefined
    column: string | undefined
    routine: string | undefined
    driverMessage: string
    driverDetail: string | undefined
    /** True when only the SQLSTATE *class* matched, so this code should be
     *  given an explicit entry above rather than inheriting one. */
    matchedByClass: boolean
  }
}

/**
 * Look `key` up in a caller-supplied map without consulting the prototype chain.
 *
 * `options.constraintFields?.[constraint]` reads naturally and is wrong, which a test
 * found rather than a review: a constraint named `constructor` resolves to
 * `Object.prototype.constructor`, so `fieldPath` becomes a **function**, the field
 * error is built with `path: [Function Object]`, and `ApiErrorSchema` then rejects the
 * whole body in `api-error.ts` — turning a legible 409 "that value is already taken"
 * into a bare 500. `toString`, `valueOf` and `hasOwnProperty` do the same.
 *
 * Not a security hole: constraint names come from `db/migrations/`, which is ours, so
 * nothing here is attacker-influenced. It is worse than that in one respect — it is a
 * landmine with a *plausible* trigger. `constructor` is a defensible name for a
 * constraint on a table of workflow builders, and the failure would appear as an
 * intermittent 500 on one endpoint with a correct-looking mapping table beside it.
 *
 * Two guards, because they catch different things. `hasOwnProperty` stops the
 * inherited members; the `typeof` check stops a non-string that reached the map
 * through an `any`, and is what keeps the return type honest rather than asserted.
 */
function ownProperty(
  map: Readonly<Record<string, string>> | undefined,
  key: string,
): string | undefined {
  if (map === undefined) return undefined
  if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined
  const value = map[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Translate a driver error into a `FluxError` plus a log record.
 *
 * Returns rather than throws so the caller can log before rethrowing, and so a
 * test can assert both halves. The two are returned together on purpose: the
 * client-safe error and the operator-only detail are produced by one decision,
 * and splitting them into two functions is how one of them gets skipped.
 */
export function mapPgError(err: unknown, options: MapPgErrorOptions = {}): MappedPgError {
  const pgError = isPgError(err) ? err : undefined
  const pgCode = pgError?.code

  const explicit = pgCode === undefined ? undefined : BY_CODE[pgCode]
  const byClass = pgCode === undefined ? undefined : BY_CLASS[pgCode.slice(0, 2)]
  const mapping = explicit ?? byClass ?? UNKNOWN

  const constraint = pgError?.constraint
  const fieldPath =
    constraint === undefined ? undefined : ownProperty(options.constraintFields, constraint)

  const error = new FluxError(mapping.code, mapping.message, {
    ...(fieldPath === undefined
      ? {}
      : {
          fields: [
            {
              path: fieldPath,
              // The contract's `FieldErrorSchema.code` is a free string; using
              // the FluxError code keeps it in one vocabulary rather than
              // inventing a second set of per-field codes.
              code: mapping.code,
              message: mapping.message,
            },
          ],
        }),
    // `cause` and not a copied message: the driver's text names tables and
    // columns, and `FluxError.message` is returned to the client verbatim.
    cause: err,
  })

  return {
    error,
    alarming: mapping.alarming,
    pgCode,
    detail: {
      pgCode,
      constraint,
      table: pgError?.table,
      column: pgError?.column,
      routine: pgError?.routine,
      driverMessage: pgError?.message ?? String(err),
      driverDetail: pgError?.detail,
      matchedByClass: explicit === undefined && byClass !== undefined,
    },
  }
}
