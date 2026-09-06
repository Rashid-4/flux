# CR-002 — Issue and board command contracts: missing response schemas, missing type exports, unnamed query parameters

| | |
| --- | --- |
| **Raised by** | UI agent — `apps/web/src/api/` foundation |
| **Status** | `open` |
| **Blocks** | `rank`, `move`, `move-preview` and `bulk` client functions. The seven fully-specified endpoints are implemented; those four are not. Nothing else on the UI foundation branch is blocked. |

## What I was implementing

`apps/web/src/api/` — the parse boundary required by
[docs/specs/web/README.md](../specs/web/README.md) §3: *"Every request goes
through `apps/web/src/api/`, and every response is parsed by its contract schema
before it reaches a component."*

That sentence is the constraint that produced this CR. A function in that
directory cannot exist without a schema on both sides of it, so an endpoint whose
response has no schema is not something I can write badly — it is something I
cannot write at all.

Seven endpoints were fully specified and are done: `GET /bootstrap`,
`GET /issues/:key`, `POST /projects/:projectKey/issues`, `PATCH /issues/:key`,
`POST /issues/:key/transitions`, `GET /boards/:id`, `GET /boards/:id/backlog`.

Six issues below, in the order they matter.

---

## 1. `POST /issues/:key/rank` has no response schema

### What the contract says today

`docs/specs/api/issues.md:148`

> Request `RankIssueSchema` (`beforeId` / `afterId`). Response the new rank.

```ts
// packages/contracts/src/issue.ts:224
export const RankIssueSchema = z
  .object({
    afterIssueId: IssueIdSchema.optional(),
    beforeIssueId: IssueIdSchema.optional(),
  })
  .refine((v) => v.afterIssueId !== undefined || v.beforeIssueId !== undefined, { … })
```

There is no `RankedIssueSchema`, no `RankResultSchema`, and no exported type for
the request either.

### Why that does not work

"the new rank" is prose, not a shape. It admits at least four wire formats — a
bare JSON string `"0|hzzzzz:"`, `{ rank }`, `{ rank, version }`, or the whole
updated `BoardCard` — and the client and the server have to pick the same one.
There is nothing in the repository that would catch them picking differently:
`tsc` cannot see across the wire, and `check:columns`/`check:enums` do not look
at response bodies.

`version` is the part that makes this a correctness problem rather than a style
one. [The web spec](../specs/web/README.md) §6 has every optimistic mutation write
into the cache and then reconcile with the server's answer. A board card carries
`version`, and a
rank UPDATE bumps the row. If the response is a bare rank string, the client's
cached card keeps its stale `version`, and the **next** edit to that card — an
inline summary change, a drag, an assignee change — sends the old version and
comes back `409 version_conflict`. The user then sees a conflict dialog for an
edit that had no conflict, one action after a drag that appeared to succeed. That
is precisely the class of bug that same section's rollback path exists to prevent,
and it would be introduced by the response shape rather than by the mutation code.

### Minimum change I need

```ts
export const RankResultSchema = z.object({
  issueId: IssueIdSchema,
  rank: z.string(),
  version: z.number().int(),
})
export type RankResult = z.infer<typeof RankResultSchema>
```

`rank` as an opaque string, per [issues.md](../specs/api/issues.md) §4's "Ranks are
opaque. Never parse them, never compare them numerically." `version` for the reason
above. `issueId` so a response can be matched to its request when two drags are in
flight.

`rebalanceNeeded: z.boolean()` would be a reasonable addition and I do not need
it — that same section handles `rank.needsRebalance` with a background job and an
event, and the client has nothing to do with the answer.

---

## 2. The rank field names in `issues.md` do not match `RankIssueSchema`

`docs/specs/api/issues.md:148` says `beforeId` / `afterId`. The schema at
`packages/contracts/src/issue.ts:226` says `afterIssueId` / `beforeIssueId`.

This is a `check:columns`-shaped drift — field names disagreeing across a
boundary — one layer up, where no machine check looks. It is worth fixing on its
own terms because of what a build agent does with it: the spec is what gets
implemented, so an agent reading the spec writes `{ beforeId }`, the schema strips both
unknown keys, `.refine()` then fails with *"Provide afterIssueId, beforeIssueId,
or both"* — and the message names fields the agent never typed. Cheap to fix now,
and confusing in exactly the way that costs an hour later.

**Minimum change:** correct the spec text to the schema's names. The schema is
the artefact code imports, so it wins.

---

## 3. `POST /issues/:key/move` has no request or response schema

### What the contract says today

