import {
  CreateIssueSchema,
  IssueDetailSchema,
  TransitionIssueSchema,
  UpdateIssueSchema,
  type IssueDetail,
} from '@flux/contracts'
import type { z } from 'zod'
import { request } from './request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Issue endpoints.
 * ══════════════════════════════════════════════════════════════════════
 *
 * One exported function per endpoint in docs/specs/api/issues.md, each parsing
 * its request on the way out and its response on the way in. No barrel: a caller
 * imports `getIssue` from `../api/issues`, so the import graph shows which
 * screen depends on which endpoint instead of every screen depending on all of
 * them.
 *
 * ### Inputs are `z.input<…>`, not `z.infer<…>`
 *
 * `CreateIssueSchema` gives `labels`, `componentIds`, `fixVersionIds` and
 * `customFields` a `.default()`. `z.infer` is the type *after* those defaults
 * run, so it demands all four — which would make a create form spell out
 * `labels: []` and `customFields: {}` to satisfy a schema whose entire point is
 * that it fills them in. `z.input` is the shape a caller actually supplies, and
 * `.parse()` below produces the other one.
 *
 * ### `undefined` versus `null` on a PATCH, and why it survives the round trip
 *
 * `UpdateIssueSchema`'s header states the rule: `undefined` means leave alone,
 * `null` means clear. Both must reach the wire distinguishably or "unassign this
 * issue" becomes unexpressible.
 *
 * It works, and it is worth writing down *why* because nothing in the code says
 * so: zod keeps a present-but-`undefined` optional key in its output, and
 * `JSON.stringify` then drops exactly those keys and keeps the `null`s. So
 * `{ assigneeId: undefined }` serialises to `{}` — leave alone — and
 * `{ assigneeId: null }` serialises to `{"assigneeId":null}` — clear. Anything
 * that replaces `JSON.stringify` in `request()` has to preserve that, and any
 * hand-built "strip empty values" helper breaks unassign.
 *
 * ### What is deliberately not here
 *
 * `POST /issues/:key/rank`, `POST /issues/:key/move`,
 * `GET /issues/:key/move-preview` and `POST /issues/bulk` are missing on
 * purpose. Rank returns "the new rank" with no schema for it, move has no
 * request schema at all, and bulk returns a job id with none either. The rule is
 * to import the contract type and never hand-write an interface that mirrors
 * one, so writing them now would mean inventing three response shapes that the
 * contract would later contradict. They are filed in
 * docs/change-requests/002-issue-command-contract-gaps.md instead.
 */

/** `CreateIssueSchema` as a caller supplies it — before zod applies defaults. */
export type CreateIssueInput = z.input<typeof CreateIssueSchema>
export type UpdateIssueInput = z.input<typeof UpdateIssueSchema>
/**
 * `TransitionIssueSchema` has no exported type in the contract — see the change
 * request. Derived here rather than hand-written, so it cannot drift.
 */
export type TransitionIssueInput = z.input<typeof TransitionIssueSchema>

/**
 * `GET /issues/:key` — the whole issue view in one round trip.
 *
 * `IssueDetailSchema` is deliberately fatter than the row: status name, both
 * users, `availableTransitions`, `links`, the counts, and the caller's resolved
 * `permissions`. docs/specs/api/issues.md §6 budgets it at 120ms and its DoD
 * asserts a query count, so a screen that needs a transition list must read it
 * from here rather than issuing a second request for it.
 */
export async function getIssue(key: string, signal?: AbortSignal): Promise<IssueDetail> {
  return IssueDetailSchema.parse(await request('GET', `/issues/${encodeIssueKey(key)}`, { signal }))
}

/**
 * `POST /projects/:projectKey/issues` → `201`.
 *
 * The project appears twice — as the URL's `projectKey` and as the body's
 * `projectId` — and that is the contract, not an oversight to normalise away
 * here. The path is what makes the URL readable and what §1 step 1 resolves and
 * 404s on; the body id is what the insert uses. Callers hold both: bootstrap
 * returns permission-filtered projects with `id` and `key` on each.
 *
 * `input.idempotencyKey` must have been minted when the user's *intention*
 * began — see ./idempotency.ts. Calling `newIdempotencyKey()` here would defeat
 * the entire mechanism, because a retry would arrive with a fresh key and create
 * a second issue.
 */
export async function createIssue(
  projectKey: string,
  input: CreateIssueInput,
): Promise<IssueDetail> {
  return IssueDetailSchema.parse(
    await request('POST', `/projects/${encodeURIComponent(projectKey)}/issues`, {
      body: CreateIssueSchema.parse(input),
    }),
  )
}

/**
 * `PATCH /issues/:key`.
 *
 * `version` is required by the schema, so optimistic concurrency is not opt-in:
 * a caller cannot forget it and silently start overwriting other people's edits.
 * A stale version comes back `409 version_conflict` carrying `currentVersion`,
 * which docs/specs/web/README.md §6 requires be turned into a real choice for
 * the user rather than a toast.
 */
export async function updateIssue(key: string, input: UpdateIssueInput): Promise<IssueDetail> {
  return IssueDetailSchema.parse(
    await request('PATCH', `/issues/${encodeIssueKey(key)}`, {
      body: UpdateIssueSchema.parse(input),
    }),
  )
}

/**
 * `POST /issues/:key/transitions`.
 *
 * The only way status changes. A board drag calls this rather than PATCHing a
 * status, because §3 of the boards spec is explicit that setting `status_id`
 * directly bypasses conditions, validators and post-functions and turns the
 * board into a hole in the workflow.
 *
 * `fields` carries what the transition dialog collected: a validator can require
 * a resolution or an estimate before the move is allowed, and those values have
 * nowhere else to travel.
 */
export async function transitionIssue(
  key: string,
  input: TransitionIssueInput,
): Promise<IssueDetail> {
  return IssueDetailSchema.parse(
    await request('POST', `/issues/${encodeIssueKey(key)}/transitions`, {
      body: TransitionIssueSchema.parse(input),
    }),
  )
}

/**
 * Issue keys are `[A-Z][A-Z0-9]{1,9}-\d+` per `IssueKeySchema`, so nothing in a
 * valid one needs escaping. Encoded anyway: the value routinely arrives from a
 * route param or a pasted link, and a malformed one has to produce a clean
 * `404` from the API rather than a path that means something else. `#` in a
 * segment would otherwise truncate the URL client-side and request the wrong
 * resource entirely.
 */
function encodeIssueKey(key: string): string {
  return encodeURIComponent(key)
}
