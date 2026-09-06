import { ZodError } from 'zod'
import type { ErrorCode } from '@flux/contracts'
import { isApiRequestError } from './request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * What a failure looks like on screen.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/product-quality-bar.md §13: never show "Something went wrong" when the
 * cause is known, and never put a raw backend error in front of a user. Both
 * halves of that are the same requirement — there has to be one place that turns
 * a contract error code into a sentence, or forty call sites each invent one and
 * the thirty-ninth is a `catch` block with a shrug in it.
 *
 * ### Two strings, and which one is which
 *
 * `ApiErrorSchema.message` is written by the server, is documented as safe to
 * display, and is the *specific* half: "The due date is before the start date",
 * "This will move 218 issues". The catalogue below is the *stable* half: a short
 * heading that is the same every time that code arrives, so the UI reads as one
 * product rather than as whatever the backend happened to phrase.
 *
 * So a dialog renders the catalogue's `title` as its heading and the server's
 * `message` underneath it. Neither replaces the other, and dropping the server's
 * sentence is how a rich `ApiErrorSchema` ends up rendered as a generic toast.
 *
 * ### `action` is not decoration
 *
 * docs/specs/web/README.md §7: every optional field on `ApiErrorSchema` exists so
 * a dialog can be *actionable* rather than merely accurate. The action is what an
 * error surface renders as its button, and it is why a `403` and a `409` do not
 * get the same dialog with a different sentence. It is deliberately a small
 * closed set: ten affordances the shell can actually offer, not one per code.
 *
 * `retryable` is **not** in the catalogue. It is derived from `RETRYABLE_CODES`
 * on `ApiRequestError`, because a second hand-maintained copy of that set is a
 * thing that can disagree with the contract — and the disagreement would be
 * invisible until a `validation_failed` got retried three times. The test file
 * asserts the two agree in both directions instead.
 *
 * ### Copy rules, so the next person writing a title matches this one
 *
 * Sentence case. No exclamation marks, no "Oops", no "Sorry". No trailing full
 * stop — these are headings, and the server's sentence below them has the
 * punctuation. Say what is true rather than how it feels: "Someone else changed
 * this" beats "Update failed". British spelling throughout, except
 * "organization", which is spelled the American way everywhere in this
 * repository because it is the domain term (`OrganizationSchema`,
 * `organizationId`) and one word cannot be spelled two ways.
 */

export type ErrorAction =
  /** Field-level errors are attached to inputs; the form stays open. */
  | 'fix-input'
  /** Re-read the server's state, then let the user decide again. */
  | 'reload'
  | 'sign-in'
  /** Wrong organization for this resource — offer the org switcher. */
  | 'switch-org'
  /** Nothing the user can do alone; name what an admin has to grant. */
  | 'ask-admin'
  /** Plan or billing limit. Show the price, not a shrug. */
  | 'billing'
  /** Retry, but only after `retryAfterSeconds`. Never a spinner that loops. */
  | 'wait'
  | 'retry'
  /** Genuinely ours. Show the trace id and make it copyable. */
  | 'support'
  /** Understanding it *is* the resolution. No button. */
  | 'none'

export interface ErrorPresentation {
  /** Heading. Short, stable per code, sentence case, no trailing stop. */
  title: string
  /** The server's own sentence, or `null` when `title` already carries it. */
  detail: string | null
  action: ErrorAction
  /** Copyable in the UI. `null` when the API never answered. */
  traceId: string | null
  /** From the error body or the `Retry-After` header. `null` when unstated. */
  retryAfterSeconds: number | null
}

interface CatalogueEntry {
  title: string
  action: ErrorAction
}

/**
 * Every code in `ErrorCodeSchema`, exhaustively.
 *
 * `Record<ErrorCode, …>` rather than `Partial<…>` with a fallback: adding a code
 * to the contract then fails to compile *here* until someone writes the copy for
 * it. That is the same trick `HTTP_STATUS_BY_CODE` uses in the contract, and it
 * is the only thing that stops a new code arriving in the UI as a blank dialog.
 */
