# Spec — issues

Read [README.md](README.md) first. Nothing in it is repeated here.

This is the hottest module in the product. Every performance claim the business
rests on is a claim about this file's code path, so the budgets below are
requirements, not aspirations.

| | |
| --- | --- |
| **Branch** | `feat/api-issues` |
| **Tables** | `issues`, `issue_links`, `comments`, `attachments`, `worklogs`, `issue_watchers`, `issue_history_events` |
| **Migrations** | `0006_issues.sql`, `0009_events_audit.sql` |
| **Contracts** | `packages/contracts/src/issue.ts` |
| **Depends on** | `permissions`, `workflows`, `fields`, `projects`, `events` |

## Performance budgets

| Operation | p95 | Why it is that number |
| --- | --- | --- |
| `POST /issues` | **150ms** | The pitch is that it feels instant. Above ~200ms a create feels like a form submission rather than a keystroke. |
| `PATCH /issues/:key` | **150ms** | Same, and inline edits happen far more often than creates. |
| `POST /issues/:key/transitions` | **150ms** | Drag-to-transition on a board must land before the card settles. |
| `GET /issues/:key` (detail) | **120ms** | Includes comments page 1, links, history page 1, resolved permissions. |
| `POST /issues/:key/rank` | **80ms** | One-row UPDATE. Anything slower means the rank strategy was implemented wrong. |
| Bulk update, 500 issues | async | Never synchronous. Returns a job id. |

These are achievable only because nothing optional happens inline. If a budget is
missed, the fix is almost always "something is being done synchronously that
should be an event", not "add an index".

---

## 1. Create — `POST /projects/:projectKey/issues`

Request `CreateIssueSchema`. Response `IssueDetail`. `201`.

**`idempotencyKey` is required.** A create that retries after a network timeout
must return the original issue, not a second one. Store the key and return the
original response on a repeat — see §8.

Order inside one transaction:

1. Resolve the project by key. `404 project_not_found` if missing or archived.
2. `evaluatePermission(subject, grants, 'issue.create')` with the project context.
   `403 permission_denied`.
3. Validate the issue type belongs to this project. `422 invalid_issue_type`.
4. If `parentId` is set:
   - load the parent, `404 parent_not_found`;
   - the parent must be in the same project — cross-project parenting is a
     change request, not a silent allow;
   - `canBeChildOf(childLevel, parentLevel)` must be true, or
     `422 invalid_hierarchy`. Exactly one level, both directions. A subtask
     hanging directly off an initiative is what makes every roll-up total
     ambiguous, which is why "any level below" is not good enough.
5. Resolve the initial workflow state from the project's **published** workflow
   for that issue type. Never a draft. Set `workflow_id` to that version's id so
   this issue is pinned to the version it was created under.
6. Validate custom fields against the project's field layout:
   - required fields present → `422 required_field_missing` (name every missing
     field in the error, all of them, not just the first — a form that reveals
     one error at a time is the thing users hate about Jira);
   - each value against `valueSchemaFor(fieldDefinition)` →
     `422 invalid_field_value`;
   - unknown keys rejected, not silently dropped.
7. Allocate `number` with `flux_next_issue_number(project_id)` and build `key` as
   `<PROJECT_KEY>-<number>`. Use that function — do not reimplement it. It takes
   a row lock on `project_issue_counters`, which is what makes concurrent creates
   safe. A `SELECT max(number) + 1` is wrong under concurrency, and the unique
   index on `(project_id, number)` means it surfaces as a sporadic 500 under load
   rather than as a visible bug in testing.

   Note that a rolled-back create still consumes the number. That is deliberate:
   gaps in issue numbers are acceptable, duplicate keys are not.
8. Compute `rank`: `rank.rankAfter(lastRankInBacklog)` for the project's backlog,
   or `rank.INITIAL_RANK` for the first issue.
9. Generate the id with `newId<'IssueId'>()` (UUIDv7 — time-ordered, which is what
   makes cursor pagination and the time-range indexes work). Never
   `crypto.randomUUID()`.
10. INSERT. Do **not** set `status_category`: a trigger derives it from
    `status_id`, and it will override you. Correctly.
11. Insert an `issue_history_events` row: `changes = [{ field: 'created', ... }]`.
12. Add watchers: reporter always, assignee if set.
13. `flux_emit_event(newId(), 'issue.created', 'issue', <id>, <payload>)`.
14. COMMIT.

Then return. Indexing, notification, and automation all happen from the event.

## 2. Update — `PATCH /issues/:key`

Request `UpdateIssueSchema`. Response `IssueDetail`.

- `version` is required. Mismatch → `409 version_conflict`, and the response body
  carries the current server state so the client can show a real diff rather than
  "someone else edited this, your changes are gone".
