import { FluxError, type ErrorCode } from '@flux/contracts'
import { ZodError, type z, type ZodIssue, type ZodTypeAny } from 'zod'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The request boundary. Nothing unparsed goes past it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §3 puts a schema parse at the edge of every request, and
 * §7 says of `validation_failed`: "`fields[]` carries **every** failure, not the
 * first". That second sentence is the whole reason this file exists rather than a
 * `schema.parse()` at each call site.
 *
 * A form that is told about one error at a time makes the user submit six times to
 * discover six problems, and each round trip is a chance to lose what they typed.
 * zod already collects every issue; the work here is not throwing away the ones after
 * the first, and turning each into a path a form can attach to an input.
 *
 * ### Three things this does that a bare `parse()` does not
 *
 * **It flattens.** A `discriminatedUnion` or a `union` reports one issue whose real
 * detail hangs off `unionErrors`, so a bare walk of `error.issues` produces "Invalid
 * input" against the whole object and nothing about the field that was wrong. Every
 * nested `ZodError` is expanded.
 *
 * **It speaks one vocabulary.** zod's issue codes (`invalid_type`, `too_small`) are a
 * second error vocabulary alongside `ErrorCodeSchema`, and a client switching on both
 * has to know which layer produced a message. Each issue is mapped to one of *our*
 * codes — and the distinction worth having is drawn: a missing property is
 * `required_field_missing`, a present-but-wrong one is `field_value_invalid`, and an
 * unexpected property is `unknown_field`. Those are three different sentences in a
 * form.
 *
 * **It is bounded.** A 5,000-element array of invalid objects produces 5,000 issues,
 * and an error body that is larger than the request that caused it. The list is
 * capped and the message states the true total, because "20 problems, showing the
 * first 20" and "5,000 problems, showing the first 20" must not look identical.
 *
 * ### WHAT THIS DOES NOT DO
 *
 *   • **Authorize.** A parse says the shape is right, never that the caller may send
 *     it. `field_not_writable` and `permission_denied` come from
 *     `evaluatePermission()` (§4), after this and against the resolved entity.
 *   • **Coerce.** Nothing here is lenient. A query string arrives as text, so numeric
 *     query parameters are declared with `z.coerce.number()` *in the schema*, where
 *     the coercion is visible to anyone reading the contract, rather than being
 *     applied invisibly by this helper.
 */

/**
 * The longest a single field message may be.
 *
 * zod echoes the received value in some messages — `invalid_enum_value` is "Invalid
 * enum value. Expected 'a' | 'b', received 'xyz'". Echoing the caller's own input
 * back to them is safe and genuinely useful, but a caller who sent a 2MB string gets
 * that 2MB string in the message, and an error body must not be a way to amplify a
 * request.
 */
const MAX_MESSAGE_LENGTH = 200

/**
 * The most field errors a single response will list.
 *
 * Chosen to be far more than a form can display and far less than an array import
 * can generate. The count in the message is the real one.
 */
const MAX_FIELD_ERRORS = 100

/** What part of the request is being parsed, used when an issue has no path of its own. */
export type RequestPart = 'body' | 'query' | 'params' | 'headers'

/**
 * Parse `value` against `schema`, or throw `validation_failed` describing every
 * problem.
 *
 * Returns `z.output<T>` rather than the input type, so a schema with a `transform` —
 * every branded id in `@flux/contracts` is one — hands back the branded value and the
 * rest of the handler cannot accidentally work with the raw string.
 */
export function parseRequest<T extends ZodTypeAny>(
  schema: T,
  value: unknown,
  part: RequestPart = 'body',
): z.output<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw validationFailed(result.error, part)
}

/**
 * Build the `validation_failed` error for an already-caught `ZodError`.
 *
 * Separate from `parseRequest` for the case that does not fit it: a handler that
 * parses several parts of a request and wants one response listing the problems in
 * all of them, rather than three responses discovered one at a time.
 */
