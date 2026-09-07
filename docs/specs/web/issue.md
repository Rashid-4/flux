# Issue — detail view and create

Read [README.md](README.md) first. Everything here assumes it and none of it is
repeated: data access ([README.md](README.md) §3), the bootstrap request
([README.md](README.md) §4), server vs client state ([README.md](README.md) §5),
mutations ([README.md](README.md) §6), errors ([README.md](README.md) §7), budgets
([README.md](README.md) §8), keyboard and accessibility ([README.md](README.md) §9),
building against mocks ([README.md](README.md) §10), the design system
([README.md](README.md) §11), testing ([README.md](README.md) §12).

Branch: `feat/ui-issue`.

**Read §4 before
planning the work.** Five parts of this surface have no contract behind them yet,
and one of them is the comment thread. Which order you build in depends on that
list, not on the layout below.

---

## 1. Scope

The issue view is the most-visited page in the product. Not the board — the board
is where people look, and this is where they *work*. Every field edit, every
status change, every comment and every estimate passes through it, so it is the
surface where a 200ms delay is paid fifty times a day by one person.

It is also the page a Jira user compares most directly, and the comparison is
unusually winnable: Jira's issue view is a full navigation for a one-field edit,
a modal that loses your typing, and a "You can't do that" with no reason. Each of
those is a specific thing this spec forbids.

**In scope**

| Thing | State |
| --- | --- |
| `/browse/:issueKey` — the detail route | **not built** — `ROUTE_PATTERNS.issue` exists and points at `routes/planned.tsx` |
| Field editing, inline and per-field | **not built** |
| The transition control, with reasons | **not built** |
| Custom fields, driven by the project's layout | **blocked** — see §4 |
| Rich text: rendering, and a composer | **not built** — a decision, see §9 |
| Comment thread | **blocked** — no read shape exists |
| Links, subtasks, parent | partly — `links` is on the payload, subtasks are a count |
| Activity / history | **blocked** — shape exists, endpoint does not |
| Create, as a dialog and as a full page | **not built** |
| `version_conflict` resolution | **not built** — and it is the hardest thing here |

**Out of scope.** The board and the backlog (`board.md` and `backlog.md`, neither
written). Move and bulk edit — both are filed in
[002-issue-command-contract-gaps.md](../../change-requests/002-issue-command-contract-gaps.md)
and neither has a request schema, so they cannot be written, and a half-built move
wizard is worse than none ([issues.md](../api/issues.md) §5 is explicit about why).
Attachments upload, which needs the pre-signed URL flow and belongs with the file
layer. Worklog entry, for the same reason as comments.

## 2. What already exists — do not rebuild it

| Module | What it gives you |
| --- | --- |
| `api/issues.ts` | `getIssue`, `createIssue`, `updateIssue`, `transitionIssue`, all parsing both ways. Read its header on `undefined` vs `null` surviving `JSON.stringify` before you touch a PATCH body |
| `api/idempotency.ts` | `newIdempotencyKey()`. Mint it when the user's *intention* begins, not at the call site — the header says why |
| `api/errors.ts` | the taxonomy [README.md](README.md) §7 is built on, and `RETRYABLE_CODES` |
| `queries/keys.ts` | `keys.issue(key)` and `keys.issueComments(key)` already exist. Note that comments nests under issue on purpose |
| `components/data/issue-key.tsx` | the monospace key, already a link |
| `components/data/status-chip.tsx` | status name plus category, shape and colour |
| `components/data/priority-icon.tsx` | glyph plus accessible label. Carries a runtime fallback for an unmapped value — CR-006 |
| `components/data/type-icon.tsx`, `label-chip.tsx`, `user-avatar.tsx` | the rest of the issue vocabulary |
| `components/data/relative-time.tsx` | already skew-corrected. Every timestamp on this page goes through it |
| `components/data/confirm-dialog.tsx` | for delete, and for the `confirmation_required` code |
| `components/data/toaster.tsx` | transient success. **Not** for errors that need a decision |
| `components/ui/` (17) | dialog, select, popover, dropdown, tabs, tooltip, switch, checkbox, radio, input, label, separator, scroll-area, skeleton, badge, button, avatar |
| `components/empty-state.tsx`, `error-state.tsx` | the two designed states. Use them |
| `lib/paths.ts` | `paths.issue(key)` → `/browse/LOG-142`. The header records why the URL carries no project key |

