import { ErrorCodeSchema, FieldErrorSchema, FluxError, QuerySchema } from '@flux/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseRequest, toFieldErrors, validationFailed, type RequestPart } from './validate.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * "`fields[]` carries **every** failure, not the first."
 * ══════════════════════════════════════════════════════════════════════
 *
 * That sentence from §7 is the reason this module exists instead of a `safeParse` at
 * each call site, and it is also the reason the tests here are mostly about *counts*
 * and *paths* rather than about messages. Three failure modes, in the order they
 * cost the most:
 *
 * **A path a form cannot attach to an input.** `items[0].name` can be highlighted;
 * `items.0.name` cannot be distinguished from a record key spelled `0`; `''` attaches
 * to nothing. A path is not cosmetic — it is the difference between an error the user
 * can fix and a red banner.
 *
 * **A union reported as "Invalid input" at the root.** `@flux/contracts` uses
 * `discriminatedUnion` for rule nodes, filter ASTs and event payloads, so this is not
 * a hypothetical: without flattening, every malformed automation rule produces one
 * useless error naming the whole object.
 *
 * **A field error the contract rejects.** `ApiErrorSchema` parses the response body on
 * the way out (`api-error.ts`), so a field error with a non-string path does not
 * produce a slightly-wrong 400 — it produces a **500**, exactly as the `constructor`
 * defect in `pg-errors.ts` did. Every test below that builds field errors also parses
 * them through `FieldErrorSchema`, because that is the only assertion that catches it.
 */

/** Every field error produced for `value`, without going through the FluxError. */
function fieldsFor(schema: z.ZodTypeAny, value: unknown, part: RequestPart = 'body') {
  const result = schema.safeParse(value)
  expect(result.success, 'the fixture was supposed to fail').toBe(false)
  return toFieldErrors((result as { error: z.ZodError }).error, part)
}

/** The thrown FluxError, or a failure if the parse unexpectedly succeeded. */
function thrown(schema: z.ZodTypeAny, value: unknown, part: RequestPart = 'body'): FluxError {
  try {
    parseRequest(schema, value, part)
  } catch (err) {
    expect(err).toBeInstanceOf(FluxError)
    return err as FluxError
  }
  throw new Error('the fixture was supposed to fail')
}

describe('parseRequest — the success path', () => {
  it('returns the transformed output, not the input', () => {
    // Every branded id in `@flux/contracts` is a `transform`, so returning
    // `z.input<T>` would hand the handler a bare string and the brand would exist
    // only in the type system.
    const schema = z.object({ id: z.string().transform((s) => `issue:${s}` as const) })

    expect(parseRequest(schema, { id: 'abc' })).toEqual({ id: 'issue:abc' })
  })

  it('does not coerce', () => {
    // Deliberate: a query parameter that needs coercion declares
    // `z.coerce.number()` in the schema, where a reader of the contract can see it.
    // A helper that coerced silently would make the contract a lie about its inputs.
    expect(() => parseRequest(z.object({ limit: z.number() }), { limit: '25' })).toThrow(FluxError)
  })
})

describe('every failure, not the first', () => {
  const schema = z.object({
    summary: z.string(),
    points: z.number(),
    assigneeId: z.string().uuid(),
  })

  it('lists one error per bad field', () => {
    const error = thrown(schema, { summary: 42, points: 'three', assigneeId: 'nope' })

    // The user-facing cost of getting this wrong: six submissions to discover six
    // problems, each round trip a chance to lose what they typed.
    expect(error.fields?.map((f) => f.path)).toEqual(['summary', 'points', 'assigneeId'])
    expect(error.code).toBe('validation_failed')
  })

  it('distinguishes a missing field from a wrong one', () => {
    const error = thrown(schema, { points: 'three', assigneeId: 'nope' })

    // zod reports both as `invalid_type`, separated only by `received ===
    // 'undefined'`. "Summary is required" and "Summary must be text" are different
    // sentences, and a form that cannot tell them apart says the wrong one every
    // time a field is left blank.
    const byPath = new Map(error.fields?.map((f) => [f.path, f.code]))
    expect(byPath.get('summary')).toBe('required_field_missing')
    expect(byPath.get('points')).toBe('field_value_invalid')
  })

  it('reports two problems on one field separately', () => {
    const both = z.object({
      key: z
        .string()
        .min(3)
        .regex(/^[A-Z]+$/),
    })

    // zod continues past the first check on a string, so both survive — and dedupe
    // must not collapse them, because they have different messages.
    expect(fieldsFor(both, { key: 'a' })).toHaveLength(2)
  })
})