export function validationFailed(error: ZodError, part: RequestPart = 'body'): FluxError {
  const all = toFieldErrors(error, part)
  const listed = all.slice(0, MAX_FIELD_ERRORS)

  return new FluxError('validation_failed', describe(all.length, listed.length), {
    fields: listed,
    cause: error,
  })
}

/**
 * Flatten a `ZodError` into one field error per problem.
 *
 * Exported because the import pipeline needs the same flattening for a row that
 * failed to parse, where the result is written to `import_row_errors` rather than
 * returned — and a second implementation of this would drift from the first in
 * exactly the ways that make two error formats.
 */
export function toFieldErrors(
  error: ZodError,
  part: RequestPart = 'body',
): { path: string; code: string; message: string }[] {
  const collected: { path: string; code: string; message: string }[] = []
  collect(error, [], part, collected, 0)
  return dedupe(collected)
}

function collect(
  error: ZodError,
  prefix: (string | number)[],
  part: RequestPart,
  out: { path: string; code: string; message: string }[],
  depth: number,
): void {
  /**
   * A union of unions of unions is legal and a cyclical schema can be built with
   * `z.lazy`, so the walk is bounded. Past the limit the outer issue is reported as
   * it stands, which is less specific than the nested one and is never nothing.
   */
  if (depth > 8) return

  for (const issue of error.issues) {
    const path = [...prefix, ...issue.path]

    /**
     * `unrecognized_keys` reports one issue for the *parent* object with the
     * offending names in `keys`. Reported as one error per key, at the key's own
     * path, because "this object has an unexpected property" cannot be attached to
     * an input while "`titel` is not a field" can — and that is the difference
     * between an error a user can act on and one they cannot.
     */
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          path: formatPath([...path, key], part),
          code: 'unknown_field',
          message: `${key} is not a field on this resource`,
        })
      }
      continue
    }

    // A union's real detail is in the nested errors, not in "Invalid input".
    const nested = nestedErrors(issue, prefix, path)
    if (nested.errors.length > 0) {
      const before = out.length
      for (const inner of nested.errors) collect(inner, nested.prefix, part, out, depth + 1)
      // Only fall through to the outer issue if the nested walk found nothing —
      // a union whose members all failed at the union level itself. Reporting both
      // would show the same field twice, once uselessly.
      if (out.length > before) continue
    }

    out.push({
      path: formatPath(path, part),
      code: codeFor(issue),
      message: truncate(issue.message),
    })
  }
}

/**
 * The nested `ZodError`s an issue can carry, **and the path their issues are relative
 * to** — which is not the same for all three, and assuming it was produced a defect.
 *
 * Three of zod's issue codes hide their detail this way. `invalid_union` is the one
 * that matters in practice — `@flux/contracts` uses `discriminatedUnion` for rule
 * nodes, filter ASTs and event payloads, so a malformed automation rule reports
 * "Invalid input" at the root and nothing else without this.
 *
 * ### The two kinds have different roots. Measured, not inferred.
 *
 * `invalid_union.unionErrors` issues carry the **full path from the root of the
 * parse** — the same path as the outer issue, extended. For `z.object({ v: z.union([
 * z.number(), z.boolean() ]) })` against `{ v: 'x' }`, the outer issue is at `['v']`
 * and *both* member issues are also at `['v']`, not at `[]`. So the walk must recurse
 * with the prefix it already had; adding `path` again produced `v.v`, and one level
 * deeper `a.v.a.v`. A union inside an array was worse still — `a[1].a[1]`.
 *
 * `invalid_arguments.argumentsError` is the opposite: its issues are relative to the
 * **arguments tuple**, so a bad first argument to a function at `nested.fn` reports
 * `[0]` and the prefix is what makes it `nested.fn[0]`. `invalid_return_type` behaves
 * the same way.
 *
 * That difference is why this returns the prefix rather than letting the caller pick
 * one. It is also why the defect survived review and the header's own example: a union
 * at the *root* of a schema has an empty prefix, so doubling it is invisible, and every
 * hand-written example is a union at the root. It only shows up nested — which is where
 * all five `z.union` sites in `@flux/contracts` actually sit:
 *
 *   • `QuerySchema.filter` → a `cmp` node's `value` is `FilterValueSchema`, so a bad
 *     filter value in a search or a saved view reported
 *     `filter.value.filter.value`;
 *   • `ImportMappingSchema.users`, `.projects` and `.fields` are records of unions, so
 *     a bad mapping reported `mapping.users.alice.mapping.users.alice`.
 *
 * Both are the two most union-heavy request bodies in the product, and the failure they
 * produced was not a wrong message but an **unattachable** one: no input on the form
 * has that path, so the user saw a red banner with no field marked and nothing to
 * correct — §13's "a control that silently does nothing", applied to an error.
 */
