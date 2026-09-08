# CR-014 — The reference is not set in Inter

**Status:** open · **Raised by:** the reference-match pass on `feat/ui-reference-match` · **Affects:** `apps/web/package.json` (a dependency), `apps/web/src/design/tokens.css` (`--font-sans`), every measured cap height in `docs/specs/web/shell.md` §3.1

## What was being done

Matching `apps/web` to `UI Images/JIRA 1.webp` and `JIRA 2.webp` pixel for pixel. After
the colour and geometry passes, a 4× crop of the reference's card title beside flux's
own — `/tmp/crops/type-4x.png` in the session that raised this — shows the one
difference that no token can close: **the typeface**.

The reference's face has a single-storey `g` with a hooked descender, an angled cut
on the top of `t`, round `e` and `a` bowls and noticeably wider advance widths than
Inter at the same cap height. Inter's `g` is also single-storey but its `t` is
flat-cut and its letters are narrower. The candidates that fit the letterforms are
Plus Jakarta Sans and Manrope; neither has been confirmed against a glyph-by-glyph
comparison, and confirming it is part of this request rather than a thing to guess.

## What the contract says

`AGENTS.md` §5: *"No new dependencies without a change request."* `--font-sans` is
`'Inter Variable', 'Inter', …` and the face is self-hosted from
`@fontsource-variable/inter`, whose `@import` in `tokens.css` carries the argument for
paying a 48KB, one-request cost at all.

## Why it does not work as it stands

Every horizontal measurement in the reference pass was taken in the reference's
face and reproduced in Inter, and the two disagree by a few percent on every line:

| Landmark | Reference | Inter at the same size |
| --- | --- | --- |
| `FAVORITES`, 15px | 80px of ink | ~94px before tracking |
| `Kanban`, 17px medium | 61px | ~59px |
| card title `Pages "About" and "Careers"`, 17px semibold | 191px | ~187px |

Individually those are invisible. Together they are why a line wraps a word early
on one card and not on the one beside it, and why the section labels needed their
tracking reduced (`--text-label--letter-spacing`, 0.08em → 0.06em) to land near
the reference's width. The vertical rhythm is unaffected — line heights are
declared, not derived from the face — so this is the last visible difference
between the two, not a structural one.

## The minimum change

1. Identify the face by overlaying candidates on the 4× crop.
2. If it is open-licensed and on Fontsource, add `@fontsource-variable/<face>` to
   `apps/web/package.json` and swap the first entry of `--font-sans`. If it is not
   open-licensed, this request closes as **won't do** and Inter stays.
3. Re-derive the four cap-height calibrations in `docs/specs/web/shell.md` §3.1 and
   the ink widths quoted in `components/board/board-card.tsx`,
   `components/board/board-toolbar.tsx` and `components/surface-header.tsx` — the
   line boxes stay, the ascent/cap-height ratios worked through them change.
4. Re-run `pnpm ui:diff --theme dark` and `--theme light` and record the new
   differing-pixel fraction against today's 32.1% / 30.2%.

## What was done instead, in the meantime

Nothing that pre-empts the decision. Inter stays, the tracking on the section label
was tightened to the nearest value that reads correctly in Inter, and no width in a
component was nudged to compensate for the face — a nudge would have to be undone
the day the face changes, and it would be invisible in a diff.

## Resolution

_Pending._
