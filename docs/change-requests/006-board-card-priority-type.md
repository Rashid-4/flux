# CR-006 — `BoardCard.priority` is a bare string where every other surface uses `PrioritySchema`

| | |
| --- | --- |
| **Raised by** | Claude Code, building the board's data primitives in `apps/web/src/components/data/` |
| **Status** | `accepted-with-changes` — priority stays closed, and 47 field sites were narrowed, not 2 |
| **Blocks** | nothing — `PriorityIcon` keeps the closed type and carries a runtime fallback |

## What I was implementing

`PriorityIcon`, the glyph-plus-name reading of an issue's priority that a board
card, a backlog row and the issue detail panel all render. `docs/specs/web/README.md`
§9: priority is never communicated by colour alone, so the component maps each
priority to an icon and an accessible label.

## What the contract says today

`PrioritySchema` is a closed enum, and `IssueSchema` uses it:

```ts
// packages/contracts/src/issue.ts:64
  priority: PrioritySchema.nullable(),
```

`BoardCardSchema` does not:

```ts
// packages/contracts/src/board.ts:148
  priority: z.string().nullable(),
```

`packages/contracts/src/events.ts:257` has the same bare `z.string().nullable()`.
So the same field is a closed enum on the issue read model and an open string on
the board read model and on the event payload.

## Why that does not work

Two concrete problems, one of them a crash.

**1. A cast at every board call site, and a crash if the cast is ever wrong.**
`PriorityIcon` takes `Priority | null`, because that is what the field is. A board
card holds `string | null`, so it cannot pass the value without asserting — and an
assertion is exactly the construct that stops the compiler from helping. Before I
added a fallback, an unmapped string made `PRIORITY[priority]` `undefined` and the
next line, `reading.Icon`, threw a `TypeError`. That does not degrade one card: it
propagates to `AppErrorBoundary` and replaces the whole window, so one unexpected
priority value on one card out of two hundred blanks the board.

**2. The drift is invisible to every check we have.** `check:enums` compares enum
values against the CHECK constraint behind them — it verifies that
`PrioritySchema`'s values match `issues.priority`'s CHECK, and they do.
`check:columns` compares field *names* against columns, and `priority` exists on
both sides. Neither can see a field that *should* be an enum and is typed
`z.string()` instead, because from their point of view there is no enum on that
field to compare. This is the same shape as the five drift kinds in CLAUDE.md's
table: a vocabulary shared between two files, with no machine check that spans
them.

Worth stating explicitly, because it is the reason this is a CR and not a bug
report: `issueTypeKey` next to it *is* legitimately `z.string()`, and
`apps/web/src/components/data/type-icon.tsx` documents why — `IssueType.key` is
tenant-defined, `/^[a-z][a-z0-9_]{0,30}$/`, so a closed map plus a fallback is the
honest shape. Priority is not like that today: `PrioritySchema` is six fixed
values with a CHECK constraint enforcing them. If priority is *going* to become
tenant-configurable, then `z.string()` is right and the issue read model is the
one that is wrong — but that decision is not written down anywhere, and the two
schemas currently disagree silently.

## Minimum change I need

Either direction is fine; what is not fine is the two disagreeing.

- **If priority stays closed:** `board.ts:148` and `events.ts:257` become
  `PrioritySchema.nullable()`. No database change, no migration — the CHECK
  already restricts the column to those six values, so this narrows a type to what
  the data already satisfies. The cast at the board call site disappears and the
  crash becomes unrepresentable.
- **If priority is going to become tenant-configurable:** leave the board and event
  payloads as `z.string()`, change `issue.ts:64` to match, and add a comment on
  `PrioritySchema` saying it is the *seeded* set rather than the closed set — the
  way `type-icon.tsx` does for issue types. Then the runtime fallback below is the
  permanent design rather than a defence.

A `check:enums`-style guard for the general case — a field named identically across
schemas that is an enum in one and a bare string in another — would catch the next
instance of this, and would have caught this one.

## What I did instead for now

