# CR-011 — The issue view has no read shape for comments, attachments, worklogs, history pages or the field layout

| | |
| --- | --- |
| **Raised by** | Claude Code, writing [issue.md](../specs/web/issue.md) — the issue detail and create surface spec |
| **Status** | `open` |
| **Blocks** | Five sections of the most-visited page in the product: the comment thread, custom fields (all of them), the attachment list, worklog entries, and the activity feed. The unblocked two-thirds — core-field editing, transitions, links, subtasks, delete, create, the keyboard layer and every error state — can be built and shipped without any of this. |

## What I was implementing

Nothing yet — I was writing the spec, which is the point at which this was
findable. [README.md](../specs/web/README.md) §3 requires every response to be
parsed by a contract schema before it reaches a component, and
[AGENTS.md](../../AGENTS.md) §2 forbids hand-writing an interface that mirrors one.
Together those mean a surface spec cannot name a payload the contract has no shape
for without instructing the build agent to break one rule or the other.

So this is five instances of one thing: `IssueDetailSchema` returns a **count** or
an **aggregate** where the screen needs a **list**, and no other endpoint supplies
the list.

The five are separate CRs by subject and one CR by cause, which is why they are
filed together. Each is cheap on its own; the reason to decide them at once is that
four of the five are "add a read schema next to a write schema that already exists",
and deciding them one at a time is how they end up with four different pagination
conventions.

## What the contract says today

### 1. Comments — a write shape with no read shape

```ts
// packages/contracts/src/issue.ts:254
export const CreateCommentSchema = z.object({
  body: RichTextDocSchema,
  /** A COMMENT id — replying to a comment. Not the issue's parent. */
  parentId: CommentIdSchema.optional(),
  isInternal: z.boolean().default(false),
  idempotencyKey: IdempotencyKeySchema,
})
```

There is no `CommentSchema`. Grepped the whole of `packages/contracts/src/`:
`CreateCommentSchema` is the only comment-shaped export. `IssueDetailSchema` gives:

```ts
// packages/contracts/src/issue.ts:136
  commentCount: z.number().int(),
```

And no endpoint is specified. [issues.md](../specs/api/issues.md) §7 describes
comment *behaviour* in detail — `comments` has a version trigger so edits take a
version, and internal comments must be filtered in the query rather than the
serialiser — but names no path, no request schema and no response schema. The same
is true of links, worklogs, attachments and watchers: that section covers all five
as behaviour and specifies zero endpoints for any of them.

Meanwhile [issues.md](../specs/api/issues.md) §6 says the detail response includes
*"comment page 1, history page 1, attachment metadata, watcher state for the
caller"*. Only the last of those four is on `IssueDetailSchema`. That is a
divergence between the API spec and the contract, in the direction the API spec
promises more.

### 2. The project's field layout is unreachable

`ProjectFieldConfigSchema` exists and is well-designed — `isRequired`,
`showOnCreate`, `showOnView`, `position`, `section`, `labelOverride`, `helpText`,
`defaultValue`, and two `FilterNodeSchema` ASTs:

```ts
// packages/contracts/src/field.ts:196
  /**
   * Conditional fields, held as filter ASTs over the in-flight issue.
   * Declarative so the SAME rule drives the client (hide the input) and
   * the server (reject the write). Two implementations of one rule always
   * drift; one definition cannot.
   */
  visibilityRule: FilterNodeSchema.nullable(),
  requirementRule: FilterNodeSchema.nullable(),
```

**No specified endpoint returns it.** [fields.md](../specs/api/fields.md) specifies
exactly one endpoint, `GET /organizations/:id/field-audit`, which returns
`ConfigurationAuditSchema`. `ProjectDetailSchema` carries `lead`, `issueTypes`,
`counts` and `permissions` — no layout. `IssueDetailSchema` carries the values and
not the definitions:

```ts
// packages/contracts/src/issue.ts:81
  customFields: CustomFieldValuesSchema,   // z.record(z.unknown())
```

`valueSchemaFor(config)` is exported for the client to validate with, and takes a
`FieldConfig` the client cannot obtain.

### 3–5. Attachments, worklogs, history

```ts
// packages/contracts/src/issue.ts:137
  attachmentCount: z.number().int(),
```

No `AttachmentSchema`, no `WorklogSchema` — `IssueSchema` has the two time
aggregates (`timeSpentSeconds`, `remainingEstimateSeconds`) and nothing that
enumerates the worklogs behind them. History is the one where the shape is already
right:

```ts
// packages/contracts/src/issue.ts:267
export const IssueHistoryEntrySchema = z.object({
  seq: z.number().int(),
  actor: ActorSchema,
  changes: z.array(DisplayedFieldChangeSchema),
  createdAt: InstantSchema,
})
```

`DisplayedFieldChangeSchema` even carries `fromDisplay`/`toDisplay` so the client
never renders a raw id — its header explains that choice at length. Nothing returns
a page of them.

## Why that does not work

**The field layout is the severe one, and it is a correctness problem rather than a
missing feature.** Without it:

- Not one custom field can be rendered on the issue view. `customFields` is
  `Record<string, unknown>`, so a value is a key and a blob. `severity: 'major'`
  can be printed; a select's option label, a user reference, a date's locale
  formatting and the field's own *name* cannot, because all four live in the
  `FieldConfig`.
- The create form cannot know which fields are required. It therefore submits, and
  the server returns `422 required_field_missing`. That is the exact failure
  [fields.md](../specs/api/fields.md) §2 exists to prevent — it says report *every*
  problem at once because *"a form that reveals one validation error per submit is a
  specific thing users hate about the product being replaced"* — reintroduced not by
  a bad implementation but by the client having no way to check first.
- The `visibilityRule`/`requirementRule` design is defeated. Its own docblock says
  the value of a declarative AST is that one definition drives both sides. A client
  that cannot fetch the rule cannot be the second side, and the "hidden" half of
  hidden-but-writable becomes server-only — which
  [fields.md](../specs/api/fields.md) §4 correctly calls an integrity hole when it
  is the *other* way round.
- `requiresFieldKeys` on `AvailableTransitionSchema` is a list of field keys. A
  transition requiring a custom key cannot render its dialog, so that transition
  cannot be performed from the UI at all.

**The other four are missing features, but one of them is the comment thread**,
which is not a section of the issue view so much as the reason people return to it.
`commentCount: 12` with nothing behind it is the shape of the problem: the payload
knows there are twelve and can produce none of them.

Worth naming because it shows how long this has been latent: `queries/keys.ts`
already registers a key for it.

```ts
// apps/web/src/queries/keys.ts:60
  issueComments: (key: string) => ['issue', key, 'comments'] as const,
```

A registered, tested query key for a query that cannot be written. That file's own
note explains the nesting is deliberate so invalidating the issue invalidates the
thread — reasoning that is entirely correct and has never run.

## Minimum change I need

Deliberately not the most general version. Four read schemas and one delivery
decision.

1. **`CommentSchema`** — `id`, `issueId`, `author` as a resolved ref (id,
   displayName, avatarUrl, so the thread needs no user lookup), `body:
   RichTextDocSchema`, `parentId`, `isInternal`, `version`, `createdAt`,
   `updatedAt`, and `editedAt` distinct from `updatedAt` if an edit is to be
   visible as one. Plus `UpdateCommentSchema` with `version`, since
   [issues.md](../specs/api/issues.md) §7 says edits take one. Delivered by
   `GET /issues/:key/comments` returning
   `pageSchema(CommentSchema)` — cursor, per [common.ts](../../packages/contracts/src/common.ts)'s
   `pageSchema`, not offset. **Not** inlined on `IssueDetail`: a 40-comment thread
   on the detail payload contradicts its own 120ms budget.

2. **The field layout.** My recommendation is `GET /projects/:key/field-layout`
   returning `{ configs: ProjectFieldConfig[], definitions: FieldDefinition[] }`,
   as a **separate** query rather than a field on `IssueDetail`, for three reasons:
   it belongs to `(project, issueType)` and not to the issue, so inlining it repeats
   project-level data on every issue in the project; it is the same answer for every
   issue the user opens, so it caches for the whole session and the second issue
   view is *faster* than an inlined version; and the create form needs it before any
   issue exists. `definitions` alongside `configs` because
   `ProjectFieldConfigSchema` holds `fieldDefinitionId` and `fieldKey` but not the
   `FieldConfig`, and `valueSchemaFor` needs the config.

   If it must be one request instead, the alternative is a `fieldLayout` key on
   `ProjectDetailSchema` — also acceptable, and still not on `IssueDetail`.

3. **`AttachmentSchema`** — `id`, `filename`, `contentType`, `sizeBytes`,
   `uploadedBy`, `createdAt`, and a `downloadUrl` that is presigned and minted per
   request. Upload is out of scope for this CR; listing is not.

