# CR-010 — The issue view has no read shape for comments, attachments, worklogs, history pages or the field layout

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

<!-- Architecture agent only. -->

**Decision:** <accepted / accepted-with-changes / rejected>

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