export const ERROR_CATALOGUE: Record<ErrorCode, CatalogueEntry> = {
  // ── 400 — the request could not be parsed ──────────────────────────
  // flux built the request, so a 400 is this app misbehaving, not the user.
  // Saying so is more useful than blaming their input.
  malformed_query: { title: 'flux sent a request the server could not read', action: 'support' },
  invalid_cursor: { title: 'This page of results has expired', action: 'reload' },
  unsupported_field_type: { title: 'That field type is not supported here', action: 'support' },

  // ── 401 ────────────────────────────────────────────────────────────
  unauthenticated: { title: 'You are signed out', action: 'sign-in' },
  session_expired: { title: 'Your session has expired', action: 'sign-in' },

  // ── 403 ────────────────────────────────────────────────────────────
  // `requiredPermission` is on the body and §7 requires naming it. The heading
  // stays generic because the specific permission belongs in the detail line,
  // where it can be copied into a message to whoever grants it.
  permission_denied: { title: 'You do not have permission to do that', action: 'ask-admin' },
  org_access_denied: { title: 'You are not a member of that organization', action: 'switch-org' },
  organization_suspended: { title: 'This organization is suspended', action: 'billing' },
  simulation_is_read_only: {
    title: 'Nothing can be changed while viewing as someone else',
    action: 'none',
  },

  // ── 404 ────────────────────────────────────────────────────────────
  // Missing, deleted and invisible-to-you are deliberately indistinguishable in
  // the contract, so the copy must not imply the thing exists.
  not_found: { title: 'We could not find that', action: 'reload' },

  // ── 409 — well-formed, but the current state forbids it ────────────
  // "Someone else changed this" and not "Update failed": the write did not fail,
  // it was refused because the user was looking at older data. §6 requires a real
  // choice here rather than a toast, and `currentVersion` is on the body for it.
  version_conflict: { title: 'Someone else changed this first', action: 'reload' },
  duplicate_key: { title: 'That name is already taken', action: 'fix-input' },
  // `blockedBy` and `blockedByTotal` are on the body — list them and say "and N
  // more" from the total, which is the whole reason one `in_use` replaced six
  // per-entity codes.
  in_use: { title: 'Something still uses this', action: 'none' },
  cannot_remove_last: { title: 'This is the last one, so it cannot be removed', action: 'none' },
  identifier_immutable: { title: 'This identifier cannot be changed', action: 'none' },
  seat_limit_reached: { title: 'There are no seats left on this plan', action: 'billing' },
  invalid_transition: { title: 'That move is not available from here', action: 'reload' },
  transition_condition_failed: { title: 'This move is blocked', action: 'none' },
  workflow_not_published: { title: 'This workflow has not been published yet', action: 'none' },
  workflow_not_draft: {
    title: 'This workflow is published, so it cannot be edited',
    action: 'none',
  },
  preview_required: { title: 'Preview this change before applying it', action: 'none' },
  sprint_already_active: { title: 'That sprint is already running', action: 'reload' },
  sprint_not_active: { title: 'That sprint is not running', action: 'reload' },
  // Not 'wait': the contract deliberately keeps this out of RETRYABLE_CODES
  // because the other job is hours away and an automatic retry loop is not how a
  // person should wait for it.
  import_already_running: { title: 'An import is already running', action: 'none' },
  import_has_unresolved_blockers: {
    title: 'This import has problems that need resolving first',
    action: 'fix-input',
  },
  idempotency_key_reused: {
    title: 'flux reused a request key with different details',
    action: 'support',
  },

  // ── 422 — parseable, but not processable ───────────────────────────
  // `fields[]` carries every failure, and §7 requires attaching each one to its
  // input by `path` — including custom-field keys. A form-level "invalid input"
  // is the failure mode this whole family exists to prevent.
  validation_failed: { title: 'Some fields need attention', action: 'fix-input' },
  required_field_missing: { title: 'Something required is missing', action: 'fix-input' },
  field_value_invalid: { title: 'A value is not valid', action: 'fix-input' },
  unknown_field: { title: 'That field is not on this form', action: 'support' },
  field_not_writable: { title: 'That field cannot be edited', action: 'none' },
  invalid_reference: { title: 'That choice does not belong here', action: 'fix-input' },
  circular_dependency: { title: 'That would create a loop', action: 'fix-input' },
  hierarchy_violation: { title: 'That parent is not allowed for this type', action: 'fix-input' },
  transition_validator_failed: {
    title: 'Some fields are needed before this move',
    action: 'fix-input',
  },
  // The confirm dialog renders `confirmValue` — the server's computed number —
  // so nobody has to guess how many issues an operation will touch.
  confirmation_required: { title: 'Confirm before continuing', action: 'none' },
  workflow_invalid: { title: 'This workflow is not valid yet', action: 'fix-input' },
  remapping_incomplete: { title: 'Some things still need mapping', action: 'fix-input' },
  unsupported_rule_node: {
    title: 'This rule uses something flux does not know',
    action: 'support',
  },
  filter_too_deep: { title: 'This filter is too complex to run', action: 'fix-input' },
  webhook_target_forbidden: { title: 'That address is not allowed', action: 'fix-input' },
  event_type_unknown: { title: 'That event type is not recognised', action: 'support' },

  // ── 429 ────────────────────────────────────────────────────────────
  rate_limited: { title: 'Too many requests', action: 'wait' },
  automation_loop_detected: { title: 'An automation rule is looping', action: 'ask-admin' },

  // ── 5xx ────────────────────────────────────────────────────────────
  // The one place a vague heading is honest: the cause genuinely is not known to
  // the client, and the trace id is what makes it knowable to someone.
  internal_error: { title: 'Something failed on our side', action: 'retry' },
  audit_chain_broken: { title: 'The audit log could not be verified', action: 'support' },
  dependency_unavailable: { title: 'A service flux needs is not answering', action: 'retry' },
  // Not retryable in the contract, and correctly so — search fell back to a
  // slower path and returned real results, so this is a notice, not a failure.
  search_degraded: { title: 'Search is running in a reduced mode', action: 'none' },
}