4. **`WorklogSchema`** — `id`, `author`, `timeSpentSeconds`, `startedAt`,
   `comment`, `createdAt`.

5. **A history endpoint** — `GET /issues/:key/history` →
   `pageSchema(IssueHistoryEntrySchema)`. No new schema needed; this is the cheapest
   of the five and it unblocks the activity feed entirely.

One decision spans all of them and is worth making once here rather than five
times later: **counts stay on `IssueDetail`.** `commentCount` and
`attachmentCount` are what let the page label a section before its contents load,
which is a real perceived-speed win and the reason they were put there. Adding the
lists should not remove them.

## What I did instead for now

Wrote the spec with the gap stated rather than papered over.
[issue.md](../specs/web/issue.md) §4 is a table of the five, and it also sets the
build order that follows from it: everything unblocked ships first, the blocked five
are built the day their shapes land, and **nothing is stubbed with a local
interface** — a stub in a component is the hand-written mirror
[README.md](../specs/web/README.md) §3 forbids, with a shorter half-life than the
real thing.

Where a count exists without its list, the spec requires the section to render the
count and say plainly that the list is not available yet, rather than not render.
That is the [product-quality-bar.md](../product-quality-bar.md) §13 rule applied to
our own incompleteness: a control that says why it cannot is better than one that
silently does nothing.

The custom-fields and comments sections of the spec are written in full even though
both are blocked, so the design is not invented under time pressure on the day the
shapes land.

---

## Resolution

**Decision:** `accepted-with-changes`

**Reasoning:**

Accepted in full, in one pass, for the reason the CR itself gives: four of the five
are "add a read schema next to a write schema that already exists", and deciding
them one at a time is how they end up with four different pagination conventions.
All four now go through `pageSchema` — which had been declared in `common.ts` and
called by nothing since it was written, and now has five callers.

The field layout was the severe one and the CR is right that it is a correctness
problem rather than a missing feature. `valueSchemaFor` was exported for a client to
validate with and took a `FieldConfig` no client could obtain; a declarative
visibility AST whose stated value is *"one definition drives both sides"* had one
side. `ProjectFieldLayoutSchema` closes it as a separate endpoint, with the
recommended `{ configs, definitions }` shape and not as a key on `ProjectDetail`,
because the create form needs it before any issue exists and it caches for the
session.

Three departures from the proposal, each recorded in the contract next to the field
rather than only here:

- **`description`, not `comment`, on a worklog.** `comments` is a table and a thread
  on the same screen; a worklog field called `comment` would be the word's third
  meaning in one view, and the two are not the same thing — one is a note about the
  time, the other is a conversation.
- **`mimeType`, not `contentType`, on an attachment.** It matches the column and the
  `attachment` field config's `allowedMimeTypes`, and `check:vocab` now has one name
  for it instead of two.
- **`uploadStatus` omitted rather than included.** The list returns ready
  attachments only, so the field would always read `'ready'` — a field the UI must
  branch on and never can, which is worse than not having it. In-flight state belongs
  to the upload flow and stays client-side until confirmation.

Two further findings came out of writing it, and both were false claims rather than
gaps — the more dangerous shape, because prose asserting a mechanism reads as
verification:

- **`check-column-drift.mjs` exempted `comments`, `attachments` and `worklogs` on a
  reason that was not true.** Its `UNPAIRED_TABLES` entries said they *"reach clients
  inside `IssueDetailSchema`"*; `IssueDetailSchema` carried `commentCount` and
  `attachmentCount` and nothing else. So three tables were exempt from the field-name
  check on the strength of a sentence about a payload that was never built. All three
  are now in `PAIRS`, and the three entries are gone.
- **[issues.md](../specs/api/issues.md) §6 promised a payload the contract could not
  produce.** It listed *"comment page 1, history page 1, attachment metadata"* and
  custom field *"definitions"* — four things `IssueDetailSchema` did not carry. The CR
  found this and called it a divergence "in the direction the API spec promises more".
  The resolution keeps the payload and fixes the prose: the detail read is the *frame*
  of the screen, fixed-size, which is what makes its 120ms budget defensible, and that
  section now says why each of the four is deliberately elsewhere.

The counts stay, as the CR asks. They label a section before its contents load, and
removing them would reintroduce a layout shift on the most-visited page in the
product.

