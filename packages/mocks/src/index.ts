/**
 * ══════════════════════════════════════════════════════════════════════
 * @flux/mocks — deterministic fixtures derived from @flux/contracts.
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS FOR
 *
 * The UI is built before the API exists. That is a deliberate schedule
 * decision, not an accident of ordering: three agents work in parallel and
 * the UI agent must not sit idle waiting for the backend agent
 * (docs/handoff.md §6).
 *
 * The risk in doing that is obvious — a UI built against invented data is a
 * UI built against a guess, and the guess is discovered to be wrong at
 * integration time, which is the most expensive possible moment. This package
 * removes the guess: every fixture is `.parse()`d by the same zod schema the
 * API is required to return, so a fixture that would not survive the real
 * endpoint fails at the line that built it.
 *
 * The swap from mock to real is then a base-URL change.
 *
 * HOW TO USE IT
 *
 *   import { aBoardView, anIssueDetail, aVersionConflictError } from '@flux/mocks'
 *
 *   const view = aBoardView()                              // the full default
 *   const empty = aBoardView({ columns: [] })              // overridden
 *   const solo = anIssueDetail({ summary: 'One thing' })    // deep-merged
 *
 * Overrides are deep-partial and merge recursively; arrays replace whole
 * rather than merging by index (see builder.ts for why).
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * **MSW handlers.** They belong in `apps/web/src/test/`, owned by the UI
 * agent. They need a pinned MSW version, a browser worker and a node server
 * setup, and per-surface overrides — all app concerns. This package is frozen
 * to the UI agent, and a frozen package must never be the thing standing
 * between that agent and a new error case. Build handlers from `scenario` and
 * the builders below.
 *
 * **Randomness and wall-clock time.** Nothing here calls `Math.random()` or
 * `Date.now()`. See determinism.ts.
 *
 * **Any dependency beyond @flux/contracts and zod.** This is imported into
 * the browser bundle's test build and, eventually, into a worker's suite. It
 * must have no ambient requirements at all — no node types, no DOM types.
 */

export { DAY, HOUR, MINUTE, NOW, SECOND, id, instant, localDate, uuidFrom } from './determinism.js'
export { builder, type DeepPartial } from './builder.js'

export {
  ORG,
  PROJECT_LOG,
  PROJECT_WEB,
  TEAM_PLATFORM,
  USER_ADA,
  USER_GRACE,
  USER_LINUS,
  aBootstrap,
  aMemberBootstrap,
  anOrgMembership,
  anOrganization,
  aUser,
} from './tenancy.js'

export {
  BOARD,
  COLUMN_DOING,
  COLUMN_DONE,
  COLUMN_REVIEW,
  COLUMN_TODO,
  SPRINT_ACTIVE,
  SPRINT_NEXT,
  aBacklogView,
  aBoard,
  aBoardCard,
  aBoardView,
  aReadOnlyBoardView,
  aSprint,
  anEmptyBoardView,
  cardAt,
} from './board.js'

export {
  aDoneIssueDetail,
  aMinimalIssueDetail,
  aReadOnlyIssueDetail,
  aRichTextDoc,
  anIssue,
  anIssueDetail,
} from './issue.js'

export {
  UNKNOWN_CODE_NOTE,
  aBareInternalError,
  aConfirmationRequiredError,
  aNotFoundError,
  aPermissionDeniedError,
  aRateLimitedError,
  aValidationError,
  aVersionConflictError,
  anApiError,
  anInUseError,
} from './errors.js'

export { scenario } from './scenario.js'