There is **no `Textarea`**, no combobox and no editor. The first two are
`shadcn add`; the third is §9.

## 3. Two surfaces, one spec, one branch

Detail and create are specified together because they share four things, and
splitting them duplicates all four: the field layout that decides which inputs
exist, the validation that maps `fields[]` onto them, the rich-text component, and
the type/assignee/component pickers. A create form built separately from the edit
form is how the two end up disagreeing about whether a field is required.

They are *not* the same component. Create is a form that submits once; detail is a
set of independently-committing fields (§6).
Share the inputs and the layout resolution; do not share a `useForm`.

## 4. What one request gives you, and the five things it does not

`GET /issues/:key` → `IssueDetailSchema`, and it is deliberately fat:
`projectKey`, `statusName`, `issueTypeName`, `hierarchyLevel`, `sprintName`, both
users resolved with avatars, `availableTransitions`, `links` with each linked
issue's summary and status, `subtaskSummary`, `commentCount`, `attachmentCount`,
`watcherState`, and `permissions` — seven booleans resolved server-side.
[issues.md](../api/issues.md) §6 budgets that at 120ms and its DoD asserts a query
count, so **a screen that needs a transition list reads it from here** rather than
issuing a second request for it.

Then there are five things this surface visibly needs and the contract has no shape
for. They are filed as
[010-issue-view-read-model-gaps.md](../../change-requests/010-issue-view-read-model-gaps.md);
what matters here is that the spec does not pretend otherwise, because a spec that
names a schema the contract lacks describes code that cannot be written, and the
agent then invents the schema.

| Missing | What exists instead | Consequence for this surface |
| --- | --- | --- |
| **A comment read shape.** `CreateCommentSchema` is the write side; there is no `CommentSchema`, and no endpoint is specified | `commentCount: number` | The thread cannot be built. `keys.issueComments` is a registered key for a query that cannot be written |
| **The project's field layout.** `ProjectFieldConfigSchema` exists as a type and no specified endpoint returns it | `customFields: Record<string, unknown>` | Not one custom field can be rendered, and create cannot know what is required — so `required_field_missing` arrives as a surprise on submit, the exact failure [fields.md](../api/fields.md) §2 forbids |
| **An attachment read shape** | `attachmentCount: number` | A count with nothing behind it |
| **A worklog read shape** | `timeSpentSeconds`, `remainingEstimateSeconds` | Aggregates render; the entries behind them cannot |
| **A history endpoint.** `IssueHistoryEntrySchema` exists; nothing returns a page of them | nothing | No activity feed, though the shape is ready |

**Build order follows from that table.** Everything not blocked is built first and
shipped: the layout, the header, core-field editing, transitions, links, subtasks,
delete, create-with-core-fields, and the whole keyboard and error surface. The
blocked five are built the day their shapes land, against `@flux/mocks` builders
added in the same change. Do **not** stub them with a local interface — the rule
in [README.md](README.md) §3 is that nobody hand-maintains a mirror of the API's
shape, and a stub in a component is that mirror with a shorter half-life.

What you *may* do is render the counts honestly. `commentCount: 12` with no thread
is a section that says "12 comments" and, instead of a list, says the thread is not
available yet. That is not a nice empty state — it is the §13 rule
applied to our own incompleteness, and it beats a section that silently is not
there.

