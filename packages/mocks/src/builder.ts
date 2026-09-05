import type { z } from 'zod'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The builder factory.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every fixture in this package is produced by `builder(Schema, defaults)`,
 * which does two things and no more: deep-merge the caller's overrides onto
 * the defaults, then `.parse()` the result.
 *
 * The `.parse()` is the entire point of the package.
 *
 * A hand-written fixture object is a *claim* that the API returns that
 * shape, and nothing checks it. The claim then rots in the specific way that
 * costs the most: the contract gains a required field, twenty fixtures do
 * not, and every test still passes — until the UI is wired to the real API
 * and every one of them was wrong. Parsing at construction converts that
 * silent, deferred, twenty-file failure into a loud one at the line that
 * built the fixture.
 *
 * It also means the mock layer cannot be quietly used to design around the
 * contract. A fixture that needs a field the contract does not have will not
 * construct, which is the moment to write a change request rather than the
 * moment to invent a shape the API will never return.
 */

/**
 * Recursive partial, with two deliberate departures from the obvious
 * definition.
 *
 * **Arrays are replaced whole, never merged element-wise.** Merging by index
 * is almost never the intent: `aBoardView({ columns: [{ cards: [] }] })`
 * means "a board with one empty column", not "the default board's first
 * column emptied and its other two kept". Index-wise merging also makes
 * "give me fewer items than the default" unexpressible.
 *
 * **Primitives pass through untouched**, checked *before* the object case.
 * Branded ids are `string & { __brand }`, so an intersection that would
 * otherwise match `T extends object` and become `{ __brand?: ... }` —
 * a type no caller can satisfy.
 */
export type DeepPartial<T> = T extends readonly (infer _U)[]
  ? T
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Merge `override` onto `base`.
 *
 * Untyped internally on purpose: a recursive merge over an arbitrary schema
 * shape cannot be expressed to the compiler's satisfaction without either
 * `any` at every recursion or a cast at the boundary. One cast, in one
 * place, guarded by the `.parse()` the caller runs immediately afterwards,
 * is the better trade — the runtime check is stronger than the type would
 * have been.
 */
function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(override)) return override

  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    /**
     * An explicit `undefined` DELETES the key rather than being ignored, and
     * rather than setting it to `undefined`.
     *
     * All three behaviours are defensible and only one is useful. Under
     * `exactOptionalPropertyTypes`, `{ retryAfterSeconds: undefined }` is not
     * the same value as `{}` — and the fixture a UI needs for "this error
     * arrived without the optional field" is the second one. Setting the key
     * to `undefined` leaves it present under `in` and `Object.keys`, so a
     * component that branches on `'retryAfterSeconds' in error` would see the
     * field it was meant to be missing.
     *
     * That was the original behaviour here, and this comment claimed
     * otherwise until a test disagreed.
     */
    if (override[key] === undefined) {
      delete out[key]
      continue
    }
    out[key] = merge(base[key], override[key])
  }
  return out
}

/**
 * `defaults` is a function, not an object, so each call gets fresh arrays
 * and nested objects. A shared default object would let one test's
 * `fixture.columns.push(...)` mutate the next test's fixture, which is the
 * classic shared-fixture bug and is invisible until tests run in a
 * different order.
 */
export function builder<S extends z.ZodType>(
  schema: S,
  defaults: () => unknown,
): (override?: DeepPartial<z.output<S>>) => z.output<S> {
  return (override?: DeepPartial<z.output<S>>): z.output<S> => {
    const merged = merge(defaults(), override)
    const result = schema.safeParse(merged)
    if (!result.success) {
      /**
       * The zod issue list, not just its message. When a fixture stops
       * matching the contract, the useful information is *which path* —
       * `columns[0].stateFamilyIds: expected array` tells you what to fix,
       * `Invalid input` does not, and this error is the package's only
       * user-facing failure mode.
       */
      throw new Error(
        `@flux/mocks: fixture does not satisfy its contract schema.\n` +
          result.error.issues
            .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n') +
          `\n\nThe contract moved and this fixture did not. Fix the builder in ` +
          `packages/mocks/src/ — do not loosen the schema.`,
      )
    }
    return result.data
  }
}