describe('unknown fields', () => {
  const strict = z.object({ summary: z.string() }).strict()

  it('reports one error per unexpected key, at the key’s own path', () => {
    const fields = fieldsFor(strict, { summary: 'x', titel: 'typo', pionts: 3 })

    // zod reports a single `unrecognized_keys` issue against the *parent*, with the
    // names in `keys`. "This object has an unexpected property" cannot be attached to
    // an input; "`titel` is not a field" can.
    expect(fields).toEqual([
      { path: 'titel', code: 'unknown_field', message: 'titel is not a field on this resource' },
      { path: 'pionts', code: 'unknown_field', message: 'pionts is not a field on this resource' },
    ])
  })

  it('nests the path when the strict object is not the root', () => {
    const nested = z.object({ issue: z.object({ summary: z.string() }).strict() })

    expect(fieldsFor(nested, { issue: { summary: 'x', titel: 'typo' } })[0]?.path).toBe(
      'issue.titel',
    )
  })

  it('uses a code the contract knows', () => {
    // `unknown_field` is written as a literal in `validate.ts` rather than derived
    // from the enum, so nothing but this stops it drifting out of the vocabulary —
    // and an unrecognised code fails `ApiErrorSchema` on the way out, turning a 400
    // into a 500.
    expect(ErrorCodeSchema.safeParse('unknown_field').success).toBe(true)
  })
})

