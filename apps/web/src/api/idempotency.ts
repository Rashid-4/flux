import { uuidv7 } from '@flux/contracts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Idempotency keys, and the one rule about where they are generated.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `CreateIssueSchema.idempotencyKey` is **required**, not optional
 * (docs/specs/api/issues.md §1). The contract's own comment says why: making it
 * mandatory is what makes duplicate-on-retry structurally impossible instead of
 * dependent on every client remembering to opt in.
 *
 * ### Mint it once per intention, never once per attempt
 *
 * This is the whole reason the helper is a separate function rather than a line
 * inside `createIssue`. A key generated inside the request function gets a *new*
 * value on every retry — and a retry is exactly the situation the key exists for.
 * The server would see two different keys, find no stored response for the
 * second, and create a second issue. The mechanism would then be worse than
 * useless: it would look implemented, cost a table, and still duplicate on the
 * one code path anybody cares about.
 *
 * So the key belongs to the user's *intention*. Generate it when the create form
 * opens or when the draft is first built, keep it in the draft, and send the same
 * value for every attempt — the network retry inside `request()`, the user
 * pressing the button twice, and TanStack Query's own retry all have to carry it.
 * Generate a new one only when the user starts a genuinely new create.
 *
 * ### Why UUIDv7 and not `crypto.randomUUID()`
 *
 * `eslint.config.mjs` bans `randomUUID` across `apps/` and says the reason in the
 * rule message: v4 is not time-ordered, and ids minted client-side during an
 * optimistic write land in the database. `idempotency_keys` is indexed on
 * `(organization_id, key)` and expires after 24 hours, so a time-ordered key
 * keeps the live rows in adjacent B-tree pages and makes the expiry sweep a range
 * scan rather than a full one.
 *
 * `uuidv7()` rather than `newId()`: an idempotency key is not an entity id and has
 * no brand to carry. `IdempotencyKeySchema` accepts 16–128 characters, and a UUID
 * string is 36.
 */
export function newIdempotencyKey(): string {
  return uuidv7()
}
