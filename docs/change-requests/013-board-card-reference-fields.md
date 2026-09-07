# CR-013 — `BoardCardSchema` cannot render the reference's card: five fields missing

| | |
| --- | --- |
| **Raised by** | Claude Code, building `apps/web/src/components/board/board-card.tsx` against `UI Images/JIRA 1.webp` and `JIRA 2.webp` |
| **Status** | `accepted` — five fields added, all derived, and one false comment in the same change is the more interesting half |
| **Blocks** | nothing — the fields landed with the card, and `@flux/mocks` supplies them until the endpoint exists |

## What I was implementing

The board card, measured off both reference images at 1× DPR. The requirement is
a carbon copy, so the card's **height is a specification**: the reference's card
measures **255px** for a one-line title and **279px** for two, and every block
inside it has a measured box.

## What the contract says today

`BoardCardSchema` before this change carried the identity, the status, the
assignee, the labels, the parent, `blockedByCount`, `secondsInColumn` and the SLA
state — and nothing the reference's card spends its vertical space on:

```ts
// packages/contracts/src/board.ts:144 (before)
export const BoardCardSchema = z.object({
  id: IssueIdSchema,
  key: IssueKeySchema,
  summary: z.string(),
  issueTypeKey: IssueTypeKeySchema,
  // ... no description, no subtasks, no comment or attachment count
```

## Why that does not work

Not "the card looks sparser". The card is a **different card**, and the number
says so. Measured on the reference, per block:

| Block the reference draws | Measured box | Field it needs |
| --- | --- | --- |
| description, three lines at 23px leading | 69px | `descriptionExcerpt` |
| subtask checklist, 31px row pitch + a 1px inset divider | 62px on a 2-row card | `subtasks`, `subtaskTotal` |
| footer, comment and attachment counters | inside the 69px footer | `commentCount`, `attachmentCount` |

Without those fields the tallest thing a card can be is its title plus its
labels. `board-card.tsx` reproduces 255px exactly — verified in a real browser,
not derived: body 186 (22 + 24 head + 16 + 24 title + 5 + 69 description + 26)
plus footer 69 (1 + 14 + 40 avatar + 14). Take the description out and the 255
becomes 186, which is not a smaller version of the reference's card; it is a
card the reference does not contain.

The alternative — fetch the issue per card — is the 4MB response
`BoardCardSchema`'s own header exists to prevent, times 200.

## Minimum change I need

Five fields, each the cheapest shape that renders its block, and none of them
the full entity:

- `descriptionExcerpt: z.string().max(240).nullable()` — plain text, truncated
  server-side. Not `IssueSchema.description`, which is a rich-text document: 200
  of those is both the payload and 200 parses on first paint. 240 because the
  card shows three lines at ~46 characters and `line-clamp-3` clips the fourth,
  with margin for a narrower column. `null` and `''` are distinct — no
  description versus a description someone emptied.
- `subtasks: z.array(BoardCardSubtaskSchema)` — a new four-field row
  (`id`, `key`, `summary`, `isDone`), **capped by the server**. Not
  `BoardCardSchema` recursively: a card is ~400 bytes and 200 cards × 5 children
  is 1000 of them.
- `subtaskTotal: z.number().int().nonnegative()` — so the card can say how many
  it is not showing instead of silently showing four of nine.
- `commentCount`, `attachmentCount` — `z.number().int().nonnegative()`.

`key` is on the subtask row rather than derived because the row is a link target,
and the board must not have to resolve a child's key from its id.

## What I did instead for now

Nothing was skipped: the fields landed with the card, `@flux/mocks` produces
them, and the card is measured closed. Which is exactly the situation
`CLAUDE.md` warns about — owning both sides removes the friction that made
filing this obviously worth it, and *"a contract quietly widened mid-feature is
indistinguishable from a contract that was never designed."* This file is late
rather than absent, and the next section is why being late still cost something.

---

## Resolution

**Decision:** `accepted` — all five fields, all **derived**. And one comment
added in the same change was false; fixing it is part of this resolution.

**Reasoning:**

