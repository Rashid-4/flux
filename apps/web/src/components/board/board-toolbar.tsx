import { List, SlidersHorizontal, SquareKanban, Table } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatChord } from '@/keyboard/keys'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The row under the header: which layout, and how it is filtered.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ```
 *  y=198  ┌──────────────────────────────────────────────────────────────┐
 *         │                       ← 38px of clear space                  │
 *  y=236  │ ▦ Kanban    ▤ Table    ▤ List view          ▤ Filter         │
 *  y=275  │                                                             │
 *         │                       ← 22px (pb-5.5)                        │
 *  y=298  ├──────────────────────────────────────────────────────────────┤  rule 2
 * ```
 *
 * Measured off `UI Images/JIRA 1.webp` and `JIRA 2.webp` at 1×, like the header
 * above it. `docs/specs/web/shell.md` §3.2 records the method; what follows is why
 * each number is the number.
 *
 * ### The band is 101px, and it is written as the total on purpose
 *
 * The references' band runs from the header's rule at y=197 to its own at y=298 —
 * 100 rows of content and the rule as the 101st. `h-*` in Tailwind is a *border-box*
 * height, so `--spacing-subbar` is 101 and `h-subbar border-b` produces exactly
 * that. Writing 100 would have moved every board pixel below it up by one.
 *
 * `pt-9.5` (38) + the 40px chip + `pb-5.5` (22) is the same 100, so the row's
 * height is asserted twice — deliberately. `h-subbar` is what the skeleton uses,
 * where there is no chip to derive a height from, and two independent statements of
 * one number that disagree is a layout jump on load rather than a silent nudge.
 *
 * ### `items-center`, not `items-end` — the labels share a baseline
 *
 * The obvious reading of the references is that everything in the row sits on the
 * same bottom edge, and it is wrong. Measured ink: "Kanban" y 250..263 and "Filter"
 * y 250..263, identical, while their *boxes* are 40px and 24px tall. Bottom-aligning
 * a 24px cluster against a 40px chip puts its cap top at 259.6 — nine pixels low,
 * which is the kind of error that reads as "slightly off" without ever looking like
 * a bug. Centring both inside the 40px content box lands both at **251.6** against a
 * measured 250/251.
 *
 * ### `size-6` icons, and the four glyphs are the references' own
 *
 * Read at 2× rather than guessed: the selected chip's mark is a rounded square with
 * three short vertical bars — lucide's `SquareKanban`, not the four-square
 * `LayoutGrid` this first shipped with; the table mark is a bordered grid with a
 * header row, `Table` rather than `Table2`; the list mark is three lines with a dot
 * before each, `List` rather than `Rows3`; and the filter mark is two horizontal
 * sliders, `SlidersHorizontal` rather than the funnel-and-lines `ListFilter`. Each
 * of the four earlier choices was a near neighbour that read as a different icon set
 * beside the mockup — which is the same class of drift as a token that resolves to
 * the wrong colour, and just as invisible one glyph at a time.
 *
 * The box is 24px, calibrated on the one mark whose ink is a fixed fraction of its
 * box: `SquareKanban`'s outer square is inset 3/24, so 24 × 0.75 = 18 plus a 1.5px
 * stroke straddling the path is the measured 19 × 18. The same 24 then falls out of
 * the horizontal construction below, and the labels — which is what the eye actually
 * reads — land on the pixel.
 *
 * ### The chip is 113px because of what is inside it, not because it is 115
 *
 * `px-2.75` (11) + 24 icon + `gap-1.5` (6) + a 61px "Kanban" + 11 = **113**, against
 * a measured 115 at x 408..522; `py-2` (8) + a 24px `text-md` line box + 8 = **40**,
 * against a measured 40. The 2px is the label: the references' face is wider than
 * Inter at the same cap height, so flux's word is a shade narrower and no amount of
 * padding fixes that without moving the icon. Cap height is the criterion —
 * `docs/specs/web/shell.md` §3.2 has the calibration.
 *
 * `gap-6.25` between items is measured from the *boxes*, which is the only reading
 * that is consistent: with 24px icon boxes the three items span 408..521, 547..620
 * and 645..745, giving 26 and 25.
 *
 * ### No trough, no border, no shadow
 *
 * All three were looked for and none is there. x 535..551 between the first two
 * items is pure canvas to within a channel; the chip's edge step is 2; and the faint
 * darkening at y 229..231 and y 281..284 is *symmetric* about the chip, which is
 * webp ringing rather than an elevation. The selected item is marked by a fill and
 * a weight, and that is all. `bg-canvas-raised` exists for this: the fill is a step
 * *down* from the canvas in light — (232, 238, 241) against (244, 246, 248) — so
 * `bg-surface`, which is lighter than the canvas, was the wrong direction, and
 * `bg-chrome-raised` is Δ3 on this base, which is an invisible selected state.
 *
 * ### `text-rail-icon` for the three unselected items
 *
 * Measured, and asymmetric in a way one grey cannot express: in light every label in
 * the row is the same near-black — "Table" peaks at (10, 12, 14) on the horizontal
 * bar of its T, where a lighter *colour* could not — while in dark the selected one
 * is white and the rest are (128, 130, 131) to (140, 142, 144). `--rail-icon` is
 * already exactly that pair, `--fg` in light and `--fg-subtle` in dark, and dark
 * `--fg-subtle` is #8b949e against a measured (140, 142, 144).
 *
 * So this is reuse rather than a fourth grey (`docs/product-quality-bar.md` §31),
 * and the name is now wrong for a token with two consumers — the same thing that is
 * true of `--rail-selected` since the header's tab underline started using it. Both
 * renames belong to the colour pass, which is one commit that touches every claimed
 * ratio in `design/contrast.test.ts`; doing it inside a geometry change would hide
 * the geometry.
 *
 * ### Two of the four controls cannot be used, and both say why
 *
 * §13: *"a control that silently does nothing is worse than one that says why it
 * cannot."* Kanban is the current layout and is `aria-pressed`, which is not a dead
 * control — pressing the selected member of a single-choice group is a no-op
 * everywhere, and the pressed state *is* the information. Table and List view carry
 * `aria-disabled` and a tooltip naming the cause, and Filter does the same while
 * pointing at the palette, which really does search every issue today.
 *
 * `aria-disabled` and not `disabled`, for the reason `../new-project-button.tsx`
 * sets out: a genuinely disabled button takes no pointer events, so the tooltip
 * explaining why it cannot be used would never open for the controls that need the
 * explanation.
 *
 * ### The unavailable controls are **not dimmed**, and that is a departure
 *
 * `../project-header.tsx` dims its star and its `＋` with `opacity-50`, and this row
 * does not. The difference is what the dimming would cost. The star's information is
 * the *shape* of a fill, which survives being drawn at half strength; the unselected
 * labels' information is their **colour**, which is a measured landmark — (10, 12, 14)
 * in light — and 60% of it is a mid-grey that matches nothing in the references.
 *
 * So the unavailability is carried by the three signals that cost no pixels:
 * `aria-disabled` announces it, `cursor-not-allowed` shows it at the moment someone
 * reaches for the control, and the tooltip opens on the same hover and says why. The
 * one signal a dim adds over those is *at a glance*, and it is bought with the exact
 * thing this file was written to get right.
 */