Implemented `PriorityIcon` fully. The prop stays `Priority | null` so that a typo
still fails to compile, and the map lookup gained a fallback that renders an
unmapped key as its own label with a neutral glyph. So an unexpected value is a
visible oddity on one card instead of a white screen, which is correct under either
resolution above and is worth keeping even after the types agree —
`docs/product-quality-bar.md` on partial failure: one bad row must not take out the
surface. `apps/web/src/components/data/priority-icon.test.tsx` covers it.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** accepted-with-changes. **Priority stays closed.** The request named two
sites; 47 were narrowed, in 11 modules, and the guard it asked for is
`pnpm check:vocab`.

**Reasoning:**

*On the product question first, because everything else follows from it.* Priority
stays a closed enum of six values. Nothing in the strategy asks for tenant-defined
priorities, `issues.priority` carries a CHECK enforcing exactly those six, and every
UI surface that renders priority renders it as an icon plus a label — which means a
tenant-defined value would arrive with no glyph and no ordering, and ordering is
most of what a priority is *for*. Making it configurable is a real feature with a
real design (a per-project priority scheme, a sort key, a default, a migration for
existing rows); it is not a type widening. So the narrowing direction is the correct
one, and `board.ts` and `events.ts` were the two files that were wrong.

The runtime fallback in `PriorityIcon` stays, and the reason is in
`priority-icon.test.tsx`: the compiler now says that branch is unreachable, and it
still is reachable at runtime — by a tab running yesterday's bundle after a deploy
that adds a seventh priority. A closed enum is a compile-time promise about one
build, not about the two builds that are live during a rollout.

*Then the part that changed the size of the change.* The request's last paragraph is
the whole value of the report:

> A `check:enums`-style guard for the general case … would catch the next instance
> of this, and would have caught this one.

Writing that guard turned two known sites into 47. That is not scope creep; it is
the difference between fixing an instance and fixing the kind, and CLAUDE.md
§"Drift is a family" is the standing instruction to prefer the second. The one
site would have been repaired and the same defect would have stayed in the other
46, in whichever file the next person happened to read.

*The methodological finding, which is the most transferable thing here.* The first
survey I wrote was **structurally blind to most of the contracts.** It inspected the
outermost `z.object` of each exported const — which is what "the schema's own
fields" sounds like it means — and therefore never saw a property inside an
array-of-objects, a nested object, or a `discriminatedUnion` member. Measured
against the same tree: a flat walker sees **601** property sites; the walker in
`check-field-vocabularies.mjs`, which visits *every* `z.object` literal and
attributes each property to the nearest enclosing `const`, sees **1037**. Forty-two
per cent of the contracts were outside the instrument, and **seven** further real
instances of this exact defect were living there — including
`IssueHistoryEntrySchema.changes[].field`, the read-model twin of the very field
this CR is about.

The lesson generalises past this repo: **an audit tool's coverage is a claim that
needs measuring, exactly like the code it audits.** A survey that reports "no
problems in 378 fields" over a 517-field tree is the blind-spot shape CLAUDE.md
§"A check that passes over a blind spot" describes — it licenses the belief that the
vocabulary is clean, and reporting "601 fields, all clean" over a 1037-field tree is
worse than reporting nothing, because nobody re-reads the schemas by hand once a
survey has said they are fine. The field count is now printed on every successful
run, so the number is in the output rather than in someone's memory.

*Where the line was drawn.* **Narrow what exists; propose what does not.** Every
change below is either a pure type strengthening (the values already satisfy the
narrower schema, so no data and no migration is affected) or the enforcement of a
rule that was already written down in a comment. Anything that needed a *new*
branded type, a rename, or a shape change to a stored structure went to a new
change request instead — see "What was deliberately not changed".

**Changes made:**

1. **Three vocabularies moved into `common.ts`**, which is the fix for the cause
   rather than the symptom. `PrioritySchema` and `LinkTypeSchema` lived in
   `issue.ts`; `FieldRefSchema` lived in `query.ts`. In every case the modules that
   could not reach them invented their own — the board spelled priority
   `z.string()`, the event payload wrote link type's five values out inline, and
   four modules spelled a field ref `z.string()`. A vocabulary shared by more than
   one module belongs in the shared module, next to `StatusCategorySchema`, which
   is shared for exactly this reason and never drifted.