One [product-quality-bar.md](../product-quality-bar.md) §31 duplication was found
and deliberately **not** fixed here.
`UserRefSchema` (`tenancy.ts:163`) already existed — *"a user as the product renders
them"* — and four read models hand-inline the same three fields:
`project.ts:98` (lead), `issue.ts:113` (reporter), `issue.ts:117` (assignee),
`board.ts:223` (card assignee). None of them carry `isInactive`, so none can grey a
departed member. The four new schemas all use `UserRefSchema`. Converting the
existing four changes four public read-model types and ripples into `apps/web`, so it
is its own change request rather than a widening slipped into this diff.

**Changes made:**

- `packages/contracts/src/ids.ts` — added `WorklogId` / `WorklogIdSchema`.
  `CommentIdSchema` and `AttachmentIdSchema` already existed.
- `packages/contracts/src/issue.ts` — added `UpdateCommentSchema` (`body` required,
  because there is no partial edit of a rich-text document; `version` because
  `comments` carries a version trigger; no `parentId`, because a reply cannot be
  re-parented out from under the people who replied to it), and a new section
  carrying `CommentSchema`, `CommentPageSchema`, `AttachmentSchema`,
  `AttachmentPageSchema`, `WorklogSchema`, `WorklogPageSchema` and
  `IssueHistoryPageSchema`. `author` / `uploadedBy` are `UserRefSchema`, which carries
  `isInactive`, so a departed author renders greyed instead of blank.
- `packages/contracts/src/field.ts` — added `ProjectFieldLayoutSchema`.
- `scripts/check-column-drift.mjs` — `comments`, `attachments` and `worklogs` moved
  from `UNPAIRED_TABLES` into `PAIRS`, with `columnFor` for the four names that
  differ (`author → author_id`, `uploadedBy → uploaded_by`, `author → user_id`,
  `timeSpentSeconds → seconds`), `downloadUrl` declared `derived`, and
  `storage_key` / `checksum_sha256` / `upload_status` declared `internal` with the
  reason each is not serialised. Verified against a real Postgres:
  `Compared 30 contract schema(s) against their tables.` /
  `✓ Every contract field has a column, and every column has a purpose.` — 27 before.
- [issues.md](../specs/api/issues.md) §6 rewritten (the four deliberate absences and
  why); a new subsection under the comments/links/worklogs section specifying all four
  list endpoints with one pagination convention, and the per-list rules extended
  beneath it; four budgets added; and 11 DoD lines, including the one that catches the
  defect this CR is about: *a page of comments has the same length for a member and for
  a guest*, because filtering internal comments after the `LIMIT` makes the caller's
  permissions visible in the page size.
- [fields.md](../specs/api/fields.md) §2 gained a subsection for
  `GET /projects/:projectKey/field-layout`, plus four DoD lines. Its two helpers both
  take a `layout` that, until now, nothing returned.
- `packages/mocks/src/thread.ts` — new: `aComment`, `commentsFor`, `aCommentPage`,
  `anAttachment`, `attachmentsFor`, `aWorklog`, `worklogsFor`. The thread is
  **generated per issue and is exactly as long as that issue's `commentCount`**,
  because a card that says 18 opening a panel that shows 5 is a world no real API
  could produce, and every off-by-one at a "load more" boundary hides behind the
  discrepancy.
- `packages/mocks/src/scenario.ts` — `commentsByIssueKey` and
  `attachmentsByIssueKey` added, and the card→detail derivation fixed to carry
  `commentCount` / `attachmentCount`. It did not, so `aBoardCard()`'s 18 opened a
  detail record holding the builder's default of 7 — invisible until something was
  generated from the count.
- `packages/mocks/src/mocks.test.ts` — 26 tests: the length equality against both the
  detail record and the card, thread ordering, id uniqueness across the world, the
  seven designed cases, and the worklog sum. Negative-tested twice — deriving the
  thread from a constant fails exactly three named tests, and moving the deactivated
  author out of the first six entries fails exactly one. 102 passing.

**Anyone who must pull before continuing:**

Everyone. `@flux/contracts` gained nine exports and `@flux/mocks` gained seven
builders. The UI agent needs both before building the comment thread, the attachment
list, the activity feed or any custom field. Nothing existing changed shape, so
nothing breaks on the way in.

The 120ms detail budget is now a claim about a fixed-size payload rather than about
one containing a thread. Do not inline any of the four lists to save a request.
