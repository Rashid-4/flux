# CR-004 — entity colour palette for avatars

| | |
| --- | --- |
| **Raised by** | UI agent — `apps/web` primitives (`components/data/UserAvatar`) |
| **Status** | `resolved` — accepted with changes. Sixteen `--entity-*` tokens shipped; the proposed values did not. |
| **Blocks** | nothing. `UserAvatar` paints all eight tones as of this resolution. |

## What I was implementing

Flux-level `<UserAvatar>`: initials from `UserRef.displayName`, a hash-stable tone so Ada is always the same colour across the board / comments / the topbar, and a greyed treatment when `isInactive`.

## What the contract says today

There is no contract type for this — it is a token gap. `apps/web/src/design/tokens.css` deletes Tailwind's default 22-hue palette (`--color-*: initial`) and `COLOR_KEYS` in `apps/web/src/design/theme-keys.ts` has surface / fg / status / primary / contrast / danger / …, **no `entity-*` hues**. `ui/avatar` is explicit that per-user colour is not its job.

A later `bg-blue-200` or `bg-[#dbe4fe]` in `UserAvatar` is a lint error (`no-restricted-syntax` hex / arbitrary colour) and would also fail `design/palette.test.ts`.

## Why that does not work

Hashing `UserId` onto a hue needs a hue palette. Without one, every avatar is the same grey. That is readable (7.41:1 / 6.97:1 on `surface-2`) but it is not the product: a board column of five assignees is un-scanable, and the inactive treatment (`opacity-50`) is the only remaining differentiator.

Inventing eight hex values in the component would:

1. Fail lint.
2. Skip the measured-ratio comment that every other pair in `tokens.css` carries.
3. Drift from `theme-keys.ts`, so `cn('bg-entity-3', 'bg-entity-4')` would not merge.

## Minimum change I need

Eight named pairs in `tokens.css` **and** `theme-keys.ts`, both themes, with the measured sRGB WCAG ratio in a comment beside each. Suggested names and measured pairs (text on fill; all ≥ 4.5:1, so 11px initials stay AA):

| Token | Light bg / fg | Light ratio | Dark bg / fg | Dark ratio |
| --- | --- | --- | --- | --- |
| `entity-0` | `#dbe4fe` / `#1e3a8a` | 8.16:1 | `#1e3a8a` / `#dbe4fe` | 8.16:1 |
| `entity-1` | `#ccfbf1` / `#115e59` | 6.73:1 | `#134e4a` / `#ccfbf1` | 8.41:1 |
| `entity-2` | `#dcfce7` / `#14532d` | 8.30:1 | `#14532d` / `#dcfce7` | 8.30:1 |
| `entity-3` | `#fef3c7` / `#78350f` | 8.15:1 | `#78350f` / `#fef3c7` | 8.15:1 |
| `entity-4` | `#ffedd5` / `#9a3412` | 6.38:1 | `#9a3412` / `#ffedd5` | 6.38:1 |
| `entity-5` | `#ffe4e6` / `#9f1239` | 6.68:1 | `#9f1239` / `#ffe4e6` | 6.68:1 |
| `entity-6` | `#ede9fe` / `#5b21b6` | 7.57:1 | `#5b21b6` / `#ede9fe` | 7.57:1 |
| `entity-7` | `#e2e8f0` / `#1e293b` | 11.87:1 | `#1e293b` / `#e2e8f0` | 11.87:1 |

Utilities: `bg-entity-0` … `bg-entity-7` and `text-entity-0-fg` … (or `entity-0` / `entity-0-fg` matching `primary` / `primary-fg`). Ratios were computed from sRGB relative luminance, same method as the comments in `tokens.css`. Architecture should re-measure against the actual `surface` each avatar sits on (`surface` and `canvas`) before committing — a fill that is 8:1 with its own fg can still fail SC 1.4.11 as a 24px graphic against its neighbour.

Inactive stays a separate signal (`opacity-50` + `(inactive)` in the accessible name). Do not reuse `entity-*` for that; Linus must not look like a seventh hue.

## What I did instead for now

