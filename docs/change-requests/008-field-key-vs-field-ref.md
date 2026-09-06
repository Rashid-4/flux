# CR-008 — Is a `fieldKey` a key or a ref? Six sites cannot be typed until someone decides

| | |
| --- | --- |
| **Raised by** | Claude Code, sweeping the contracts for CR-006 (field vocabularies) |
| **Status** | `open` |
| **Blocks** | nothing today. It blocks the *last* six sites of CR-006 — the only ones that sweep could not close — and it decides whether automation can set a core field at all. |

## What I was implementing

CR-006's narrowing pass: giving every field that denotes one concept the one schema
that describes it. Forty-seven sites closed. Six did not, because the right schema
depends on a product question nobody has answered in writing.

## What the contract says today

Two vocabularies exist and both are now named:

```ts
// packages/contracts/src/common.ts:64 — a REF: may be prefixed or relation-qualified
export const FieldRefSchema = z.string().regex(/^(cf:)?[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/)

// packages/contracts/src/ids.ts:142 — a KEY: never prefixed, never qualified
export const FieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
```

Six sites address a field and use **neither**:

```ts
// packages/contracts/src/automation.ts:140-141   (automation actions)
z.object({ kind: z.literal('set_field'),   fieldKey: z.string(), value: z.unknown() }),
z.object({ kind: z.literal('clear_field'), fieldKey: z.string() }),
// packages/contracts/src/automation.ts:211      (the same action inside a simulation)
// packages/contracts/src/workflow.ts:80-81      (transition post-functions)
// packages/contracts/src/workflow.ts:59          (a validator)
z.object({ kind: z.literal('required_fields'), fieldKeys: z.array(z.string()).min(1) }),
// packages/contracts/src/field.ts:191            (denormalised beside its own id)
  fieldDefinitionId: FieldDefinitionIdSchema,
  fieldKey: z.string(),
```

## Why that does not work

**The question is not cosmetic: it decides a feature.** If `fieldKey` is a
`FieldKeySchema`, then `set_field` addresses a `field_definitions.key`. If it is a
`FieldRefSchema`, it can also be `cf:severity` or — the part that matters —
`parent.status`, i.e. an automation rule that writes to a *related* issue's field.
Those are different products, and today's `z.string()` is what lets an
implementation pick either one by accident and be right by nobody's decision.

**The evidence points both ways, which is why it needs deciding rather than
looking up.**

Toward *key*: `db/migrations/0004_fields.sql:35-37` says `field_definitions.is_system`
is `true` for the built-in fields — "priority, story_points…" is the comment's own
example. So a core field **does** have a `field_definitions` row, and therefore a
key, and `set_field` with `fieldKey: 'priority'` is coherent under
`FieldKeySchema` alone. `field_definitions_key_key` is UNIQUE on
`(organization_id, key)`, so a tenant cannot mint a custom field that collides with
a system one either. On that reading `FieldKeySchema` is complete and the `cf:`
prefix is a *query-language* device, not an identity device.

Toward *ref*: `FieldRefSchema`'s own doc comment says `cf:severity` →
`field_definitions.key` and `status`/`assignee`/`project` → **core columns** — i.e.
it treats the two as different namespaces, prefix-disambiguated. If that is the
truth, then a bare `priority` in a `fieldKey` is ambiguous between the column and a
hypothetical row, and a rule addressing a custom field must write `cf:severity`,
which `FieldKeySchema` rejects.

**Both cannot be true.** Either every field is a `field_definitions` row and the
prefix is decoration, or core fields are not rows and the prefix is load-bearing. The
contracts currently assert the first in SQL and the second in a comment, and the six
`z.string()` sites are where that contradiction is parked.

The concrete failure if it is guessed wrong: an automation rule saved as
`set_field: { fieldKey: 'cf:severity' }` under one reading is stored, accepted, and
then matches no field under the other — a rule that runs, reports success, and
changes nothing. `docs/product-quality-bar.md` §13: a control that silently does
nothing is worse than one that says why it cannot.

`ProjectFieldConfigSchema.fieldKey` is the one site that is *not* ambiguous: it sits
beside `fieldDefinitionId`, so it is that definition's key, denormalised for display.
It is `FieldKeySchema` either way. It is listed here only so the six move together
rather than one being fixed and five left.

## A second, unrelated rename in the same file

`ImportReconciliationSchema.spotChecks[].mismatchedFields` is:

```ts
// packages/contracts/src/import.ts:351
z.object({ field: FieldRefSchema, source: z.string(), flux: z.string() })
```

`source` here is **a field's value as it stood in the source system**, sitting beside
`flux`, which is the same field's value here. Everywhere else in `import.ts` —
`ImportJobSchema.source`, `StartImportSchema.source` — `source` is
`ImportSourceSchema`, the *system* being imported from (`jira_cloud`, `linear`, …).
Same word, two concepts, one file. It is the fifth entry in
`scripts/check-field-vocabularies.mjs`'s exception list and the only one whose reason
is "the names are the defect".

Proposed: `sourceValue` / `fluxValue`. No behaviour changes; it removes an exception
from the guard instead of documenting it forever, and it stops the next reader from
inferring that a reconciliation diff carries an `ImportSource`.

## Minimum change I need

A decision on one sentence, then five minutes of typing:

> A `fieldKey` on an automation action, a transition post-function or a transition
> validator may address **{ a custom field only / any field including core / any
> field, and a one-hop relation }**.

- "custom only" → `FieldKeySchema`, and `set_field` cannot touch `priority`, which
  contradicts `is_system` existing at all.
- "any field including core" → `FieldKeySchema`, and the `cf:` prefix is documented
  as query-language-only. **This is the reading I would take**: it is what the
  schema in 0004 already implements, it needs no migration, and it keeps a write
  target unambiguous — one namespace, one unique index, one key.
- "any field plus one-hop relations" → `FieldRefSchema`, and then the automation
  engine needs a documented rule for what `parent.status` means as a *write* target
  (does it transition the parent? through the parent's workflow? with whose
  permissions?). That is a feature, not a type.

Plus the `sourceValue`/`fluxValue` rename, which needs no decision.

## What I did instead for now

Left all six as `z.string()` and wrote the reason at the place someone will look:
`FieldKeySchema`'s doc comment in `ids.ts` says explicitly that the `fieldKey`
properties are **deliberately** not narrowed to it yet, and cites this file. So the
gap is now labelled rather than looking like an oversight — the distinction CR-007
argues is the whole difference between a deliberate omission and a forgotten one.
