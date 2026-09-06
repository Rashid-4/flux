# CR-007 — Nine entity types have no branded id, so ~22 fields are interchangeable `z.string().uuid()`

| | |
| --- | --- |
| **Raised by** | Claude Code, sweeping the contracts for CR-006 (field vocabularies) |
| **Status** | `open` |
| **Blocks** | nothing — every one of these fields works today. This is a class of bug the type system could make impossible and currently does not. |

## What I was implementing

CR-006's general guard, `scripts/check-field-vocabularies.mjs`. Surveying all 1037
property sites in `packages/contracts/src` for "one field name, two types" turned up
a second, adjacent class: **one field name, one type, and that type is the same
unbranded `string` as twenty other entities' ids.**

## What the contract says today

`ids.ts` is unambiguous about why branding exists:

```ts
// packages/contracts/src/ids.ts:3-13
/**
 * Branded id types.
 *
 * Every id in Flux is a uuid, which means without branding they are all
 * mutually assignable and the compiler will happily let you pass a
 * ProjectId where an IssueId belongs. In a domain with ~25 entity types
 * that is not a hypothetical bug — it is a weekly one.
 */
```

Twenty-three entity types have a brand. These nine do not, and their ids are
therefore plain `z.string().uuid()` at every site:

| Entity | Sites | Where |
| --- | --- | --- |
| workflow state *family* | 6 | `workflow.ts:93,107,123,171`, `board.ts:63`, `automation.ts:115,210`, `events.ts:378` |
| automation run | 1 | `automation.ts:305` |
| user availability | 1 | `board.ts:329` |
| project field config | 1 | `field.ts:186` |
| permission grant | 2 | `permission.ts:106` (id), `permission.ts:109` (`subjectId`) |
| export job | 1 | `import.ts:400` |
| workflow publish preview | 2 | `workflow.ts:163` (id), `workflow.ts:204` (`previewId`) |
| issue template | 1 | `issue.ts:176` (`templateId`) |
| SLA policy | 1 | `events.ts:401` (`policyId`) |

Three more are unbranded **on purpose** and should stay that way. They are listed
here so a later reader does not "finish the job" by branding them:

- `EventEnvelopeSchema.aggregateId` (`events.ts:232`) — polymorphic by design;
  `aggregateType` beside it says which entity it points at. Branding it would
  require a union of seventeen brands and buy nothing.
- `AuditEntrySchema.entityId` (`tenancy.ts:319`) — same shape, same reason.
- `ActorSchema.refId` (`common.ts:113`) — "the rule / import job / model that
  acted", i.e. three different entity types depending on `kind`.

`ConfigurationAuditSchema.orphanedSchemes[].schemeId` (`project.ts:328`) is a fourth
of that kind: its sibling `kind` says whether it is a permission scheme or a
workflow scheme.

## Why that does not work

**The failure is a silent wrong answer, not a crash.** `stateFamilyIds` and
`stateIds` are both `string[]` today. A board column configured with state *ids*
where it wants state *families* compiles, passes every test that uses one workflow
version, and then loses its issues the first time a workflow is republished — which
is the exact scenario `WorkflowPublishPreviewSchema` exists to make safe. State
families are the identity that survives a version bump; state ids do not. Six of the
sites above are that one pair.

The permission pair is worse in kind if not in likelihood. `PermissionGrantSchema`
has `id` and `subjectId` adjacent, both `z.string().uuid()`, and `subjectId` is a
user id, a role id, a team id or `null` depending on `subjectKind`. Passing the grant
id where the subject id belongs is a one-character mistake that produces a grant
matching nobody — an access-control rule that silently denies, in a module where the
failure mode nobody notices is the dangerous one.

**And branding is free.** `Brand<T, B>` is a phantom property erased at runtime;
`brandedId()` is `uuid.transform()`. There is no migration, no wire change, no
validation change — the values are already uuids and already validated as uuids. The
only thing that changes is which mix-ups compile.

## Minimum change I need

Nine `Brand` type aliases and nine `brandedId()` schemas in `ids.ts`, then the ~22
sites above:

```ts
export type StateFamilyId = Brand<string, 'StateFamilyId'>
export type AutomationRunId = Brand<string, 'AutomationRunId'>
export type AvailabilityId = Brand<string, 'AvailabilityId'>
export type ProjectFieldConfigId = Brand<string, 'ProjectFieldConfigId'>
export type PermissionGrantId = Brand<string, 'PermissionGrantId'>
export type ExportJobId = Brand<string, 'ExportJobId'>
export type WorkflowPreviewId = Brand<string, 'WorkflowPreviewId'>
export type IssueTemplateId = Brand<string, 'IssueTemplateId'>
export type SlaPolicyId = Brand<string, 'SlaPolicyId'>
```

Two things need deciding rather than typing, which is why this is a change request
and not a commit:

1. **`PermissionGrantSchema.subjectId` cannot be one brand.** It is a `UserId`, a
   `ProjectRoleId`, a `TeamId` or `null` according to `subjectKind`. The honest
   shapes are (a) leave it unbranded and say why, in the same paragraph that names
   `aggregateId` and `refId`; or (b) make the grant a discriminated union on
   `subjectKind` so each member carries the right brand — which is a **shape**
   change to a stored row and to `RELATIVE_SUBJECT_KINDS`' consumers, and would need
   its own request.
2. **`ProjectFieldConfigSchema` carries both `fieldDefinitionId` and `fieldKey`.**
   Branding the id while `fieldKey` stays `z.string()` half-fixes one row; the key
   half is CR-008.

Whichever way (1) goes, the decision belongs in writing, because "this id is
deliberately unbranded" and "nobody got round to branding this id" are
indistinguishable in the source — which is the entire reason the nine above went
unnoticed while twenty-three others were branded.

## What I did instead for now

Nothing, deliberately. CR-006's sweep drew its line at "narrow what exists; propose
what does not", and every brand here is a **new** vocabulary rather than an
unenforced existing one. `pnpm check:vocab`'s table pins the names that already have
a schema; it cannot pin a name to a schema that does not exist, so this class is
invisible to it and stays invisible until the brands are declared. That is the
honest state, and it is recorded here rather than in a comment nobody greps for.