export interface BoardToolbarProps {
  /**
   * The active sprint, already formatted — `"Sprint 14 · 5 days remaining"`.
   *
   * The references draw **nothing** between the switcher and Filter: a scan of
   * x 751..1294 across the whole band finds no ink in either theme. This goes in
   * that space, which is an addition to an empty region rather than a change to a
   * measured one — no landmark in the row moves whether it is present or not.
   *
   * It is here because the alternative is dropping it. `useProjectBoard` resolves a
   * real sprint with a real countdown, and a board that knows which sprint it is
   * showing and does not say so is the failure §7 describes from the other side.
   */
  sprintLabel?: string | undefined
  className?: string | undefined
}

/** A lucide icon, as a component. Narrower than `LucideIcon`, which pulls in refs. */
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface Layout {
  label: string
  Icon: IconComponent
  /** `undefined` when the layout is the one on screen. */
  unavailable?: string | undefined
}

/**
 * Sentence case — "List view", where the references write "List View".
 *
 * Title case in UI copy is an Atlassian house style, not a measurement, and flux
 * writes sentence case everywhere else in this tree. Matching it here would make
 * this the one row in the product that shouts.
 */
const LAYOUTS: readonly Layout[] = [
  { label: 'Kanban', Icon: SquareKanban },
  {
    label: 'Table',
    Icon: Table,
    unavailable: 'A table of these issues is not built yet — this board only draws columns.',
  },
  {
    label: 'List view',
    Icon: List,
    unavailable: 'A flat list of these issues is not built yet — this board only draws columns.',
  },
]