describe('unions are flattened', () => {
  const rule = z.discriminatedUnion('type', [
    z.object({ type: z.literal('field'), field: z.string(), value: z.string() }),
    z.object({ type: z.literal('group'), op: z.enum(['and', 'or']) }),
  ])

  it('reports the member’s real failure rather than "Invalid input" at the root', () => {
    const fields = fieldsFor(z.object({ where: rule }), { where: { type: 'group', op: 'xor' } })

    // A discriminated union narrows to one member, so this is the plain case.
    expect(fields.map((f) => f.path)).toEqual(['where.op'])
    expect(fields[0]?.message).toContain('xor')
  })

  it('reaches inside a plain union, whose detail hangs off unionErrors', () => {
    const either = z.union([
      z.object({ kind: z.literal('a'), n: z.number() }),
      z.object({ kind: z.literal('b'), s: z.string() }),
    ])

    const paths = fieldsFor(either, { kind: 'a', n: 'not a number' }).map((f) => f.path)

    // Both members fail, and the walk expands both. What must not happen is a single
    // error at the root path saying "Invalid input" — the shape a bare
    // `error.issues` walk produces, and the one that tells a user nothing.
    expect(paths).not.toEqual(['body'])
    expect(paths).toContain('n')
  })

  /**
   * The defect these tests found, and the reason the root case hid it.
   *
   * zod's `unionErrors` issues carry the **full** path from the root of the parse, not
   * a path relative to the union — so prefixing them with the outer issue's path
   * doubled it. A union at the root has an empty prefix, so the bug is invisible
   * there, and every hand-written example (including the one in `validate.ts`'s own
   * header) is a union at the root. One level down it produced `v.v`; two levels down
   * `a.v.a.v`; inside an array, `a[1].a[1]`.
   *
   * What made it worth fixing rather than noting is that the result is not a wrong
   * message but an **unattachable** one: `filter.filter.op` matches no input, so the
   * form shows a red banner with no field marked — §13's "a control that silently does
   * nothing" applied to an error.
   */
  const nestedPaths: { why: string; schema: z.ZodTypeAny; value: unknown; paths: string[] }[] = [
    {
      why: 'one level down — was v.v',
      schema: z.object({ v: z.union([z.number(), z.boolean()]) }),
      value: { v: 'x' },
      paths: ['v'],
    },
    {
      why: 'two levels down — was a.v.a.v',
      schema: z.object({ a: z.object({ v: z.union([z.number(), z.boolean()]) }) }),
      value: { a: { v: 'x' } },
      paths: ['a.v'],
    },
    {
      why: 'inside an array — was a[1].a[1]',
      schema: z.object({ a: z.array(z.union([z.number(), z.boolean()])) }),
      value: { a: [1, 'x'] },
      paths: ['a[1]'],
    },
    {
      why: 'a member’s own property — was w.w.n',
      schema: z.object({
        w: z.union([
          z.object({ kind: z.literal('a'), n: z.number() }),
          z.object({ kind: z.literal('b'), s: z.string() }),
        ]),
      }),
      value: { w: { kind: 'a', n: 'x' } },
      // Every member's complaint, because a plain union cannot know which one the
      // caller meant. All three are attachable to a real input, which is the property.
      paths: ['w.kind', 'w.n', 'w.s'],
    },
  ]

  it.each(nestedPaths)('reports a union $why', ({ schema, value, paths }) => {
    // The exact set rather than a no-repeated-segment heuristic: a doubled path fails
    // it, and so does a path that quietly loses a segment in the other direction.
    expect([...new Set(fieldsFor(schema, value).map((f) => f.path))].sort()).toEqual(paths)
  })

  /**
   * The same defect against the real contract, which is what makes it a bug report
   * rather than an observation about zod.
   *
   * `QuerySchema.filter` is a `discriminatedUnion` whose `cmp` member has a `value` of
   * `FilterValueSchema` — a plain eight-member `z.union`, nested. Every saved view and
   * every search request in the product goes through it, and `ImportMappingSchema` has
   * three more records of unions. Those are the five `z.union` sites in
   * `@flux/contracts`, and none is at a root.
   */
  it('produces an attachable path for a bad filter value in the real QuerySchema', () => {
    const fields = fieldsFor(QuerySchema, {
      filter: { op: 'cmp', field: 'status', cmp: 'eq', value: { nope: true } },
    })

    for (const field of fields) {
      // `filter.value` (or something under it) — never `filter.value.filter.value`.
      expect(field.path.startsWith('filter.value')).toBe(true)
      expect(field.path).not.toContain('filter.value.filter')
    }
    expect(fields.length).toBeGreaterThan(0)
  })

  it('still prefixes the nested errors that really are relative — function arguments', () => {
    /**
     * The other direction, and the reason `nestedErrors` returns a prefix rather than
     * always using `[]`. `invalid_arguments` issues are relative to the arguments
     * tuple, so the prefix is what turns `[0]` into `nested.fn[0]`. Fixing the union
     * case by dropping the prefix everywhere would have broken this silently — it
     * cannot arise from `parseRequest`, because argument validation happens when the
     * function is *called*, which is exactly why nothing else here would notice.
     */
    const schema = z.object({
      nested: z.object({ fn: z.function(z.tuple([z.number()]), z.boolean()) }),
    })
    const parsed = schema.parse({ nested: { fn: () => true } })

    let error: z.ZodError | undefined
    try {
      ;(parsed.nested.fn as unknown as (v: unknown) => boolean)('not a number')
    } catch (err) {
      error = err as z.ZodError
    }

    expect(error).toBeDefined()
    expect(toFieldErrors(error as z.ZodError).map((f) => f.path)).toEqual(['nested.fn[0]'])
  })

  it('falls back to the outer issue when the nested walk finds nothing', () => {
    // A union of primitives fails at the union level itself with no useful nesting.
    // The rule is "less specific is fine, nothing is not".
    const fields = fieldsFor(z.object({ v: z.union([z.number(), z.boolean()]) }), { v: 'x' })

    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) expect(field.path).toBe('v')
  })

  it('drops the duplicates a union produces, and keeps genuine repeats', () => {
    const threeWays = z.union([
      z.object({ kind: z.literal('a') }),
      z.object({ kind: z.literal('b') }),
      z.object({ kind: z.literal('c') }),
    ])

    // Each member rejects `kind` with a *different* message ("Invalid literal value,
    // expected \"a\"" and so on), so all three are genuinely different problems and
    // all three survive. Dedupe compares the message for exactly this reason.
    const fields = fieldsFor(threeWays, { kind: 'd' })
    expect(new Set(fields.map((f) => f.path))).toEqual(new Set(['kind']))
    expect(new Set(fields.map((f) => f.message)).size).toBe(fields.length)
  })

  it('terminates on a schema that nests deeper than the walk', () => {
    /**
     * `z.lazy` makes a genuinely recursive schema, and a union of unions of unions is
     * legal. Without the depth bound this is a stack overflow rather than a 400 —
     * from a request body, which makes it a denial of service reachable by anyone who
     * can send JSON.
     */
    type Node = { child: Node } | { leaf: number }
    const node: z.ZodType<Node> = z.lazy(() =>
      z.union([z.object({ child: node }), z.object({ leaf: z.number() })]),
    )

    let deep: unknown = { leaf: 'not a number' }
    for (let i = 0; i < 40; i += 1) deep = { child: deep }

    const fields = fieldsFor(node, deep)
    // Bounded, and never empty: past the limit the outer issue is reported as it
    // stands, which is less specific than the nested one and is still an answer.
    expect(fields.length).toBeGreaterThan(0)
  })
})

