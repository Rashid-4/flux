# Spec — search & FQL

Read [README.md](README.md) first.

| | |
| --- | --- |
| **Branch** | `feat/api-search` |
| **Tables** | `saved_views` |
| **Migrations** | `0008_boards_sprints.sql` |
| **Contracts** | `packages/contracts/src/query.ts` |
| **External** | Meilisearch |

## FQL is an AST, not a string

JQL is a string language, so every consumer has to parse it, the client cannot
validate it before submission, and "which filters reference this field?" is
unanswerable without a parser. FQL (`FilterNodeSchema`) is a structured tree
instead. Consequences, all of which the implementation must preserve:

- The client validates a filter before sending it, and can build a real UI for it.
- `referencedFields()` answers "what does this filter depend on?" statically —
  which is what lets the field audit warn before archiving a field.
- It compiles to parameterised SQL. There is no string to escape, therefore no
  injection surface.
- Phase 4 natural-language querying emits an AST, which can be shown back to the
  user as an editable filter. Emitting a query string would mean the user cannot
  correct the AI's guess.

A text *entry* syntax for power users may exist in the UI, but it parses to an AST
client-side and the API only ever accepts the AST.

## 1. Compiler

`compile(query: Query, ctx) → { sql, params }`.

Hard rules:

- **Every literal is a bind parameter.** No interpolation, ever, including for
  numbers and enums that "cannot be dangerous". The rule has to be absolute or it
  erodes.
- Field refs resolve through the field registry: built-ins map to columns, custom
  fields to `custom_fields @> $n`. An unresolvable ref is
  `422 unknown_field` — never ignored, because a silently dropped clause returns
  **more** rows than the user asked for.
- Reject `filterDepth(node) > 10` with `422 filter_too_deep`. Unbounded nesting is
  a CPU denial-of-service that arrives looking like a power-user feature.
- Cap the clause count similarly.
- Tenant scoping is **not** the compiler's job — RLS does it. Do not add
  `organization_id = ?`; it would imply the isolation lives here, and then someone
  will "optimise" the compiler and take it with them.
- Issue security levels **are** the compiler's job. Emit the restriction into the
  SQL. Filtering after the fetch is a leak waiting for a refactor.

Dynamic subjects (`DynamicSubjectSchema`, e.g. `currentUser`) resolve at compile
time from the request context, never stored resolved — a saved view filtered on
"assigned to me" must mean the viewer, not its author. That distinction is the
whole reason `DynamicSubjectSchema` exists.

Relative dates (`RelativeDateSchema`, `NamedDateSchema`) resolve against the
**user's** timezone, not the server's. "Due today" is wrong for half the world
otherwise.

## 2. Postgres or Meilisearch

| Route to | When |
| --- | --- |
| Postgres | Structured filters, no free text. Authoritative, transactionally consistent. |
| Meilisearch | Free-text terms present. Fast fuzzy ranking. |

Where a query has both, filter in Meilisearch and use it for ranking, then
**re-check permissions against Postgres before returning**. The index is not the
authority on visibility: it lags, and a lagging authority on visibility is a leak.

Meilisearch documents must carry the fields needed to filter by tenant and
project, and every query must constrain on them. Belt and braces: the index has no
RLS.

## 3. Indexing

Consumes `issue.created`, `issue.updated`, `issue.transitioned`, `issue.deleted`,
`comment.*`, `field_layout.updated`.

- Never index inline on the write path.
- Idempotent on `event_id` — delivery is at-least-once.
- Out-of-order events are normal: ordering is guaranteed per aggregate only. Carry
  a version or timestamp and drop a stale update rather than overwriting a newer
  document with an older one.
- Soft-deleted issues are **removed** from the index.
- A full reindex must be resumable and must not require downtime. Build into a new
  index and swap the alias.
- `field_layout.updated` can change what is searchable, which means a partial
  reindex of the affected projects.

## 4. Saved views

`saved_views` stores a `Query` AST, sharing scope, and owner.

- Shared views are visible per project permission, not per whoever saved them.
- A view referencing an archived field must still open, degraded, with the broken
  clause flagged. A view that 500s because a field was archived is how people stop
  trusting saved views.
- Views are used by boards, dashboards and subscriptions, so deleting one in use
  is `409 in_use` with the list of referencing entities.

## 5. Pagination

Cursor-based, opaque, encoding the sort key plus the id tiebreaker. Never `OFFSET`:
it degrades with depth and silently skips or repeats rows when data changes
mid-scroll.

Every sort needs the id as a final tiebreaker or the cursor is not stable.

Hard maximum page size, enforced server-side. Return `totalCount` only when cheap;
an exact count over a large filtered set costs more than the page itself, so
prefer `hasMore`.

## 6. Errors

| Code | Status | When |
| --- | --- | --- |
| `unknown_field` | 422 | Unresolvable field ref |
| `filter_too_deep` | 422 | Depth over the cap |
| `invalid_cursor` | 400 | Malformed or expired |
| `in_use` | 409 | Deleting a referenced view |
| `search_degraded` | 503 | Meilisearch down — structured queries must still work via Postgres |

`search_degraded` matters: free-text degrades, but the product must not become
unusable because the search engine is down.

---

## Definition of done

- [ ] API accepts only the AST; no query-string parser server-side
- [ ] Every literal is a bind parameter, with a test asserting no interpolation
- [ ] Unknown field refs error rather than being dropped
- [ ] Depth and clause-count caps enforced
- [ ] No `organization_id` predicate added by the compiler; RLS does isolation
- [ ] Issue security restrictions emitted into SQL on every path
- [ ] Dynamic subjects resolved per request, not stored resolved, with a test using two different viewers
- [ ] Relative dates resolved in the user's timezone
- [ ] Meilisearch results re-checked against Postgres permissions before returning
- [ ] Indexing is off-event, idempotent on `event_id`, and drops stale out-of-order updates
- [ ] Soft-deleted issues removed from the index
- [ ] Full reindex resumable with an alias swap, no downtime
- [ ] Saved views open degraded when a referenced field is archived
- [ ] Cursor pagination everywhere; no `OFFSET`; id tiebreaker on every sort
- [ ] Structured search still works with Meilisearch stopped, proven by a test
- [ ] Tenant-isolation test through search endpoints, including free-text