2. **Four key vocabularies declared in `ids.ts`** — `IssueTypeKeySchema`,
   `ProjectRoleKeySchema`, `TeamKeySchema`, `FieldKeySchema`. Each already had its
   regex written at the one place that *creates* the row and a bare `z.string()` at
   every place that *reads* it, so the rule was documented and unenforced
   simultaneously. Four names rather than one because two of them share a pattern
   *today*: merging vocabularies on a coincident regex is how a later change to
   issue-type keys silently retypes project-role keys.

3. **`DisplayedFieldChangeSchema` declared in `common.ts`.**
   `IssueHistoryEntrySchema.changes[]` and `SimulationReportSchema`'s per-issue
   preview held **byte-identical** inline copies of the same three-field object,
   both with `field: z.string()`. The change log was described by three vocabularies
   at once.

4. **47 field sites narrowed**, across `automation.ts` (5), `board.ts` (4),
   `events.ts` (19), `field.ts` (2), `import.ts` (1), `issue.ts` (5),
   `permission.ts` (2), `project.ts` (4), `query.ts` (1), `tenancy.ts` (3). Seven of
   them were **inline enums copied from a declared one** — `statusCategory` and
   `fromStatusCategory` (`StatusCategorySchema`), `linkType` (`LinkTypeSchema`),
   `severity` (`ImportFindingSeveritySchema`), the priority map in `import.ts`,
   `orgRole` (`OrgRoleSchema`) and `byActorKind` (`ActorKindSchema`). Every one was
   a value set that would have been extended in one place and not the other.

   Three of the 47 are worth calling out because they are not the same defect:

   - `BoardCardSchema.version` and `IssueSnapshotSchema.version` were
     `z.number().int()` while `AuditStampSchema`, `UpdateIssueSchema` and
     `TransitionIssueSchema` are `.positive()`. `version` is the
     optimistic-concurrency token: a client could read a version it was then unable
     to send back, and the failure would surface as a rejected save on a value the
     server itself produced.
   - `TransitionIssueSchema.transitionId` was a lone `z.string().uuid()` where
     `WorkflowTransitionIdSchema` existed. It appears in exactly one schema, so no
     cross-schema comparison could ever have found it — it was found by reading,
     and it is why the guard's Rule B is a table of *required* schemas rather than a
     disagreement detector.
   - `CapacityForecastSchema.absences[].kind` was `z.string()` where
     `AvailabilityKindSchema` existed. `kind` is a discriminator in sixty other
     places, so no table entry can be written for it; also found by hand.