- Only fields present in the body change. Distinguish "absent" from "explicitly
  null" — `assigneeId: null` unassigns, and an absent `assigneeId` must not.
  Getting this wrong silently wipes fields, and it is the single most common bug
  in this kind of endpoint.
- `statusId` is **not** updatable here. Status changes go through the transition
  endpoint, because that is where conditions, validators, and post-functions live.
  Allowing status through the generic update is a back door around the workflow.
- Permission: `issue.edit`, with the full `IssueContext` so relative grants work.
- Reparenting revalidates `canBeChildOf` **and** `wouldCreateCycle`. A cycle in
  the hierarchy makes every roll-up query non-terminating.
- Custom fields: partial merge into the existing `custom_fields` jsonb, validated
  as in create. A field set to `null` is cleared; an absent field is untouched.
- Write **one** `issue_history_events` row containing every changed field, not one
  row per field. The activity feed shows "Alice changed status, assignee and
  priority" as one entry because that is what happened.
- Emit `issue.updated` with `changedFields` listing the keys that actually
  changed — a consumer must be able to skip an event that did not touch anything
  it cares about, without loading the issue.

If nothing actually changed, still return 200 with the current state, but do not
write history and do not emit an event. A no-op edit that generates a
notification trains people to ignore notifications.

## 3. Transition — `POST /issues/:key/transitions`

Request `TransitionIssueSchema`. Response `IssueDetail`.

1. Load the issue and the workflow version it is pinned to (`workflow_id`).
2. Find the transition. It is valid if `fromStateId` matches the current status
   **or** `fromStateId IS NULL` (a global transition, valid from anywhere).
   Missing → `422 invalid_transition`.
3. Permission: `issue.transition`, plus any per-transition permission condition.
4. Evaluate the transition's **conditions**. Any false → `403 transition_blocked`,
   with the failing condition named. "You can't do that" without a reason is the
   Jira experience being replaced.
5. Evaluate **validators** against the merged post-transition state. Failure →
   `422 transition_validation_failed`, listing every failure.
6. Apply the new `status_id`. The trigger updates `status_category`.
7. Run **post-functions** in declared order, inside the same transaction. They are
   declarative ASTs, not code — evaluate them, never `eval` them.
8. If the target state's category is `done`, set `resolved_at` and require a
   `resolution` if the workflow demands one. If moving *out* of `done`, clear
   `resolved_at` and `resolution` — a reopened issue that keeps its resolution
   date corrupts every cycle-time metric downstream.
9. History row with `from`/`to` status. Cycle-time analytics replays these, so a
   missing row is a permanently wrong metric.
10. Emit `issue.transitioned` with `fromStateId`, `toStateId`, and both categories.

SLA pause/resume is driven off the event, not inline.

## 4. Rank — `POST /issues/:key/rank`

Request `RankIssueSchema` (`beforeId` / `afterId`). Response the new rank.

- Compute with `rank.between(beforeRank, afterRank)`, `rankBefore`, or `rankAfter`.
- **One** UPDATE, one row. If the implementation ever renumbers siblings, it is
  wrong — that is the whole reason ranks are sparse base-36 strings.
- Ranks are opaque. Never parse them, never compare them numerically, never
  generate one client-side.
- When `rank.needsRebalance(newRank)` is true, emit `issue.rank_rebalance_needed`
  and let a background job handle it. Never rebalance inline: it is an unbounded
  write and this endpoint has an 80ms budget.
- Concurrent drags to the same slot can produce equal ranks. That is acceptable and
  must not error — resolve ties by `created_at`, and let the next drag separate
  them.

## 5. Read — `GET /issues/:key`

Response `IssueDetail`.

One round trip for the whole screen. The detail view is the most-visited page in
the product and it must not be built from six requests.

Include: the issue, resolved reporter/assignee `UserRef`s, issue type, status and
its category, components, fix versions, labels, custom field values *with* their
definitions (the client cannot render a field it has no definition for), links
grouped by type with the linked issues' minimal shape, comment page 1, history
page 1, attachment metadata, watcher state for the caller, and the caller's
resolved permissions for this issue.

That last one matters: the UI must not guess what to disable. Return the answers
from `evaluatePermissions()` so the buttons the user cannot use are not rendered
as enabled-then-rejected.

Batch the lookups. A detail view that issues one query per linked issue is an N+1
that only shows up on the issues that matter most.

## 6. Comments, links, worklogs, attachments, watchers

- **Comments** — `comments` has a `version` trigger, so edits take a version.
  Internal comments (`comment.view_internal`) must be filtered in the **query**,
  not in the serialiser. A filter applied after fetching is one refactor away from
  leaking.
- **Links** — `issue_links`; an `AFTER INSERT OR DELETE` trigger maintains
  `issues.blocked_by_count`. Never write that column by hand. Reject self-links
  and duplicate pairs. `blocks` is directional; `relates_to` is symmetric and must
  not be stored twice.
