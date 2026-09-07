import {
  AttachmentPageSchema,
  CommentPageSchema,
  CreateIssueSchema,
  IssueDetailSchema,
  PageRequestSchema,
  TransitionIssueSchema,
  UpdateIssueSchema,
  type AttachmentPage,
  type CommentPage,
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
 *
 * The comment *mutations* are absent for a different and smaller reason. Their
 * shapes exist — `CreateCommentSchema` and `UpdateCommentSchema` are both in the
 * contract — so writing them would be honest, and they are still not here: a
 * composer that posts needs an optimistic entry, a rollback, a retry of a failed
 * post that must not double-post, and an invalidation of both the thread and the
 * issue's `commentCount`. That is a mutation layer, and this commit is the read
 * path. The panel's composer therefore renders, is disabled, and says why —
 * docs/product-quality-bar.md §13, which is explicit that a control saying why it
 * cannot is better than one that silently does nothing.
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
 * ══════════════════════════════════════════════════════════════════════
 * The issue's own lists.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `getIssue` above returns the *frame* of the screen — the fields, the status, the
 * transitions, the counts. These return what the counts count.
 * docs/specs/api/issues.md §7.1 specifies four such endpoints as one family with one
 * pagination convention, and this is that family's shape: shared options, one
 * `PageRequestSchema.parse` on the way out, a `pageSchema` on the way back.
 *
 * ### Two of the four, and the other two are not an oversight
 *
 * Comments and attachments are here because the peek panel and the issue page read
 * them. `GET /issues/:key/worklogs` and `GET /issues/:key/history` are specified in
 * the same table and are deliberately absent until the worklog panel and the
 * activity feed exist, for a reason narrower than the one above about rank and move:
 * `@flux/mocks` has no generator for a page of history entries, so a reader for it
 * could be written and could not be *tested*. An untested reader of a paged endpoint
 * is exactly where a pagination convention diverges quietly — a `page`/`per_page`
 * pair creeps in, and nothing fails until the API arrives. Both land in the commit
 * that builds their section, together with the fixture that proves them, and they
 * copy `pageQuery` below rather than inventing a second convention.
 *
 * ### Why one function per list and not a generic `getIssueList(kind)`
 *
 * A parameterised reader would return a union of page types, so every caller would
 * narrow it again by the same string it just passed in — a type-level round trip
 * that buys nothing. One function per endpoint returns exactly one shape, and the
 * import graph keeps saying which screen depends on which endpoint, which is why
 * this file has no barrel.
 *
 * `IssueListOptions` is shared because all four endpoints take `PageRequest` and
 * nothing else. If one later needs a filter of its own — `?since=` on history is the
 * plausible one — it gets its own options type at that point, rather than a member
 * here that three endpoints ignore.
 */
export interface IssueListOptions {
  /** Opaque cursor from the previous response's `nextCursor`. */
  cursor?: string | undefined
  /** 1–200 per `PageRequestSchema`; the four lists default to 50. */
  limit?: number | undefined
  signal?: AbortSignal | undefined
}

/**
 * `PageRequestSchema.parse` before the request, not after a 422.
 *
 * The same reasoning as `api/boards.ts`: an out-of-range `limit` throws here naming
 * the field, instead of spending a round trip to be told; and the default of 50 is
 * applied and *sent*, so the page size the component renders is the one it asked
 * for rather than whatever a server default happens to be on the day.
 */
function pageQuery(options: IssueListOptions): { cursor: string | undefined; limit: number } {
  const page = PageRequestSchema.parse({ cursor: options.cursor, limit: options.limit })
  return { cursor: page.cursor, limit: page.limit }
}

/**
 * `GET /issues/:key/comments` — the thread, oldest first.
 *
 * This is the one request the peek panel makes. Everything else the panel shows —
 * summary, status, assignee, priority, labels, the excerpt — is already on
 * `BoardCardSchema` and therefore already in the cache, so the panel paints
 * immediately and the thread fills in. §7.1's 90ms budget is written against that
 * fact: it is the *perceived* open time of the panel, not one request among several.
 *
 * Oldest first, which is the order a conversation is read in and the order that
 * makes `nextCursor` mean "older is above, newer is below" consistently. A newest-
 * first thread has to be reversed by every reader, and one that forgets renders the
 * argument backwards.
 */
export async function getIssueComments(
  key: string,
  options: IssueListOptions = {},
): Promise<CommentPage> {
  return CommentPageSchema.parse(
    await request('GET', `/issues/${encodeIssueKey(key)}/comments`, {
      query: pageQuery(options),
      signal: options.signal,
    }),
  )
}

/**
 * `GET /issues/:key/attachments` — ready files only.
 *
 * `AttachmentSchema` carries `downloadUrl` and not `storage_key`, and the URL is
 * presigned and minted per request. That has a consequence for callers rather than
 * only for the server: a `downloadUrl` held in the cache expires, so a stale page
 * of attachments produces a dead link rather than a 403 the user can understand.
 * Whatever renders these must therefore not cache them longer than the presign
 * window — which is why this is its own query key rather than a field on the issue,
 * whose `staleTime` is measured in minutes.
 */
export async function getIssueAttachments(
  key: string,
  options: IssueListOptions = {},
): Promise<AttachmentPage> {
  return AttachmentPageSchema.parse(
    await request('GET', `/issues/${encodeIssueKey(key)}/attachments`, {
      query: pageQuery(options),
      signal: options.signal,
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