describe('paths', () => {
  it('uses brackets for array indices', () => {
    const schema = z.object({ items: z.array(z.object({ name: z.string() })) })

    expect(fieldsFor(schema, { items: [{ name: 'ok' }, { name: 7 }] })[0]?.path).toBe(
      'items[1].name',
    )
  })

  /**
   * The reason brackets are not a style choice.
   *
   * Custom field keys in this product are caller-chosen strings
   * (`docs/specs/api/fields.md`), so a key spelled `0` is reachable. With dotted
   * indices both of these would render `values.0` and a form could not tell which
   * input to highlight — one is the first element of a list, the other is a property.
   */
  it('renders a numeric record key differently from an array index', () => {
    const record = z.object({ values: z.record(z.string()) })
    const array = z.object({ values: z.array(z.string()) })

    expect(fieldsFor(record, { values: { 0: 7 } })[0]?.path).toBe('values.0')
    expect(fieldsFor(array, { values: [7] })[0]?.path).toBe('values[0]')
  })

  it('handles an index at the root and consecutive indices', () => {
    const grid = z.array(z.array(z.number()))

    expect(fieldsFor(grid, [[1], [2, 'x']])[0]?.path).toBe('[1][1]')
  })

  it.each<RequestPart>(['body', 'query', 'params', 'headers'])(
    'names the %s when the whole part is wrong',
    (part) => {
      // An empty path means the part itself was the wrong shape — a body that is an
      // array, a query that is not an object. `''` would attach to no input at all.
      expect(fieldsFor(z.object({ a: z.string() }), [], part)[0]?.path).toBe(part)
    },
  )
})

describe('the response is bounded', () => {
  const rows = z.array(z.object({ n: z.number() }))
  const invalid = Array.from({ length: 5_000 }, () => ({ n: 'x' }))

  it('caps the list at 100', () => {
    // An error body larger than the request that caused it is an amplification, and
    // an import can generate thousands of issues from one upload.
    expect(thrown(rows, invalid).fields).toHaveLength(100)
  })

  it('states the real total, not the number it listed', () => {
    // §13: an error names the cause it knows. "100 problems" when there are 5,000 is
    // a different fact, and it changes what the user does next — fix a form versus
    // fix the file they are importing.
    expect(thrown(rows, invalid).message).toBe(
      'This request has 5000 problems — the first 100 are listed',
    )
  })

  it('does not claim truncation when nothing was truncated', () => {
    expect(thrown(rows, [{ n: 'x' }, { n: 'y' }]).message).toBe('This request has 2 problems')
  })

  it('says "1 problem" rather than "1 problems"', () => {
    // Small, and the kind of thing that makes a product feel unfinished.
    expect(thrown(rows, [{ n: 'x' }]).message).toBe('This request has 1 problem')
  })

  it('truncates a message that echoes a huge value back', () => {
    const enumSchema = z.object({ status: z.enum(['todo', 'done']) })
    const field = fieldsFor(enumSchema, { status: 'x'.repeat(10_000) })[0]

    // zod's `invalid_enum_value` message quotes the received value, so a 2MB string
    // in the request becomes a 2MB string in the error body. Echoing input back is
    // useful; being a mirror is not.
    expect(field?.message).toHaveLength(200)
    expect(field?.message.endsWith('…')).toBe(true)
  })

  it('leaves a message at the limit alone', () => {
    // The boundary, because `<=` and `<` differ here by one character and the
    // off-by-one would append an ellipsis to a complete sentence.
    const exact = z.string().refine(() => false, { message: 'm'.repeat(200) })

    expect(fieldsFor(exact, 'x')[0]?.message).toBe('m'.repeat(200))
  })
})