function nestedErrors(
  issue: ZodIssue,
  prefix: (string | number)[],
  path: (string | number)[],
): { errors: ZodError[]; prefix: (string | number)[] } {
  switch (issue.code) {
    case 'invalid_union':
      // Same root as the error we are already walking, so the same prefix.
      return { errors: issue.unionErrors, prefix }
    case 'invalid_arguments':
      // A new root: the arguments tuple, which lives at `path`.
      return { errors: [issue.argumentsError], prefix: path }
    case 'invalid_return_type':
      return { errors: [issue.returnTypeError], prefix: path }
    default:
      return { errors: [], prefix }
  }
}

/**
 * zod's issue code → ours.
 *
 * The one distinction worth the effort is the first: zod reports a missing property
 * and a property of the wrong type with the same `invalid_type` code, separated only
 * by `received === 'undefined'`. "Summary is required" and "Summary must be text" are
 * different sentences, and a form that cannot tell them apart says the wrong one
 * every time a field is left blank.
 */
function codeFor(issue: ZodIssue): ErrorCode {
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return 'required_field_missing'
  }
  return 'field_value_invalid'
}

/**
 * `a.b[0].c`, with the request part standing in for an empty path.
 *
 * Bracket notation for indices rather than `a.b.0.c`: a dotted index is
 * indistinguishable from an object key that happens to be numeric, and custom field
 * keys in this product are caller-chosen strings (`docs/specs/api/fields.md`), so
 * numeric-looking keys are reachable.
 *
 * An empty path means the whole part was wrong — a body that is an array, a query
 * that is not an object — and `body` is a better answer for that than `''`, which a
 * form would attach to nothing at all.
 */
function formatPath(path: (string | number)[], part: RequestPart): string {
  if (path.length === 0) return part

  let formatted = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${String(segment)}]`
    } else {
      formatted = formatted === '' ? segment : `${formatted}.${segment}`
    }
  }
  return formatted
}

/**
 * Drop exact duplicates.
 *
 * A union whose members each reject the same property produces the same field error
 * once per member — three identical lines saying `type is not valid` for a
 * three-member union. The path *and* the message are compared, so two genuinely
 * different problems on one field both survive.
 */
function dedupe(
  errors: { path: string; code: string; message: string }[],
): { path: string; code: string; message: string }[] {
  const seen = new Set<string>()
  const unique: typeof errors = []
  for (const error of errors) {
    const key = `${error.path}\u0000${error.code}\u0000${error.message}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(error)
  }
  return unique
}

/**
 * The top-level message.
 *
 * States the real total even when the list is capped, because §13's rule is that an
 * error names the cause it knows — and "20 problems" when there are 5,000 is a
 * different fact, one that changes what the user does next.
 */
function describe(total: number, listed: number): string {
  const problems = total === 1 ? '1 problem' : `${String(total)} problems`
  return listed < total
    ? `This request has ${problems} — the first ${String(listed)} are listed`
    : `This request has ${problems}`
}

function truncate(message: string): string {
  return message.length <= MAX_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
}

/** Re-exported so a call site catching a parse failure need not import zod for it. */
export { ZodError }