`<UserAvatar>` hashes `UserRef.id` into `data-tone="0"…"7"` and paints every tone with `bg-surface-2 text-fg-muted`. When these tokens land, the component can map `data-tone` onto `bg-entity-N text-entity-N-fg` without a layout shift. `tokens.css` was not edited.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** accepted-with-changes. **The gap is real and the request's shape was
right; every one of its sixteen hex values was rejected on measurement.** Sixteen
`--entity-*` tokens now exist in both themes, in `tokens.css` and `theme-keys.ts`,
each with its measured ratio beside it — and none of them is a value from the table
above.

**Reasoning:**

*The binding instruction in the request was to re-measure before committing, and
that is what changed the answer.* The request measured each fill against its own
foreground, where all eight pass comfortably (6.38–11.87:1). It did not measure the
fills against the surfaces an avatar actually sits on. Measured:

| Proposed light fill | vs `--surface` | vs `--canvas` | vs `--surface-2` | vs `--surface-3` |
| --- | --- | --- | --- | --- |
| `#dbe4fe` | 1.27 | 1.12 | 1.19 | 1.14 |
| `#ccfbf1` | 1.13 | 1.01 | 1.06 | 1.01 |
| `#dcfce7` | 1.10 | 1.03 | 1.03 | 1.01 |
| `#fef3c7` | 1.11 | 1.02 | 1.05 | **1.00** |
| `#ffedd5` | 1.15 | 1.01 | 1.08 | 1.03 |
| `#ffe4e6` | 1.20 | 1.06 | 1.13 | 1.08 |
| `#ede9fe` | 1.19 | 1.05 | 1.12 | 1.07 |
| `#e2e8f0` | 1.23 | 1.09 | 1.16 | 1.11 |

Four of the eight are within 1.03:1 of a hover row. `#fef3c7` on `--surface-3` is
**1.00:1** — the disc and the row it is hovering are, to two decimals, the same
colour. On the light board, which is the surface most of these avatars live on, the
palette would have looked like a bug: the initials visible, the disc absent, and
which of the eight you got decided by whether the mouse happened to be over the row.

The dark half has the same defect at one entry: `#1e293b` measures **1.03:1** against
`--surface-3` and 1.10:1 against `--surface-2`.

*Why this is not an SC 1.4.11 failure, and what the real floor is.* The disc carries
no information — the initials do, and those are 6.19:1 in light and 6.75:1 or better
in dark. So the fill is exempt under the same reading `--border` already relies on,
and it is worth being explicit that **no** eight-hue light palette at initials-legible
lightness could clear 3:1 against white; Jira's, Linear's and GitHub's all measure
between 1.1 and 1.7:1. The requirement is therefore a design floor rather than a WCAG
one: the disc must be *visibly a coloured disc*. The shipped palette's worst case is
**1.51:1** on `--surface`, **1.42** on `--surface-2`, **1.36** on `--surface-3` and
**1.34** on `--canvas`; dark is 1.87 / 1.70 / 1.50 / 2.06. Those four numbers are
recorded in the group comment in `tokens.css` and asserted exactly — not as
inequalities — by `design/contrast.test.ts`, so lightening a surface by one step
fails a test rather than quietly erasing the avatars.

*Constructed rather than sampled.* The proposed palette is Tailwind's default scale
by another name — `blue-100`/`blue-900`, `teal-100`/`teal-800`, `slate-200`/`slate-800`
— which is the vocabulary `--color-*: initial` deletes on purpose. Copying eight of
them back in by hand reintroduces it one value at a time, with the drift that implies:
their lightnesses range over L 0.87–0.96 and their chromas over 0.02–0.09, so some
people would have read as vividly coloured and others as barely tinted. `#e2e8f0` is
the clearest case — it sits 1.16:1 from `--surface-2`, so entity-7 would have read as
*no colour assigned* rather than as a person.

What shipped is four numbers per theme instead of sixteen hexes: one lightness and one
chroma per role, times eight hues. Equal weight is then structural rather than
something to check by eye — no tone can be the "important" one — and
`contrast.test.ts` asserts the construction (one distinct L, one distinct C per role,
the same eight hues in both themes), so a future hand-edit to a single tone fails.
Three of those four numbers were themselves set by measurement:

- **Chroma is a gamut ceiling, not a taste.** 0.06 for fills and 0.062 for
  foregrounds is the most that keeps all sixteen inside sRGB; teal at h 190 binds it
  with 0.0044 of headroom. Above that the browser gamut-maps and the declared colour
  stops being the painted one.