describe('the field errors survive the contract on the way out', () => {
  /**
   * The assertion that turns a wrong-looking 400 into a caught bug.
   *
   * `api-error.ts` parses the body through `ApiErrorSchema` before sending it, so a
   * field error the contract rejects becomes a bare `internal_error` 500 — the caller
   * loses the field detail *and* the real status. Every shape this module can produce
   * is checked against `FieldErrorSchema` here rather than at each test above.
   */
  const cases: { why: string; schema: z.ZodTypeAny; value: unknown }[] = [
    { why: 'a missing field', schema: z.object({ a: z.string() }), value: {} },
    { why: 'a wrong type', schema: z.object({ a: z.string() }), value: { a: 1 } },
    {
      why: 'an unexpected key',
      schema: z.object({ a: z.string() }).strict(),
      value: { a: 'x', b: 1 },
    },
    {
      why: 'a nested array element',
      schema: z.object({ a: z.array(z.object({ b: z.number() })) }),
      value: { a: [{ b: 'x' }] },
    },
    {
      why: 'a union',
      schema: z.union([z.object({ k: z.literal('a') }), z.object({ k: z.literal('b') })]),
      value: { k: 'c' },
    },
    {
      why: 'a root-level shape failure',
      schema: z.object({ a: z.string() }),
      value: 'not an object',
    },
    {
      why: 'a record key that looks like an index',
      schema: z.record(z.number()),
      value: { 0: 'x' },
    },
    {
      why: 'a key that shadows Object.prototype',
      schema: z.object({ constructor: z.number() }),
      value: { constructor: 'x' },
    },
  ]

  it.each(cases)('accepts the errors from $why', ({ schema, value }) => {
    const fields = fieldsFor(schema, value)

    expect(fields.length).toBeGreaterThan(0)
    expect(z.array(FieldErrorSchema).safeParse(fields).success).toBe(true)
    for (const field of fields) {
      // Every code is one of ours, not one of zod's. A client switching on both
      // vocabularies has to know which layer produced the message.
      expect(ErrorCodeSchema.safeParse(field.code).success).toBe(true)
      expect(field.path).not.toBe('')
    }
  })
})

describe('validationFailed', () => {
  it('keeps the ZodError as the cause and off the client’s copy', () => {
    const result = z.object({ a: z.string() }).safeParse({})
    const zodError = (result as { error: z.ZodError }).error

    const error = validationFailed(zodError, 'query')

    // The cause is what the exception filter logs; the fields are what it sends.
    expect(error.cause).toBe(zodError)
    expect(error.code).toBe('validation_failed')
    expect(error.status).toBe(422)
  })

  it('exists so one response can describe several parts of a request', () => {
    // The reason it is exported separately from `parseRequest`: a handler parsing
    // params, query and body should not make the caller discover three failures in
    // three round trips.
    const query = z.object({ limit: z.number() }).safeParse({ limit: 'x' })
    const params = z.object({ id: z.string().uuid() }).safeParse({ id: 'nope' })

    const fields = [
      ...toFieldErrors((query as { error: z.ZodError }).error, 'query'),
      ...toFieldErrors((params as { error: z.ZodError }).error, 'params'),
    ]

    expect(fields.map((f) => f.path)).toEqual(['limit', 'id'])
  })
})