export function BoardToolbar({ sprintLabel, className }: BoardToolbarProps) {
  return (
    <div
      data-slot="board-toolbar"
      /**
       * No `bg`: the band is `--canvas`, measured at exactly (244, 246, 248) light
       * and (16, 18, 19) dark, which is what the frame already paints behind it. A
       * `bg-canvas` here would be a second declaration of one colour and the kind
       * that survives a retune of the first.
       */
      className={cn('shrink-0 px-gutter', className)}
    >
      {/**
       * The rule is on an *inner* element so it inherits the gutter: measured at
       * x 408..1362, which is the content column inset by its own padding rather
       * than run edge to edge. `--border-rule` is the token for it — L(218, 220, 222)
       * D(26, 28, 30), a rung below `--border`, and the only line in the chrome
       * drawn at that weight.
       */}
      <div className="flex h-subbar items-center gap-6.25 border-b border-border-rule pt-9.5 pb-5.5">
        {/**
         * `role="group"` and `aria-pressed`, rather than tabs or radios. These are
         * three renderings of one dataset, not three destinations — a tab implies
         * navigation and a radio implies a form — and a labelled group of toggle
         * buttons is what a segmented control announces as.
         */}
        <div role="group" aria-label="Board layout" className="flex items-center gap-6.25">
          {LAYOUTS.map((layout) => (
            <LayoutButton key={layout.label} layout={layout} />
          ))}
        </div>

        {sprintLabel !== undefined && (
          <>
            {/**
             * A hairline, so the sprint does not read as a fourth layout. The three
             * items above are 25px apart; anything sharing that rhythm without a
             * boundary joins the set.
             */}
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <p className="min-w-0 truncate text-md text-fg-muted">{sprintLabel}</p>
          </>
        )}

        <FilterButton />
      </div>
    </div>
  )
}

/**
 * One layout: an icon, a label, and a fill when it is the one on screen.
 *
 * The selected item is the only one with padding, which is why the row's gap is
 * measured between boxes and not between words — 11px of the 25 either side of the
 * chip is inside it.
 */
function LayoutButton({ layout }: { layout: Layout }) {
  const { label, Icon, unavailable } = layout
  const selected = unavailable === undefined

  const button = (
    <button
      type="button"
      aria-pressed={selected}
      {...(selected ? {} : { 'aria-disabled': true })}
      onClick={
        selected
          ? undefined
          : (event) => {
              event.preventDefault()
            }
      }
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-control text-md whitespace-nowrap',
        selected
          ? 'bg-canvas-raised px-2.75 py-2 font-medium text-fg'
          : 'text-rail-icon aria-disabled:cursor-not-allowed',
      )}
    >
      <Icon aria-hidden="true" className="size-6 shrink-0" />
      {label}
    </button>
  )

  if (selected) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{unavailable}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Filter: `ml-auto`, no padding, flush with the gutter.
 *
 * Measured — "Filter" inks to x=1362 where the content column's padding edge is
 * 1363, so the label's box ends *on* the gutter and the control has no horizontal
 * padding of its own. That is the same construction as the header's tab row, and it
 * is why there is no hover fill: there is nowhere to put one.
 *
 * The tooltip names a real alternative rather than only a cause. Filtering the board
 * is a change request away — `board.columns[].cards` is already in memory, so it is
 * a client-side predicate — but the palette searches every issue *today*, and
 * sending someone to a thing that works beats apologising.
 */
function FilterButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled="true"
          onClick={(event) => {
            event.preventDefault()
          }}
          className="ml-auto flex shrink-0 items-center gap-1.5 text-md whitespace-nowrap text-rail-icon aria-disabled:cursor-not-allowed"
        >
          <SlidersHorizontal aria-hidden="true" className="size-6 shrink-0" />
          Filter
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {`Filtering this board is not built yet. The palette (${formatChord({ key: 'k', mod: true })}) searches every issue.`}
      </TooltipContent>
    </Tooltip>
  )
}