/**
 * The button an error surface offers, so four components do not invent four
 * labels for the same affordance. `null` means render no button.
 */
export const ACTION_LABEL: Record<ErrorAction, string | null> = {
  'fix-input': null,
  reload: 'Reload',
  'sign-in': 'Sign in',
  'switch-org': 'Switch organization',
  'ask-admin': null,
  billing: 'View plans',
  wait: 'Try again',
  retry: 'Try again',
  support: 'Contact support',
  none: null,
}

/**
 * Turn anything that was thrown into something a surface can render.
 *
 * Takes `unknown` rather than `ApiRequestError` on purpose: a `catch` block and a
 * React error boundary both receive `unknown`, and a function that only accepted
 * the happy type would leave every caller writing its own fallback — which is
 * where "Something went wrong" gets written. Three non-API cases are reachable
 * and none of them may say that:
 *
 * - **An unrecognised code.** The server is newer than this build.
 *   `@flux/mocks` `UNKNOWN_CODE_NOTE` says this is reachable in production and is
 *   not constructible in a fixture. The server's own sentence *is* the title
 *   here, because it is the only description of the cause that exists — and it is
 *   documented as safe to display.
 * - **A contract parse failure.** `.parse()` threw, so the API answered
 *   successfully with a payload that does not match the schema. That is a real
 *   defect and its user-facing story has to be designed too, or §3's parse
 *   boundary shows up on screen as a white page.
 * - **Anything else.** A genuine bug. The raw `message` is deliberately dropped:
 *   "Cannot read properties of undefined" is internal detail, which §13 forbids
 *   putting in front of a user. It belongs in the console and the error boundary.
 */
export function describeError(error: unknown): ErrorPresentation {
  if (isApiRequestError(error)) {
    const retryAfterSeconds = error.detail.retryAfterSeconds ?? null

    if (error.knownCode === null) {
      return {
        title: error.detail.message,
        detail: null,
        action: 'support',
        traceId: error.detail.traceId,
        retryAfterSeconds,
      }
    }

    const entry = ERROR_CATALOGUE[error.knownCode]
    return {
      title: entry.title,
      // Suppressed when the server merely restated the heading, which happens
      // whenever `FluxError`'s own default message is close to the catalogue's.
      // Two near-identical sentences stacked in a dialog read as a bug.
      detail: sameSentence(entry.title, error.detail.message) ? null : error.detail.message,
      action: entry.action,
      traceId: error.detail.traceId,
      retryAfterSeconds,
    }
  }

  if (error instanceof ZodError) {
    return {
      title: 'flux received data it did not understand',
      detail: 'The server answered, but not in a shape this version of flux can read.',
      action: 'support',
      traceId: null,
      retryAfterSeconds: null,
    }
  }

  return {
    title: 'Something failed unexpectedly',
    detail: null,
    action: 'support',
    traceId: null,
    retryAfterSeconds: null,
  }
}

/** Same words, ignoring case and a trailing full stop. */
function sameSentence(a: string, b: string): boolean {
  return normalise(a) === normalise(b)
}

function normalise(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase()
}