5. **`scripts/check-field-vocabularies.mjs`** — `pnpm check:vocab`, wired into the
   DB-free `quality` job in CI. Two rules of deliberately different kinds. **Rule A**
   is curation-free: an inline `z.enum([...])` whose sorted value set equals a
   declared enum schema's *is* that schema, spelled out. Nothing to maintain and
   nothing to go stale. **Rule B** is the curated half — 32 field names pinned to
   one schema each — because `z.string()` has no values for Rule A to compare, which
   is precisely why the original defect was invisible.

   Curation rots, so three properties are enforced on the table itself: a table
   entry naming a field that appears in no schema fails; an exception matching no
   site fails; an exception with an empty reason fails. That third one is not
   ceremony — "same name, different concept" is a *claim*, and the next reader needs
   the argument, not the conclusion. The stale-entry rule proved itself on the first
   run, failing on an `eventId` entry whose real field is `triggerEventId`.

   Five exceptions exist and each carries its reason in writing: Temporal's
   `workflowId` (a handle from another system), `AuditEntrySchema.entityType` (the
   audit log covers every entity; the import enum is a much smaller set),
   `SimulationReportSchema.severity` (a dry run's own grading),
   `ImportReconciliationSchema.source` and `FilterNodeSchema.linkType` (both
   deferred to change requests, below). `code` is deliberately **absent** from the
   table: it is five distinct vocabularies in five schemas, and pinning it would
   have made the contract worse while the check called it clean.

   All five rules were negative-tested by planting the exact defect — including
   replanting this CR's original `priority: z.string()`, which the check reports as
   `board.ts:161 — BoardCardSchema.priority is 'z.string()', not PrioritySchema`.
   The script's header names its own blind spots, as every script in `scripts/` now
   does.

6. **Two fixtures corrected, not the schema.** `packages/mocks` shipped
   `issueTypeKey: 'BUG'` in two places — in violation of a pattern that had been
   written in a comment since the schema was authored, and unnoticed for exactly
   that long. Enforcing `IssueTypeKeySchema` made the mocks' own contract-parse
   guard fail, and its message said what to do: *"The contract moved and this
   fixture did not. Fix the builder — do not loosen the schema."*

   This is the clearest evidence in the whole change that **a documented,
   unenforced rule is not a rule.** It also silently degraded the UI:
   `TypeIcon`'s map lookup missed on `'BUG'`, so every bug card in every mock board
   rendered the generic fallback glyph, and the test that covered it had been
   written to assert the case-insensitive behaviour rather than to question the
   fixture. `type-icon.tsx`'s `.toLowerCase()` is now belt-and-braces rather than
   load-bearing; it stays because the prop is typed `string`, so a hand-written call
   site can still pass anything, and a case fold is cheaper than a wrong icon.

**What was deliberately not changed**, and where it went instead:

- **CR-007** — ~22 fields are `z.string().uuid()` where a branded id would be
  right, but the brand does not exist yet (`StateFamilyId`, `SlaPolicyId`,
  `ExportJobId`, and six more). Adding nine branded types is its own change with its
  own blast radius.
- **CR-008** — the six `fieldKey`/`fieldKeys` properties on automation actions and
  transition post-functions are still `z.string()`. Whether they may address a core
  field (`priority`) as well as a custom one decides whether they are *keys* or
  *refs*, and that is a product question, not a typing one. Also carries the
  `ImportReconciliationSchema` `source`/`flux` → `sourceValue`/`fluxValue` rename.
- **CR-009** — `FilterNodeSchema.linked.linkType` is a *directional* vocabulary: it
  includes `blocked_by`, which is the inverse of a link rather than a type of one,
  and omits `causes` and `clones` entirely, so those cannot be filtered on. The fix
  is `LinkTypeSchema` plus a direction, which is a shape change to a **stored**
  filter AST.
- `FieldChangeSchema`'s `fromDisplay`/`toDisplay` stay `.nullable().optional()`
  rather than adopting `DisplayedFieldChangeSchema`, because the event payload also
  carries raw `from`/`to`, and dropping `.optional()` is a compatibility question
  for events already in the outbox.
- Read-model looseness (`labels`, `summary`) is untouched by choice, and the guard
  says so in its header rather than leaving it to look like an oversight.

**Verified:**

```
pnpm check:vocab   ✓ 1037 field(s) across 13 module(s): no inline enum duplicates any of the
                     36 declared ones, all 32 pinned names use one schema, and all 5
                     exception(s) still describe a real site.
pnpm format:check  ✓   pnpm lint  ✓   pnpm typecheck  ✓ (4 packages, declaration emit clean)
pnpm test          ✓ 608 tests — contracts 51, mocks 67, web 490
pnpm check:enums   ✓ 31 contract enums against their CHECK constraints
pnpm check:columns ✓ 27 contract schemas against their tables
pnpm check:errors / :events / :docs / :tsconfigs  ✓
```

The last two matter more than they look: `PrioritySchema` and `LinkTypeSchema`
changed file and 47 fields changed type, so the enum-to-CHECK and field-to-column
audits both had to be re-run against a real Postgres to prove that narrowing 47
types did not put the contracts out of step with the schema. Neither moved.

**Anyone who must pull before continuing:** anyone holding a branch that touches
`packages/contracts` or renders a priority, an issue-type key, a role key, a team
key or a field ref. `pnpm install` is not needed — no dependency changed — but
`pnpm --filter @flux/contracts build` is, because the emitted `.d.ts` is what your
app typechecks against.

Two things will look like breakage and are not:

- A cast that used to be necessary is now an error under
  `@typescript-eslint/no-unnecessary-type-assertion`. Delete the cast; that was the
  point.
- If a fixture or a hand-written literal fails to parse with `issueTypeKey: Invalid`,
  the fixture is wrong. The pattern is lower-case; `'BUG'` was never valid. **Fix
  the value, not the schema** — and if you believe the schema is genuinely wrong,
  that is a change request, which is the rule this file exists to demonstrate.