`docs/specs/api/issues.md:162` specifies the operation in four detailed steps —
allocate a number in the target project, record the old key as an alias, remap
what does not exist in the target, move the children or refuse — and
`docs/specs/api/issues.md:195` adds `GET /issues/:key/move-preview` returning
*"the full remapping plan — what changes, what will be cleared, the new key, and
how many children come along"*.

There is no `MoveIssueSchema` and no `MovePreviewSchema` in
`packages/contracts/src/issue.ts`.

### Why that does not work

Step 3 says *"The caller supplies the mapping"* and the endpoint refuses an
incomplete one with `422 remapping_incomplete`, *"naming each unmapped item in
`fields[]`"*. The mapping is therefore a structured request body — issue type,
status, components, fix versions, and every custom field not in the target's
layout — and the client has to build it from the preview response. Both halves
need a shape, and the two must agree field-for-field or the preview's
`unmappedCustomFields` cannot be turned into the request's `customFieldMapping`.

The move dialog is also the screen where a guessed shape is most expensive.
Step 3's own words are *"Never drop a value silently — the data loss people
remember is a field that vanished without a message."* A preview whose response
shape the UI guessed wrong is a preview that under-reports what will be cleared,
which produces exactly the data loss the spec is written against.

### Minimum change I need

Nothing, for now — and I want to say that plainly rather than ask for a schema I
would be designing by inference from prose. [issues.md](../specs/api/issues.md) §5
step 2 already says the per-issue key alias table does not exist and the move must refuse with
`409 preview_required` until it lands, so the endpoint is not implementable
server-side either. The right sequence is: alias table, then `MoveIssueSchema` and
`MovePreviewSchema` designed together against the real remapping shape, then the
client.

I am recording it here so the gap is not rediscovered as a surprise when the move
screen is specced.

---

## 4. `POST /issues/bulk` returns "a job id" with no schema

### What the contract says today

`docs/specs/api/issues.md:245`

> Request `BulkUpdateIssuesSchema`. Returns `202` and a job id.

And, three lines later:

> Partial success is the correct outcome and must be reported per issue, not
> collapsed into one status.

### Why that does not work

The request has a schema (`packages/contracts/src/issue.ts:239`) and the response
does not. More importantly, the two sentences describe two different things and
only one of them has a contract: a job id is what `202` returns, but the per-issue
partial-success report is what the *UI* has to render, and there is no schema for
it anywhere — no job-status response, no per-issue outcome, no polling or
subscription endpoint named.

So the client cannot express the spec's own required outcome. "40 updated, 10
denied" needs a list of `{ issueId, outcome, code? }`, and the honest fallback
without one is a toast saying the bulk edit was submitted — which is
`docs/specs/api/issues.md`'s "collapsed into one status", the thing it forbids.

### Minimum change I need

Two schemas, and the transport for the second one named:

```ts
export const BulkJobAcceptedSchema = z.object({ jobId: z.string().uuid() })

export const BulkJobStatusSchema = z.object({
  jobId: z.string().uuid(),
  state: z.enum(['queued', 'running', 'completed', 'failed']),
  total: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  results: z.array(
    z.object({
      issueId: IssueIdSchema,
      issueKey: IssueKeySchema,
      outcome: z.enum(['updated', 'skipped', 'failed']),
      code: ErrorCodeSchema.nullable(),
      message: z.string().nullable(),
    }),
  ),
})
```

`code` as `ErrorCodeSchema` rather than a free string, so the 10 denied rows
render through the same `ERROR_CATALOGUE` as everything else in
`apps/web/src/api/errors.ts` instead of growing a second copy of the copy.

And a decision on how the client reads it: `GET /jobs/:id` polled, or an
`event_outbox` event the realtime channel delivers. Either is fine; not naming
one means the UI invents an endpoint that does not exist.

---

## 5. Five request schemas have no exported type

### What the contract says today

```ts
// packages/contracts/src/issue.ts
export const TransitionIssueSchema   = …   // :210 — no `export type TransitionIssue`
export const RankIssueSchema         = …   // :224 — no `export type RankIssue`
export const BulkUpdateIssuesSchema  = …   // :239 — no `export type BulkUpdateIssues`
export const CreateCommentSchema     = …   // :251 — no `export type CreateComment`
export const LinkIssueSchema         = …   // :258 — no `export type LinkIssue`
```

`CreateIssueSchema` and `UpdateIssueSchema` both do export theirs
(`packages/contracts/src/issue.ts:182`, `:208`), so the five above are an
omission rather than a policy.

### Why that does not work

