# CR-006 — `BoardCard.priority` is a bare string where every other surface uses `PrioritySchema`

| | |
| --- | --- |
| **Raised by** | Claude Code, building the board's data primitives in `apps/web/src/components/data/` |
| **Status** | `open` |
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

**Decision:** <accepted / accepted-with-changes / rejected>

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