- **Worklogs** — inserting adjusts `time_spent_s` and `remaining_estimate_s`.
  Never let `remaining_estimate_s` go negative.
- **Attachments** — the API issues a pre-signed upload URL and records metadata;
  bytes never pass through it. Validate declared content type against the
  extension, cap size per the org's plan, and treat the stored filename as
  untrusted on the way back out.
- **Watchers** — implicit for reporter and assignee, explicit otherwise. A user
  who unwatches must stay unwatched even if they are later assigned; store the
  explicit decision rather than deriving it.

## 7. Bulk update — `POST /issues/bulk`

Request `BulkUpdateIssuesSchema`. Returns `202` and a job id.

Never synchronous. Permission is evaluated **per issue** — a bulk operation is not
a permission bypass, and a user with edit rights on 40 of 50 selected issues gets
40 updated and 10 reported as denied. Partial success is the correct outcome and
must be reported per issue, not collapsed into one status.

## 8. Idempotency

`idempotency_keys (organization_id, key, request_hash, response_body, created_at)`,
unique on `(organization_id, key)`.

- On create, INSERT the key first, in the same transaction.
- Unique violation → the key was used. If `request_hash` matches, return the
  stored response with `200`. If it differs, `409 idempotency_key_reused` — the
  same key with a different body is a client bug and silently returning the old
  answer would hide it.
- Expire after 24 hours.

This table does not exist yet. It is a change request (`AGENTS.md` §2) — file it,
and implement creates without the replay path until the migration lands. Do not
add the migration yourself.

## 9. Errors

| Code | Status | When |
| --- | --- | --- |
| `issue_not_found` | 404 | Missing, soft-deleted, or invisible to the caller. Identical response for all three — a distinguishable 403 tells an attacker the issue exists. |
| `permission_denied` | 403 | Evaluator returned false. |
| `version_conflict` | 409 | Optimistic concurrency. Body carries current state. |
| `invalid_transition` | 422 | No such transition from the current state. |
| `transition_blocked` | 403 | A condition failed. Name it. |
| `transition_validation_failed` | 422 | Validators failed. List all. |
| `invalid_hierarchy` | 422 | `canBeChildOf` false, or a cycle. |
| `required_field_missing` | 422 | List every missing field. |
| `invalid_field_value` | 422 | Field key plus the reason. |
| `idempotency_key_reused` | 409 | Same key, different body. |

## 10. Events emitted

`issue.created`, `issue.updated`, `issue.transitioned`, `issue.assigned`,
`issue.deleted`, `issue.restored`, `issue.ranked`, `issue.linked`,
`issue.unlinked`, `comment.created`, `comment.updated`, `comment.deleted`,
`worklog.created`, `attachment.added`.

All via `flux_emit_event(...)` inside the write transaction. Payload shapes are in
`packages/contracts/src/events.ts` — match them exactly; a consumer parses them
with the same schema.

## 11. Delete

Soft only. Set `deleted_at` / `deleted_by`, never `DELETE`. Audit and the
revert-from-audit path both need the row to survive. Hard deletion is a retention
job's responsibility, not an endpoint's.

Deleting a parent must not orphan children silently: either block with
`422 has_children` or reparent explicitly on request. Choose the block by default.

---

## Definition of done

Tick every line in the PR description. The review agent checks the code against
this list, so an unticked box means the module cannot be reviewed.

- [ ] Every endpoint validates with its zod schema from `@flux/contracts`
- [ ] Every write is one transaction, with `flux_emit_event` inside it
- [ ] No side effect (index, notify, webhook, automation, email) runs inline
- [ ] `evaluatePermission` is the only permission check; `IssueContext` passed for issue-scoped calls
- [ ] `version` enforced on update; 409 body carries current server state
- [ ] Absent vs explicitly-null distinguished on every optional field, with a test
- [ ] `status_category` never written from application code
- [ ] `blocked_by_count` never written from application code
- [ ] Rank changes are a single-row UPDATE; rebalance is deferred to an event
- [ ] Issue numbers are allocated race-free, proven by a concurrent-create test
- [ ] `GET /issues/:key` is one round trip with no N+1, proven by a query count assertion
- [ ] Caller's resolved permissions returned in the detail payload
- [ ] Internal comments filtered in SQL, not in the serialiser
- [ ] History written once per user action, with all changed fields
- [ ] Reopening clears `resolved_at` and `resolution`
- [ ] Bulk operations evaluate permission per issue and report per-issue results
- [ ] Soft delete only; `issue_not_found` is indistinguishable from unauthorised
- [ ] Integration tests run against real Postgres via Testcontainers, not mocks
- [ ] A tenant-isolation test proves org A cannot read org B's issues through this module's endpoints
- [ ] A pooled-connection test proves tenant context does not leak between transactions
- [ ] p95 budgets in the table above are measured and met, with the numbers in the PR