The brief says *"Import the contract types; never hand-write an interface that
mirrors one."* With no exported type there are three options and the tempting one
is wrong: hand-write the interface — which is the drift the rule exists to
prevent, since a field added to the schema never reaches the copy — or reach
`z.infer<typeof TransitionIssueSchema>` in the app, or leave the parameter
`unknown` and let `.parse()` do it, which pushes the type error from the caller's
keyboard to runtime.

### Minimum change I need

Five lines:

```ts
export type TransitionIssue = z.infer<typeof TransitionIssueSchema>
export type RankIssue = z.infer<typeof RankIssueSchema>
export type BulkUpdateIssues = z.infer<typeof BulkUpdateIssuesSchema>
export type CreateComment = z.infer<typeof CreateCommentSchema>
export type LinkIssue = z.infer<typeof LinkIssueSchema>
```

One thing worth deciding rather than inheriting: for the three schemas carrying
`.default()` — `TransitionIssueSchema.fields`, `BulkUpdateIssuesSchema.skipConflicts`,
`CreateCommentSchema.isInternal` — `z.infer` is the type *after* defaults run, so
it demands all three from a caller whose whole benefit was not supplying them.
`z.input` is the type a caller actually writes. Exporting both, as
`CreateIssue`/`CreateIssueInput`, would remove a papercut at every call site;
exporting only `z.infer` is consistent with `CreateIssue` and `UpdateIssue` today.

### What I did instead for now

`apps/web/src/api/issues.ts` derives what it needs locally:

```ts
export type TransitionIssueInput = z.input<typeof TransitionIssueSchema>
```

Derived, so it cannot drift — but it is the app importing `zod` to compensate for
a missing export, and it should go away when the five lines land.

---

## 6. Neither board endpoint's query parameters are named

### What the contract says today

`docs/specs/api/boards-sprints.md:41` specifies the board read as
*"Response `BoardViewSchema`, cards as `BoardCardSchema`"* and never gives the
request. `docs/specs/api/boards-sprints.md:186` says only
*"Backlog cursor-paginated"*.

### Why that does not work

`GET /boards/:id` must be parameterised by sprint — `docs/specs/web/README.md:152`
declares the query key as `board: (boardId, sprintId)`, and a key parameterised by
sprint whose URL is not means two cache entries map to one request, so switching
sprints renders the previous sprint's cards. And the backlog cannot be paged
without a name for the cursor.

Unnamed is worse than either answer here, because the client and server each pick
independently and both are internally consistent. The failure surfaces as a board
that ignores the sprint selector — which reads as a UI bug and gets debugged in
the UI.

### Minimum change I need

Confirm or correct two derivations, in
[docs/specs/api/boards-sprints.md](../specs/api/boards-sprints.md) §2 and
the backlog section:

- `GET /boards/:id?sprintId=<id>`, absent meaning the board's default — active
  sprint for scrum, everything for kanban. Derived from the web spec's key shape.
- `GET /boards/:id/backlog?cursor=<opaque>&limit=<1..200>`, both names taken from
  `PageRequestSchema` (`packages/contracts/src/common.ts:88`), which is the
  contract's single description of a paged request. If the URL used
  `page`/`per_page` instead, that schema would describe nothing.

### What I did instead for now

Implemented both with the derived names, with the derivation written into
`apps/web/src/api/boards.ts`'s header so it is visible as an assumption rather
than mistaken for a quotation. If the spec names them differently, that file is
the only place that changes.

---

## Also noticed — not mine to file, but unfiled

`docs/specs/api/issues.md` instructs two change requests be raised, and neither
exists in this directory:

- [issues.md](../specs/api/issues.md) §9 — the `idempotency_keys` table. Creates
  are to be implemented without the replay path until the migration lands.
- [issues.md](../specs/api/issues.md) §5 step 2 — the per-issue key alias table,
  without which a move breaks every existing link to the old key.

Both are server-side and neither blocks the UI foundation. Flagging them because
a spec that says "file this" and a directory that does not contain it look
identical to "already handled".

### A note on how the section references above are written

Every cross-document section reference in this file is a markdown link followed by
the section number, never a backticked filename followed by one. That is not a
style preference: `pnpm check:docs` validates a section number against the file it
follows a *link* to, and treats an unlinked one as a reference to the containing
document. The first draft of this file wrote them as `` `issues.md` `` plus a bare
number, and the check caught two consequences — one number that resolved to a
section this file does not have, and one that resolved silently to the wrong
section of this file, which is the more expensive half. The same class of drift
this CR reports one layer down, found in the CR reporting it.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** <accepted / accepted-with-changes / rejected>

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