The height argument settles the fields themselves. What needed deciding was
where each one comes from, and one of them was decided wrongly and shipped that
way for a commit.

**The false comment.** The added docblock read:

```ts
/** From maintained counters, for the same reason as `blockedByCount`. */
commentCount: z.number().int().nonnegative(),
attachmentCount: z.number().int().nonnegative(),
```

There is no `comments_count` column and no `attachment_count` column. There is
no trigger. `blocked_by_count` is real — `db/migrations/0006_issues.sql:77`, with
`flux_sync_blocked_count()` on `issue_links` at :188 — and the sentence borrowed
its credibility by sitting next to it. Nothing in CI can see this: `BoardCardSchema`
is a read model, so it is not in `check:column-drift`'s PAIRS, and that check
compares field *names* to columns anyway, never a claim in a comment. The lie was
in prose, which is the one place none of the twelve drift checks look.

**And it is a good thing the columns were not added to satisfy it.** Writing the
migration is where the real decision surfaced: `comments.is_internal` exists so a
service-desk guest cannot read agent-only replies. A single `comment_count` column
therefore has no correct value. Count everything and a customer reads "8
comments" while three are visible, which tells them exactly how many replies they
are not allowed to see — a small disclosure, through the one feature that exists
to prevent it. Count only public and every member's card under-reports. The
correct schema is two counters, or one counter plus a per-role adjustment, and
`attachments` adds its own state on top: the counter must exclude
`upload_status = 'pending'`, so the trigger fires on the two-phase `UPDATE` and
not just on `INSERT`/`DELETE` the way `flux_sync_blocked_count()` does.

Migrations here are immutable once applied. Baking a premature answer to the
`is_internal` question into one, before any endpoint exists to be slow —
`services/api` serves `/health` and `/ready` and nothing else — is worse than
carrying the aggregate. So:

> A grouped aggregate over the board's own issue set, joined once per board
> load, is one scan. It is not the N+1 the header forbids. The per-card
> `count(*)` is what that rule is about, and a maintained column is the
> escalation if the scan is ever measured as the board's bottleneck — at which
> point the `is_internal` decision gets made deliberately, by whoever has the
> query in front of them.

The same reasoning makes the other three derived. `descriptionExcerpt` is a
projection of `issues.description`; `subtasks` and `subtaskTotal` are one
window-function query over `issues.parent_id` — `row_number()` for the cap and
`count(*) OVER (PARTITION BY parent_id)` for the total, in the same pass, so the
total costs nothing beyond the join the cap already needs.

**Changes made:**

- `packages/contracts/src/board.ts` — `BoardCardSubtaskSchema` added and
  exported with `BoardCardSubtask`; the five fields added to `BoardCardSchema`;
  the counters' docblock rewritten to say **derived**, to name `is_internal` and
  `upload_status = 'ready'` as the reason, and to point here.
- `packages/mocks/src/board.ts` — fixture values for all five, with
  `mocks.test.ts` asserting them, so the UI has something contract-parsed to
  build against.
- **No migration.** No column and no trigger, deliberately, per the reasoning
  above. `check:columns` stays green because a read model is not paired to a
  table; that is not evidence the fields are backed, and this is the sentence
  saying so.

**Drift kind, for `CLAUDE.md`'s table:** *a contract comment asserting a
**mechanism** — "maintained counter", "by trigger", "denormalised on write" —
that the schema does not implement.* Adjacent to the colour row, where the value
and its documentation were in the same line of the same file, but a layer worse:
a colour comment can at least be re-derived from the CSS beside it, whereas this
one describes a file in another directory that no check reads together with it.
The cheap version of the check is a curated one in `check-column-drift.mjs`'s
Rule-B style — a field whose docblock matches `/maintained|by trigger|
denormalised/` must map to a real column with a trigger on it — and it is worth
writing when the second instance appears, not before; one instance does not
justify a curated list that then rots. Recording the shape is the part that
must not wait, because the next person to write "from the maintained counter"
will be borrowing the same credibility.

**Anyone who must pull before continuing:** anyone rendering a board card, and
anyone about to write the board endpoint — the five fields are yours to compute,
and the counters are two aggregates rather than two column reads.