## 5. Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ LOG · Bug · LOG-142                                    ⋯  watch    │  breadcrumb
│ Summary, editable in place, h1                                     │
├──────────────────────────────────────┬─────────────────────────────┤
│ description                          │ status  [In progress ▾]     │
│ subtasks           3 of 7            │ assignee                    │
│ links                                │ reporter                    │
│   blocks         LOG-201             │ priority · story points     │
│   is blocked by  LOG-103             │ sprint · team               │
│ ────────────────────────             │ dates                       │
│ activity  comments | history | all   │ labels · components         │
│                                      │ custom fields (by section)  │
│ [composer]                           │ ─────────────────           │
│                                      │ created · updated           │
└──────────────────────────────────────┴─────────────────────────────┘
```

- **Two columns above 1024px, one below**, primary column first in the DOM in both
  — so the reading order and the tab order are the same at every width, and the
  narrow layout is not a different document.
- **The right column is not a sidebar**, it is a definition list. `<dl>`, with
  `<dt>` as the field label and `<dd>` as the control. A screen-reader user hears
  "Assignee, Ada Okafor" as a pair rather than two unrelated strings, and it is
  fewer nodes than a grid of divs.
- **The summary is an `<h1>` that becomes an input in place.** Not a heading with a
  pencil that opens a dialog. It is the field most often wrong and the cheapest to
  fix.
- `commentCount` and `attachmentCount` label their sections, so the user knows
  there are 40 comments before the thread loads.
- The right column scrolls with the page. Do not pin it: at 1024px on a 768px-tall
  laptop a pinned column is a scroll trap with its own scrollbar.

## 6. Editing is per-field and optimistic

**Each field commits on its own.** No "Edit" mode, no form-wide Save, no dirty
guard on the whole page. Changing the assignee and then the priority is two
`PATCH`es, and the second must not resend the first.

That is a `PATCH` per field, and `UpdateIssueSchema` supports it exactly:
`undefined` leaves a field alone, `null` clears it. Send the one key that changed
plus `version`. Send more and you overwrite a colleague's concurrent edit to a
field this user never touched — the same "last write wins" that
[README.md](README.md) §6 says `version` exists to eliminate, reintroduced one
level up.

Commit rules, per input type, because getting these wrong is most of what makes a
tool feel unreliable:

| Input | Commits on | Never on |
| --- | --- | --- |
| Text (summary) | blur, or `Enter` | keystroke — that is a `PATCH` per character |
| Rich text (description) | an explicit Save. `Escape` cancels, and asks first if dirty | blur. Clicking a link inside your own draft must not save half a sentence |
| Select (status via transition, priority, assignee) | selection | — |
| Multi (labels, components, versions) | popover close, one `PATCH` for the whole set | each chip |
| Number (story points, estimates) | blur or `Enter`, after parsing | keystroke |

Every one of them is optimistic with a snapshot rollback, per
[README.md](README.md) §6, and `onSettled` invalidates `keys.issue(key)`. `Escape`
in a text input reverts to the server value and does not commit.

**The rollback has to be visible.** A silent revert reads as the app randomly
undoing your work. On failure: restore the snapshot, keep focus in the field, and
show the reason inline against that field — not a toast, because a toast for a
failed edit is a message that disappears while the user is looking at the wrong
part of the screen.

### `version_conflict` is the hard one, and a toast is not an answer

`PATCH` sends the `version` this client read. When someone else has edited, the
server returns `409` with the current server state in the body
([issues.md](../api/issues.md) §2). [README.md](README.md) §6 is unambiguous:
*"the dialog must show what changed and offer a real choice, not a 'please try
again' toast that loses the user's typing."*

Concretely, and this is the requirement:

- **Never discard the user's value.** It stays in the field, and it stays editable,
  the entire time the conflict is on screen.
- Show three things: what they typed, what the server now has, and who changed it —
  the 409 body is an `IssueDetail`, so `assignee`, `updatedAt` and the field's
  current value are all in hand.
- Offer **Keep mine** (re-`PATCH` at the new version), **Take theirs** (adopt the
  server value, discard the local one, explicitly), and **Cancel** (stay in
  conflict, decide later). Three buttons because two of them are real choices and
  the third is the user refusing to be rushed.
- If the conflicting change touched a *different* field, say so and resolve it
  without asking: adopt the new version, re-send this field. A conflict dialog for
  a collision that did not happen trains people to click through the one that did.

## 7. Transitions — the one place the contract is generous

`availableTransitions` is the richest thing on the payload and the spec's answer to
the single most-complained-about Jira behaviour. Each entry carries `name`,
`toStateName`, `toStateCategory`, `available`, `unavailableReason`,
`requiresFieldKeys` and `requiresComment`.

- **Render unavailable transitions, disabled, with `unavailableReason` in the
  tooltip and in `aria-describedby`.** Do not filter them out. Hiding the option is
  precisely why nobody can work out why they cannot close a ticket, and
  [README.md](README.md) §9's rule — an action the user cannot perform is shown and
  disabled with the reason — has its clearest instance here. `aria-describedby` as
  well as a tooltip, because a disabled control is not hoverable on a touch device
  and a tooltip alone tells a screen-reader user nothing.
- **`requiresFieldKeys` or `requiresComment` non-empty means a dialog, not a
  direct transition.** Collect exactly those, submit them in
  `TransitionIssueSchema.fields` / `comment`. A transition that fires and then
  fails a validator is a round trip spent to learn something the payload already
  said.
- `requiresFieldKeys` contains **field keys**, which is the layout problem in
  §4 again: for a
  core key like `resolution` the input is known, and for a custom key it is not
  renderable yet. Until the layout lands, a transition requiring a custom key
  renders the dialog with a clear statement that it must be done from the API, and
  does not silently submit an empty value.
- The transition control is a `Select`-shaped dropdown showing the current status,
  because the current status is the thing people look at most and a separate
  "Transition" button hides it.
- Optimistic: apply `toStateName` and `toStateCategory` immediately.
  `statusCategory` drives colour *and* shape (`status-chip.tsx`), so a category
  change is visible without waiting.
- On success the whole `IssueDetail` comes back — including a **new**
  `availableTransitions` list. Write it to the cache; do not just patch the status.
  The transitions available from `In review` are not the ones available from
  `In progress`, and a stale list is a button that 409s.

## 8. Custom fields

Blocked on the layout (§4),
and specified now so the shape of the work is not re-decided later.

`ProjectFieldConfigSchema` is what drives the form, and it is richer than a list of
fields: `isRequired`, `showOnCreate`, `showOnView`, `position`, `section`,
`labelOverride`, `helpText`, `defaultValue`, and two ASTs — `visibilityRule` and
`requirementRule`.

- **Render from `position` and `section`, never a hand-written order.** A layout the
  admin arranged and the UI ignores makes the layout editor a lie.
- **`showOnCreate` and `showOnView` are different booleans and both are honoured.**
  A field on create and not on view exists.
- **The two ASTs are evaluated on the client, and that is the point.** The contract
  says so directly: *"the SAME rule drives the client (hide the input) and the
  server (reject the write). Two implementations of one rule always drift; one
  definition cannot."* So there is one evaluator over `FilterNodeSchema`, it lives
  in `lib/`, and it is the same function the create form and the detail view call.
  Do not write a second one for "just this condition".
- A field hidden by `visibilityRule` is **not submitted**. The server rejects a
  value for an invisible field ([fields.md](../api/fields.md) §4), so submitting it
  is a guaranteed 422.
- **Validate with `valueSchemaFor(config)` before submitting.** It is exported from
  the contracts for exactly this, so the form shows the same error the server would
  — every problem at once, never one per submit.
- An unknown `fieldType` renders read-only with its raw value and a note, and does
  not crash. The server may be newer than the app; that is the same rule
  [README.md](README.md) §7 sets for an unrecognised error code.

## 9. Rich text is a decision, not a dependency

`description` and a comment body are `RichTextDocSchema` — a ProseMirror-shaped
node tree, deliberately not an HTML string, so that it can be merged as a CRDT
later and so that rendering never needs a sanitiser. There is no editor in this
repo and no rich-text dependency, and this spec decides that rather than leaving it
to the branch:

**v1 ships a full renderer and a plain-text composer. No editor dependency.**

- **The renderer handles every node it is given.** Not only the ones the composer
  produces: an imported issue carries nodes from Jira's document format, and an
  unknown node renders its `text` and its `content` recursively rather than
  vanishing. A description that silently loses a table is data the user believes
  they still have.
- **The composer writes paragraphs.** `{ type: 'doc', content: [{ type:
  'paragraph', content: [{ type: 'text', text: … }] }] }`, one paragraph per blank
  line. A `Textarea` and a pure function, both trivially testable.
- **A doc the composer cannot represent is not editable by it.** This is the
  load-bearing half. If a description contains anything beyond paragraphs and
  text, the field renders read-only and says why, with the editor available when it
  ships. Opening a downgraded editor over a rich document and saving would flatten
  it — that is silent data loss caused by our own incompleteness, and it is worse
  than a field that declines to edit.
- Never `dangerouslySetInnerHTML`. There is no HTML in the pipeline and adding a
  serialiser would reintroduce the sanitiser question the contract's shape exists
  to close.

TipTap or ProseMirror is a real answer and it is a **change request with a measured
number**, not a `pnpm add`. The app currently ships 199 kB gzipped against a 250 kB
budget ([README.md](README.md) §8); a ProseMirror starter kit is a large fraction of
the remaining 51 kB, and if it is worth that it is worth arguing for. Build behind
one `RichTextEditor` boundary so the swap is one file.

## 10. Comments

Blocked (§4).
Specified because it is the largest blocked piece and the design should not be
invented under time pressure the day the shape lands.

- Paged by cursor, newest-last, `keys.issueComments(key)`. Nested under
  `keys.issue(key)` on purpose, so invalidating the issue invalidates the thread —
  read the note in `queries/keys.ts`.
- **The composer is client state, in Zustand, keyed by issue.** A half-written
  comment survives navigating away and back. Losing typed text is named in
  [README.md](README.md) §6 as the most infuriating failure in an issue tracker, and
  the cheapest version of it to prevent is this one.
- Optimistic append with the author's own avatar, marked pending until it lands,
  rolled back visibly on failure with the text **returned to the composer** — never
  dropped.
- `CreateCommentSchema` carries `idempotencyKey`. Mint it when the user starts
  typing, not on submit, so a retry after a timeout cannot double-post.
- `isInternal` exists and is filtered server-side in SQL
  ([issues.md](../api/issues.md) §7). An internal comment must be *visibly* marked
  — someone about to write something candid needs to know which thread they are in
  before they write it, not after.
- Edits take a `version` (comments have their own). Same conflict rules as
  §6.
- The thread virtualizes past ~100 entries ([README.md](README.md) §8).

## 11. Links, subtasks and the parent

`links` is on the payload with each linked issue's `key`, `summary`, `statusName`
and `statusCategory` — enough to render the row with no second request. Group by
`linkType` and **`direction`**, and read the contract's comment on it: `'outward'`
means this issue blocks the other, `'inward'` means it is blocked. Those are the
same row read two ways and it is the field most likely to be rendered backwards.
`@flux/mocks`' default fixture deliberately contains both directions so a test can
catch it.

- `blockedByCount` is trigger-maintained and is the badge. Never derive it by
  counting `links` — the list is the caller's visible subset and the count is the
  truth.
- `subtaskSummary` is `{ total, done }` and nothing else, so the section shows
  "3 of 7 done" and a progress indication. It cannot list them; that is a query
  this surface does not have. Say "View subtasks" and link to a filtered search
  once `search.md` exists — do not fabricate a list.
- `parentId` is an id with no summary attached, so the breadcrumb can link it but
  cannot label it. Render the parent as its key. Do not fetch the parent to get a
  title — that is an N+1 on the hottest page in the product, and the fix is a
  contract change, not a request.
- Adding a link uses `LinkIssueSchema` and needs an issue picker. Until search
  exists, accept a typed issue key validated against `IssueKeySchema` — the same
  local-first reasoning as the palette's issue-key fast path
  ([shell.md](shell.md) §7).
- Reparenting revalidates with `canBeChildOf` **and** `wouldCreateCycle`, both
  exported from the contracts, before submitting. `hierarchy_violation` is a 422
  the client can almost always prevent.

## 12. Create

Two entry points, one implementation: a dialog from anywhere (`c`), and
`/browse/new` as a full page for a deep link or a refresh. Same component, same
validation.

- **`idempotencyKey` is required by the contract, and it must be minted when the
  dialog opens.** Not on submit. `api/idempotency.ts` says why: a fresh key on
  retry defeats the entire mechanism and creates a second ticket.
- Project and issue type first, because the layout depends on both. `bootstrap`
  gives the permission-filtered projects; `ProjectDetailSchema.issueTypes` gives
  the types with `hierarchyLevel` and `isDefault`. Default to the current project
  when there is one, and to `isDefault` for the type.
- Changing project or type re-resolves the layout. **Keep every value whose field
  still exists**, and say plainly which values will be dropped before dropping
  them. Silently clearing a form because someone changed a dropdown is the failure
  people describe as "it ate my ticket".
- `required_field_missing` and `field_value_invalid` arrive with `fields[]`. Attach
  each to its input by `path`, including custom-field keys, and focus the first.
  Never a form-level "invalid input" — [README.md](README.md) §7.
- **Create is not optimistic in the same sense as an edit.** There is no row to
  patch and the server allocates the key ([issues.md](../api/issues.md) §1 step 7),
  so the honest pattern is: submit, keep the dialog open and busy, and on success
  either navigate to the new key or — for "Create another" — reset the form, mint a
  **new** idempotency key, and toast the created key as a link. Never render a
  fabricated key.
- `Escape` on a dirty create asks before discarding.

## 13. States

| State | Requirement |
| --- | --- |
| Loading | a skeleton in this layout, both columns, matching the real geometry ([README.md](README.md) §11) — not a spinner |
| `not_found` | one message for missing, deleted and not-permitted, because the API deliberately makes them identical ([issues.md](../api/issues.md) §10) and a distinguishable 403 would confirm the issue exists. Never say "you don't have permission" on a 404 |
| A `301` from a project-key alias | follow it and update the URL. A bookmark heals itself ([projects.md](../api/projects.md) §2) |
| `permission_denied` on an edit | name `requiredPermission` from the error body. It is safe to disclose and it turns an opaque 403 into something an admin can fix |
| `permissions` all false | a fully read-only page that says it is read-only, not a page of dead controls |
| `version_conflict` | §6. Never lose the typed value |
| `rate_limited` | honour `retryAfterSeconds`. Do not spin |
| Unknown error code | render `message` plus a copyable `traceId`, and do not crash |
| A background refetch fails | keep the page. The lesson from `routes/shell.tsx` — `isLoadingError`, not `isError` |
| Deleted while open | soft delete only, so the row survives. Say it was deleted and by whom; do not 404 a page that was fine a second ago |
| Offline | the shell's indicator; queued edits named, not silently dropped |

Empty is not a state here — an issue always has a summary — but **every optional
field has an empty rendering that is a control**. "None" that cannot be clicked is
a dead end; "Add assignee" is the same information and an affordance.

## 14. Keyboard

Registered in `keyboard/` so `?` lists them ([shell.md](shell.md) §6). Scoped to
this surface — none of these fire on the board.

| Keys | Action |
| --- | --- |
| `e` | edit summary |
| `a` | assign |
| `i` | assign to me |
| `m` | comment (focus the composer) |
| `l` | labels |
| `s` | status / transition menu |
| `.` | the `⋯` action menu |
| `w` | watch / unwatch |
| `y` | copy the issue key |
| `Escape` | cancel the active field edit, reverting it |

- **None of them fire while a text input, textarea or contenteditable has focus.**
  That rule is in the registry ([shell.md](shell.md) §6) and this is the surface it
  exists for: a page that is mostly text fields with single-letter shortcuts is
  where a leaked handler types `w` into someone's comment.
- `i` (assign to me) is the highest-value shortcut on the page and the one Jira
  users reach for first.
- Every control in the right column is reachable and operable by keyboard,
  including the multi-selects, and a full keyboard walkthrough is in the DoD.

## 15. Budget

[README.md](README.md) §8 holds the numbers. Measure and record in the PR:

- **Navigate → issue painted**, warm cache and cold. The server budget is 120ms
  ([issues.md](../api/issues.md) §6); the client must not add a second one on top of
  it.
- **Keystroke → character on screen in the description composer.** Under one frame.
  A `PATCH`-per-keystroke or a re-parse of the whole doc per keystroke both fail
  here, and both are easy to write by accident.
- **Field edit → visible change.** Optimistic, so this is a render cost. It should
  be indistinguishable from zero.
- The surface's own JS contribution, separately, against the 51 kB gzipped
  remaining. If it needs more than that, say so with the number rather than shipping
  it.

## 16. Testing

[README.md](README.md) §12 applies. Specific to this surface:

- **`undefined` vs `null` on a PATCH, end to end**, asserted on the serialised
  body. `{ assigneeId: null }` must reach the wire and `{ assigneeId: undefined }`
  must not. `api/issues.ts` has the mechanism; this surface is where a helper that
  "strips empty values" would break unassign.
- **One `PATCH` per field, carrying one key.** Assert the request body, not just
  that a request happened. A form that sends every field is invisible to a test
  that only checks the response.
- **Every optimistic path has a rollback test** that asserts the value returned,
  focus stayed in the field, and the reason was rendered inline.
- **`version_conflict` keeps the typed text.** Type, force a 409, assert the typed
  value is still in the input and all three choices are present. This is the test
  most likely to be skipped and it guards the requirement most likely to be broken.
- **An unavailable transition is rendered, disabled, and names its reason** — from
  the default `anIssueDetail()` fixture, which contains exactly that case on
  purpose, plus a `requiresComment` and a `requiresFieldKeys` one.
- **Transitioning replaces `availableTransitions`**, not just the status.
- **Link direction, both ways.** `outward` renders as "blocks" and `inward` as "is
  blocked by". The fixture has both.
- **The renderer survives an unknown node type** and renders its text.
- **The composer refuses to open over a doc it cannot represent.** Negative-test it:
  a doc with a heading node must not become editable.
- `not_found` renders the deliberately-ambiguous message, and a permission-shaped
  404 does not leak that the issue exists.
- axe on the loaded page, the create dialog, the transition dialog and the conflict
  dialog. The `<dl>` structure and the disabled-with-`aria-describedby` pattern are
  both things axe checks and both easy to get subtly wrong.

## 17. Done means

Everything in "What must be true when a surface is done" in
[README.md](README.md), plus:

- [ ] Each field commits independently, sending only what changed plus `version`.
- [ ] `version_conflict` shows both values, names who changed it, offers three
      choices, and **provably never discards the user's text**.
- [ ] Unavailable transitions are visible, disabled, and state their reason in a
      tooltip *and* `aria-describedby`.
- [ ] A transition needing fields or a comment collects them before submitting.
- [ ] The response's new `availableTransitions` replaces the cached list.
- [ ] Rich text renders every node it is given; the composer will not open over a
      document it cannot represent.
- [ ] No new dependency. A rich-text editor is a change request with a measured
      size, not a `pnpm add`.
- [ ] `idempotencyKey` minted at intention, not at submit, and a new one per
      "Create another".
- [ ] Changing project or type on create preserves what it can and names what it
      will drop before dropping it.
- [ ] `fields[]` errors attach to their inputs by `path`, custom-field keys
      included, with focus on the first.
- [ ] `not_found` is one message for missing, deleted and forbidden.
- [ ] Every optional empty field renders as an affordance, not as "None".
- [ ] Full keyboard operation, single-letter shortcuts suppressed inside text
      inputs, verified by a keyboard-only walkthrough.
- [ ] The five blocked areas are either built against landed contracts or render an
      honest statement of absence. Neither stubbed nor silently missing.
