import { ApiErrorSchema, type ApiError } from '@flux/contracts'
import { builder } from './builder.js'
import { id } from './determinism.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Error fixtures.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `ApiErrorSchema` carries eight optional fields, and each exists so a
 * dialog can be *actionable* rather than merely accurate. They are also, as
 * optionals, exactly the fields a UI built against a generic
 * `{ code, message }` error never renders — which is how a product ends up
 * with "Something went wrong. Please try again." on a conflict it could have
 * shown a diff for.
 *
 * So there is a named fixture per interesting code, populated with the
 * fields that code actually returns. A surface spec's DoD says "every error
 * this endpoint can return is rendered"; these are what it renders against.
 *
 * The `traceId` is stable rather than random, so a test can assert it is on
 * screen and copyable. In production it is a real trace id and is the single
 * thing that turns a support conversation into one message.
 */
const TRACE = '4b1f9d2c8e7a4f10b93c6d5e2a8f0c71'

export const anApiError = builder(ApiErrorSchema, () => ({
  code: 'internal_error',
  message: 'Something went wrong on our side.',
  traceId: TRACE,
}))

/**
 * A form rejection with per-field detail, including a custom field.
 *
 * `path` on the third entry is a custom field key, not a body path. The UI
 * must attach it to the right input either way — a form that only knows how
 * to map built-in paths silently drops validation on the fields a tenant
 * added itself, which is most of the fields on a mature project.
 */
export function aValidationError(): ApiError {
  return anApiError({
    code: 'validation_failed',
    message: 'Some fields need attention.',
    fields: [
      { path: 'summary', code: 'too_long', message: 'Keep the summary under 255 characters.' },
      { path: 'dueDate', code: 'before_start', message: 'The due date is before the start date.' },
      {
        path: 'customFields.severity',
        code: 'not_an_option',
        message: '"catastrophic" is not one of the configured options.',
      },
    ],
  })
}

/**
 * The conflict. `currentVersion` is what lets the dialog show a real choice.
 *
 * A `version_conflict` handled as a toast loses whatever the user had typed,
 * which is the most infuriating failure an issue tracker has. Render the
 * difference and let them pick.
 */
export function aVersionConflictError(currentVersion = 7): ApiError {
  return anApiError({
    code: 'version_conflict',
    message: 'This item changed since you loaded it.',
    currentVersion,
  })
}

export function aPermissionDeniedError(): ApiError {
  return anApiError({
    code: 'permission_denied',
    message: 'You do not have permission to do that.',
    /** Safe to disclose, and it turns an opaque 403 into an admin's to-do. */
    requiredPermission: 'issue.transition',
  })
}

/**
 * `blockedBy` truncated with a larger `blockedByTotal` — the case the field
 * pair exists for. A field used by 40,000 issues must not put 40,000 rows in
 * an error body, so the UI has to render "and N more" from the total rather
 * than from the array's length.
 */
export function anInUseError(): ApiError {
  return anApiError({
    code: 'in_use',
    message: 'That field is still in use.',
    blockedBy: [
      { type: 'issue', id: id('issue', 101), label: 'LOG-101' },
      { type: 'issue', id: id('issue', 103), label: 'LOG-103' },
      { type: 'saved_view', id: id('savedView', 'escalations'), label: 'Escalations' },
    ],
    blockedByTotal: 218,
  })
}

/**
 * `confirmValue` is the server's computed number. The dialog shows it rather
 * than asking the user to guess how many issues a bulk operation will touch.
 */
export function aConfirmationRequiredError(): ApiError {
  return anApiError({
    code: 'confirmation_required',
    message: 'This will move 218 issues. Confirm to continue.',
    confirmField: 'acknowledgeIssueCount',
    confirmValue: 218,
  })
}

/** Retryable, and the UI must wait rather than spin. */
export function aRateLimitedError(): ApiError {
  return anApiError({
    code: 'rate_limited',
    message: 'Too many requests. Try again shortly.',
    retryAfterSeconds: 30,
  })
}

export function aNotFoundError(): ApiError {
  return anApiError({ code: 'not_found', message: 'LOG-999 was not found.' })
}

/**
 * A code with no optional fields at all — the plain shape.
 *
 * Kept as a distinct fixture because "renders when the optionals are absent"
 * is a separate assertion from "renders when they are present", and a
 * component that reads `error.fields.map(...)` passes every test above and
 * throws on this one.
 */
export function aBareInternalError(): ApiError {
  return anApiError()
}

/**
 * An error whose `code` is not in `ErrorCodeSchema` — impossible to build
 * here, and therefore worth stating: **a real client will eventually receive
 * one**, because the server can be newer than the app it is serving.
 *
 * The UI must render `message` and `traceId` and not crash. There is no
 * fixture for it because `ApiErrorSchema.parse()` would reject it, which is
 * the correct behaviour for a fixture builder; test that path by handing
 * your error component an unrecognised code directly.
 */
export const UNKNOWN_CODE_NOTE =
  'See the comment above this constant: unknown codes are reachable in production, ' +
  'not constructible here.'

export type { ApiError }
