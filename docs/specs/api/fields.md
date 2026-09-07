# Spec — fields

Read [README.md](README.md) first.

| | |
| --- | --- |
| **Branch** | `feat/api-fields` |
| **Tables** | `field_definitions`, `project_field_configs`, `issue_templates` |
| **Migrations** | `0004_fields.sql` |
| **Contracts** | `packages/contracts/src/field.ts` |
| **Values live in** | `issues.custom_fields` (jsonb) |

## What this replaces

Jira needs four layers to answer "which fields does this issue show?" — screens,
screen schemes, issue type screen schemes, and field configuration schemes. The
consequence is not just administrative pain: it makes the question genuinely hard
to answer, so teams stop trying and accumulate hundreds of near-duplicate custom
fields.

Flux has two layers:

- **`field_definitions`** — an org-level library. One "Story Points" field, reused.
- **`project_field_configs`** — per project and issue type, which fields appear,
  in what order, required or not.

That is the whole model. Keep it that way; every additional layer of indirection
here costs a real support burden later.

## 1. Values are jsonb, not EAV

`issues.custom_fields` is a single jsonb column keyed by `field_definitions.key`.
See `docs/adr/0006-custom-fields-jsonb-not-eav.md`.

- Filtering uses containment (`@>`) against the `jsonb_path_ops` GIN index. That
  index is ~3× smaller and faster than the default for containment, at the cost of
  not supporting key-existence queries — an acceptable trade because field keys are
  always known from `project_field_configs`. Do not write `?` / `?&` key-existence
  queries against it and expect the index to help.
- Never `SELECT` the whole jsonb to filter in application code.
- A field's `key` is immutable once any issue holds a value for it. Renaming the
  key orphans every value silently. Names are editable; keys are not.

## 2. Reads and writes of values

### 2.1 Where the layout comes from — `GET /projects/:projectKey/field-layout`

Response `ProjectFieldLayout`: `{ projectId, configs, definitions }`.

Both helpers below take a `layout`, and until this endpoint was specified nothing
returned one. That was the severe half of
`docs/change-requests/011-issue-view-read-model-gaps.md`, and it is a correctness
gap rather than a missing feature. `ProjectFieldConfigSchema` was well designed and
**unreachable**: no endpoint returned it, `ProjectDetailSchema` did not carry it, and
`IssueDetailSchema` carried the *values* without the definitions needed to render
any of them. So `valueSchemaFor` — exported specifically for a client to validate
with, and the mechanism §2 relies on to "show the same error before submitting" —
took a `FieldConfig` no client could obtain, and §4's declarative visibility AST,
whose whole argument is *one definition drives both sides*, had one side.

- **`configs`** in `position` order, for **every** issue type in the project.
  `issueTypeId: null` means every type. The client filters locally, because changing
  the issue type in a create form must not be a network round trip.
- **`definitions`**, every one referenced by `configs`, exactly once. Two arrays
  rather than one denormalised list: a definition is shared by every issue type that
  shows the field, and inlining it per config repeats a 40-option select's options
  once per type.
- A config whose definition is missing from `definitions` is a **server bug**, not a
  case for the client to degrade around — it would render a labelled input that
  cannot be validated. Assert it in a test.

Its own endpoint rather than a key on `IssueDetail`, for three reasons that point
the same way: it belongs to `(project, issueType)` and not to an issue, so inlining
repeats project-level data on every issue in the project; it is the *same answer*
for every issue the user opens, so it caches for the session and the second issue
view is faster than an inlined version; and the create form needs it before any
issue exists.

Cache it hard — `ETag` plus a long `max-age` on a `private` response — and bust it
on `field_layout.updated` (§8). It changes when an administrator edits a project's
layout, which is orders of magnitude rarer than reading it.

`defaultValue` is `unknown` in the contract because its type is whatever the field's
own type says. Validate it with `valueSchemaFor` before returning it: a stored
default that no longer satisfies its field's config — because someone tightened a
`max` or archived the option it names — must be reported as a configuration problem
in §5's audit, not silently shipped to a create form that will then fail to submit.

### 2.2 The helpers

Expose one helper used by every module that touches custom fields, and use it
everywhere:

```
readValues(issue, layout)            → validated, typed, ordered for display
writeValues(existing, patch, layout) → merged jsonb, or a list of problems
```

`writeValues` rules:

- Validate each value against `valueSchemaFor(fieldDefinition)` from
  `@flux/contracts`. That function is shared with the UI so the form shows the same
  error before submitting.
- Unknown keys are **rejected**, not dropped. Silently dropping a value means a
  client bug looks like a successful save and the data is simply gone.
- Absent key = unchanged. Explicit `null` = cleared. This distinction is the same
  one the issues spec requires and it must be implemented once, here.
- Required fields are checked against the **layout for that issue's type**, not
  globally. A field required on Bug is not required on Task.
- Report **every** problem at once. A form that reveals one validation error per
  submit is a specific thing users hate about the product being replaced.

## 3. Field types

