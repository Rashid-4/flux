# CR-009 — The `linked` filter cannot express `causes` or `clones`, and conflates link type with link direction

| | |
| --- | --- |
| **Raised by** | Claude Code, sweeping the contracts for CR-006 (field vocabularies) |
| **Status** | `open` |
| **Blocks** | nothing today — but it is a **stored** AST in five columns, so the cost of fixing it grows with every saved view, board and automation rule created before it is fixed. |

## What I was implementing

CR-006's narrowing pass. `linkType` is `LinkTypeSchema` at every site in the
contracts after that sweep — except one, and the exception is not a naming slip. It
is a modelling disagreement that the shared name was hiding.

## What the contract says today

Two spellings of "link type", in the same package:

```ts
// packages/contracts/src/common.ts:43 — the type of a link
export const LinkTypeSchema = z.enum(['blocks', 'relates_to', 'duplicates', 'causes', 'clones'])

// packages/contracts/src/query.ts:161 — the `linked` filter operator
z.object({
  op: z.literal('linked'),
  linkType: z.enum(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
  child: FilterNodeSchema,
}),
```

The hand-written `FilterNode` TS type at `query.ts:129` carries the same four values
and must change in lockstep — the schema is `z.ZodType<FilterNode>`, so the two are
asserted equal by the compiler.

The read model already models this correctly, which is what makes the filter's
version look like the accident it is:

```ts
// packages/contracts/src/issue.ts:121-125
links: z.array(
  z.object({
    linkType: LinkTypeSchema,
    /** 'outward' = this issue blocks the other; 'inward' = it is blocked. */
    direction: z.enum(['outward', 'inward']),
```

## Why that does not work

**Three distinct defects, and only the third is cosmetic.**

**1. Two link types cannot be filtered on at all.** `causes` and `clones` are absent.
There is no query, saved view, board filter, automation condition or transition
condition that can select "issues that cause this one" — the data exists, the read
model displays it, and the query language has no word for it. A user who links two
issues with `causes` and then tries to build a view over that relationship gets no
error and no results, because the operator they need is not in the grammar. Nothing
tells them why.

**2. `blocked_by` is a direction wearing a type's clothes.** There is no `blocked_by`
row in `issue_links`; the inverse of `blocks` is the same row read from the other
end. So the filter's four values are three types plus one direction, which means:

- the inverse of `relates_to` and `duplicates` is unreachable — `duplicated_by` has
  no spelling, even though `duplicates` is not symmetric;
- the implementation of `linked` must special-case exactly one value, and a
  special case in a query planner is where the wrong join direction lives;
- `referencedFields()` and `filterDepth()` in `query.ts` treat `linked` uniformly,
  so nothing in the shared logic notices the asymmetry either.

**3. It is the last exception in `check:vocab` that describes a real defect rather
than a real distinction.** The guard's other four exceptions are genuine
"same name, different concept" cases. This one is "same name, same concept, worse
model", and it is exempted only because fixing it is a shape change rather than a
type change. That is worth stating in the exception's reason, and it is —
`scripts/check-field-vocabularies.mjs` says so and cites this file.

**Why the clock matters.** `FilterNodeSchema` is persisted as `jsonb` in
`boards.filter`, `saved_views.filter`, `workflow_transitions.conditions` and the
automation rule tables, and it is embedded in fifteen other contract schemas
(`board.ts` swimlanes, `field.ts` `visibilityRule` / `requirementRule`,
`automation.ts` triggers, conditions and targets). Changing the *shape* of a node
after rows exist means a data migration over every one of those columns. Changing it
now means editing an enum. This is the cheapest it will ever be.

## Minimum change I need

Replace the four-value enum with the model the read side already uses:

```ts
z.object({
  op: z.literal('linked'),
  linkType: LinkTypeSchema,
  /** Which end of the link this issue is on. 'outward' = this issue blocks /
   *  causes / duplicates the matched one; 'inward' = the reverse. */
  direction: z.enum(['outward', 'inward', 'either']).default('either'),
  child: FilterNodeSchema,
}),
```

and the same on the hand-written `FilterNode` union.

Three decisions inside that, none of them mine to make alone:

1. **Is `either` a value?** It has no analogue in `IssueDetailSchema.links`, where
   every row has a concrete direction. But "any issue related to this one, in either
   direction" is the query people actually write, and without it the UI has to emit
   an `or` of two `linked` nodes — which doubles the depth against
   `filterDepth()`'s limit and reads badly in a filter builder. I would include it,
   defaulted, precisely because it is the common case.
2. **Migration of existing rows.** `blocked_by` becomes
   `{ linkType: 'blocks', direction: 'inward' }`, and the other three become
   `direction: 'either'` — which is a *behaviour change* for saved filters, from
   "outward only, by accident of implementation" to "either". The alternative,
   defaulting them to `outward`, preserves today's behaviour and is probably wrong
   for what the author meant. Whichever is chosen, it needs a migration in
   `db/migrations/` that rewrites the stored ASTs, not a read-time shim — a
   read-time shim is how two readings of the same stored row end up in two
   services.
3. **Whether `direction` belongs on the `cmp` operator too**, for
   `parent.status`-style one-hop refs. Probably not, but it should be answered
   rather than discovered.

If the decision is that `either` is not wanted and the migration is not worth it,
the acceptable minimum is still adding `causes` and `clones` — because a query
language that cannot express two of its own link types is a gap a user hits, not a
tidiness complaint.

## What I did instead for now

Left it exactly as it is, and recorded the reason in the one place a machine
re-checks: `EXCEPTIONS` in `scripts/check-field-vocabularies.mjs`, whose entry for
`FilterNodeSchema.linkType` states the directional argument and cites this file. The
check fails if that exception ever stops matching a real site, so the exemption
cannot outlive the defect silently. `apps/web` builds nothing against the `linked`
operator yet, so no UI work is waiting on this.