- **Dark lightness 0.4 is a floor, not a choice.** The first attempt at 0.305 measured
  **1.04:1** against `--surface-3` — the same defect as the request's, found the same
  way.
- **The hue gaps are deliberately uneven (38–58°)** because OKLCH hue is not
  perceptually uniform: 45° buys a lot of separation through the blues and almost
  none through the yellow-greens. Widest where the eye is least sensitive.

Names are indices (`entity-0`…`entity-7`), not colour or role names. A hue that means
"this is Ada" means nothing else, and `entity-blue` would invite exactly the misuse the
status family exists to serve.

*Inactive.* Honoured as specified, and now enforced rather than promised: Linus keeps
the hue his id hashes to and is dimmed over it, with `(inactive)` in the accessible
name carrying the meaning that opacity cannot. `user-avatar.test.tsx` asserts both.

*Two findings that came out of the measurement rather than the request.* Building the
instrument mattered more than the palette, and both belong in CLAUDE.md's "drift is a
family" table as new members:

1. **A colour value whose comment describes a colour the browser does not paint.**
   `--primary-soft` and `--danger-soft-fg` were outside sRGB — by 0.0024 and 0.0009 —
   so both were being silently gamut-mapped. Fixed by dropping one chroma step each;
   the painted hex is identical, the reliance on a clip is gone. Six further hexes in
   comments had drifted from their values, and one component comment overstated a
   ratio (`button.tsx`: 4.9:1 claimed, 4.80:1 measured). None of these was visible to
   `tsc`, to review, or to the three design tests that already existed.
2. **Test files were generating production CSS.** With no `@source` directive,
   Tailwind v4 scans `*.test.tsx` too — `.h-40` and `.h-80` were in the shipped
   stylesheet and appear in no component. Two dead rules are harmless; the mechanism
   is not, because a test that spells out the eight `bg-entity-N` names would make
   Tailwind emit them from the *test*, and a component regressed to
   `bg-entity-${tone}` would still paint correctly in the browser and in every
   screenshot. `tokens.css` now excludes test files from the scan (verified: the two
   rules are gone, all sixteen entity utilities remain, and the stylesheet is 1.8 kB
   smaller).

**Changes made:**

- `apps/web/src/design/tokens.css` — sixteen `--entity-*` tokens in `:root` and
  `.dark`, sixteen `--color-entity-*` mappings in `@theme inline` (written out, not
  generated), the group comments recording the construction and the visibility floor,
  the two gamut fixes, the six corrected hexes, the light Text and Status blocks
  restructured so every claim is machine-checkable, and `@source not '../**/*.test.{ts,tsx}'`.
- `apps/web/src/design/theme-keys.ts` — sixteen names added to `COLOR_KEYS` (now 64),
  so `cn('bg-entity-3', 'bg-entity-4')` merges.
- `apps/web/src/design/oklch.ts` + `oklch.test.ts` — the OKLCH→sRGB→WCAG converter and
  **28 tests** whose every expected value comes from outside this repository.
- `apps/web/src/design/contrast.test.ts` — **31 tests** that re-derive every hex and
  every ratio `tokens.css` claims, from `tokens.css`.
- `apps/web/src/design/read-tokens.ts` — the shared CSS reader, now used by both
  `theme-keys.test.ts` and `contrast.test.ts` rather than a second copy of the parser.
- `apps/web/src/components/data/user-avatar.tsx` — the literal `TONE_CLASSES` table,
  `TONE_COUNT` derived from its length, applied to `AvatarFallback`.
- `apps/web/src/components/ui/avatar.tsx` — the stale justification for the neutral
  fallback replaced with the surviving reason (this primitive draws teams, projects
  and webhooks too, and only one of those has an identity to hash).
- `apps/web/src/components/ui/button.tsx` — 4.9:1 corrected to 4.80:1.
- `apps/web/src/components/data/user-avatar.test.tsx` — all eight tones rendered and
  read back, the neutral pair asserted *displaced* rather than merely overridden, and
  the inactive treatment asserted to keep its hue.

**Anyone who must pull before continuing:** anyone rendering a person, a team or any
other identity — `bg-entity-N text-entity-N-fg` is the pair, `data-tone` is the
attribute, and the disc must never be the only way to tell two people apart. Anyone
writing a test that asserts on a class name should also know that test files no longer
contribute to the generated stylesheet, which is the correct direction but does mean a
class introduced in a test alone now emits nothing.