Each type in `FieldTypeSchema` needs storage, validation, and filter semantics
defined together. Notably:

- `select` / `multi_select` store option **ids**, never labels. Storing labels means
  renaming an option rewrites history.
- Deleting an option that is in use is `409 in_use`. Offer deactivation
  instead: an inactive option cannot be chosen on new issues but still renders on
  the issues that hold it.
- `user` / `multi_user` store user ids and must resolve to `UserRef` on read. A
  removed org member still renders, marked inactive — a blank assignee on a
  three-year-old issue destroys the audit narrative.
- `number` stores `numeric`, not float, where the field is used for anything
  summed.
- `date` vs `datetime` are distinct types. Storing a date as a timestamp introduces
  a timezone bug that appears as off-by-one-day for exactly the users furthest from
  UTC.
- `cascading_select` validates that the child option belongs to the chosen parent.

## 4. Visibility rules

A field can carry a declarative visibility rule AST: show this field when another
field has a given value. Same rule engine constraints as workflows — declarative,
evaluable on the client, no expression strings.

Evaluate on the server too. A hidden-but-writable field is an integrity hole: the
API must reject a value for a field whose visibility rule is false, or "hidden"
means nothing.

## 5. Configuration audit — the anti-sprawl feature

`GET /organizations/:id/field-audit` → `ConfigurationAuditSchema`.

This is the feature that stops Flux becoming what it replaces. Report:

- `unusedFields` — defined, on no layout, or on layouts but with no values. Include
  a recommendation and a value count, so archiving is an informed decision.
- `probableDuplicateFields` — grouped by normalised name and identical type
  ("Story Points" / "story points" / "StoryPoints"). This is the single most
  valuable output: duplicate fields are how a clean instance becomes unusable, and
  they are invisible until someone goes looking.
- `unusedIssueTypes`, `deadWorkflowStates`, `orphanedSchemes`.

Read-only. It recommends; it never deletes. An audit tool that deletes things is an
audit tool people are afraid to run.

Because rules are ASTs, "which rules reference this field?" is answerable
statically — include that in the report so archiving a field cannot silently break
a workflow condition or an automation rule.

## 6. Issue templates

`issue_templates` prefills fields for an issue type. Applied at create time,
server-side, so a template change does not retroactively alter existing issues.
Validate the template's values against the current layout when the template is
saved, and again on apply — a layout can change after a template is written.

## 7. Errors

| Code | Status | When |
| --- | --- | --- |
| `not_found` | 404 | Unknown field id or key |
| `identifier_immutable` | 409 | Changing a key that has values |
| `field_value_invalid` | 422 | Value fails `valueSchemaFor` |
| `required_field_missing` | 422 | List all, not the first |
| `unknown_field` | 422 | Value for a field that is on no layout, or does not exist |
| `in_use` | 409 | Deleting a field with values or referenced by a rule, or an option with values |
| `field_not_writable` | 422 | Value for a read-only field, or one whose visibility rule is false |

`in_use` covers both the field and the option case, and the difference goes in
`blockedBy` — the issues, rules or views that hold a value. Populate it, and set
`blockedByTotal`: "used by 3 issues" and "used by 3 of 14,000" lead to different
decisions, and only one of them is honest. A bare "this field is in use" is a
refusal the admin cannot act on, which is how a field library silently accumulates
fields nobody dares touch.

## 8. Events

`field.created`, `field.updated`, `field.archived`, `field_layout.updated`,
`field_option.deactivated`.

Search reindexes off `field_layout.updated` — changing a layout changes what is
searchable.

---

## Definition of done

- [ ] Two layers only: `field_definitions` + `project_field_configs`. No third indirection added
- [ ] `GET /projects/:projectKey/field-layout` returns `ProjectFieldLayout`, with every config's definition present exactly once, asserted by a test
- [ ] The layout is one query per array, not one per config, proven by a query count assertion
- [ ] A stored `defaultValue` that no longer satisfies its field's config is reported by §5's audit and not returned as a usable default
- [ ] Custom field values read and written through one shared helper, used by every module
- [ ] `valueSchemaFor` from `@flux/contracts` is the only validator
- [ ] Unknown field keys rejected, never silently dropped
- [ ] Absent vs explicit-null distinguished, with a test
- [ ] All validation problems returned at once
- [ ] Required-ness resolved per issue type, not globally
- [ ] Field `key` immutable once values exist
- [ ] Select options stored as ids; deactivation offered instead of deletion
- [ ] `date` and `datetime` distinct; a timezone test covers a user at UTC−11
- [ ] Filtering uses containment against the jsonb_path_ops index; no key-existence queries relying on it
- [ ] Visibility rules enforced server-side; writes to hidden fields rejected
- [ ] Field audit reports duplicates by normalised name and type, and never deletes
- [ ] Audit reports which rules reference a field before it is archived
- [ ] Templates validated at save and at apply
- [ ] Integration tests against real Postgres
- [ ] Tenant-isolation test through this module's endpoints
