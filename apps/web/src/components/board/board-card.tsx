import type { BoardCard as BoardCardValue } from '@flux/contracts'
import { Check, EllipsisVertical, MessageSquare, Paperclip, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { LabelChip } from '@/components/data/label-chip'
import { PriorityIcon } from '@/components/data/priority-icon'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import { withPeek } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One card on the board, measured off `UI Images/JIRA 1` and `JIRA 2`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### The construction, and it closes exactly
 *
 * Column 3 of the light reference — the one column no drag overlaps — gives a
 * card at app y 418.5..673.5, so **255px** tall and **308px** wide. Every
 * boundary inside it was located by run-length scan, and the stack that
 * reproduces them sums to 255 with nothing left over:
 *
 * ```
 *   pt-5.5     22   ┐
 *   chip row   24   │ h-6 pills, kebab on the same line   measured 439..465
 *   mt-4       16   │
 *   title      24   │ text-md/24 semibold                 cap top measured 487
 *   mt-1.25     5   │ body
 *   3 × 23     69   │ text-md on 23px leading             lines 515 / 538 / 561
 *   pb-6.5     26   ┘
 *   border-t     1                                        measured y 605
 *   py-3.5     14   ┐
 *   avatar     40   │ footer                               measured y 620..660
 *   py-3.5     14   ┘
 *   ────────────────
 *              255                                        measured 673.5 − 418.5
 * ```
 *
 * The horizontal padding is 20px and three independent landmarks agree on it:
 * the footer avatar's left edge at 1075, the first chip's at 1075.73, and the
 * inset divider above "+ Add Subtask" sitting 21px inside each edge. `px-5`.
 *
 * ### Why the vertical padding is asymmetric, which looks like a mistake
 *
 * `pt-5.5` (22) against `pb-6.5` (26). Both are measured — the chip band starts
 * at 440.6 and the divider is at 605 — and neither is derivable from the other,
 * because the reference is not built from a symmetric box. Rounding them to a
 * matching `p-6` moves the chips down 2px and the divider up 1px, and since the
 * chip row is the top of a 255px stack every element below it inherits the
 * error. A number that is measured beats a number that is tidy.
 *
 * ### `leading-5.75`, and why it is not `text-md`'s own line-height
 *
 * The description's three baselines sit at 515, 538 and 561 — a 23px pitch,
 * where `--text-md` declares 24. Over three lines that is 3px, which is 3px on
 * the card's height and therefore 3px on every card below it in the column.
 * `leading-5.75` is v4's spacing-scale form (`calc(var(--spacing) * 5.75)` =
 * 23px), so it needs no new token and it is not the `leading-[23px]` that
 * `eslint.config.mjs` forbids.
 *
 * ### `shrink-0`, which is the whole reason the first render was wrong
 *
 * A card is a flex child of the column's `overflow-y-auto` stack, and a flex
 * child's default `flex-shrink: 1` beats `overflow`. So the first render did not
 * scroll: it **squashed**. Measured — card 1 asked for 315px and got 250.6, card
 * 3 asked for 535 and got 425.6 — and because the card is `overflow-hidden`, what
 * the squash cut off was the footer. Every card below the fold lost its avatar
 * and its counts, the arithmetic above was violated on every card at once, and
 * from a screenshot it read as "the footer is conditional somehow" rather than as
 * a layout failure. The instrument that caught it was the geometry probe, not the
 * eye.
 *
 * ### flux's own additions go where the reference has empty space
 *
 * The reference's card carries no issue key, no type and no priority. flux cannot
 * drop them — a board you cannot cite an issue from is a worse product, and §7
 * asks that every element have a reason rather than that every element be
 * copied — but the *first* attempt gave them a row of their own below the
 * description, and a row costs 36px on every card in the product. That is the one
 * kind of divergence a carbon copy cannot absorb: it moves every boundary below
 * it, on every card, which is exactly what the arithmetic above exists to pin.
 *
 * So they go in the two bands the reference leaves empty and pay **nothing**:
 *
 *   - the head row's right side (chips end 1217, kebab begins 1338 → 121px) takes
 *     the story-point, blocked and breached badges, all `h-6` like the chips;
 *   - the footer's middle (avatar ends 1115, counts begin 1253 → 138px) takes the
 *     type icon, the key and the priority icon, about 103px of 14px glyphs and
 *     15px mono.
 *
 * With that, a card with a one-line title and a three-line description is 255px
 * exactly — the reference's height, from the same eleven terms.
 *
 * ### Where it still diverges, with the number
 *
 * On the card *with* subtasks (column 1) the predicted footer divider lands at
 * 710.5 against a measured 706. That 4.5px is the reference's own
 * inconsistency, not a construction error: the plain card closes to the pixel,
 * and the two mockups already disagree with each other by 4px across the whole
 * board region. The systematic construction is kept and the residual recorded
 * rather than absorbed into a second, contradictory set of paddings.
 *
 * The footer's right cluster was the other open residual — it measured 6px short
 * of the content edge, comment ink at 1253 and the last digit at 1336 against an
 * edge of 1343, and no icon-size/gap pair explained it. It is `px-5` symmetric
 * with everything else, and the render-diff confirms the cluster's own internal
 * spacing rather than the 6px, so the 6px is read as the reference's own optical
 * inset on a right-aligned numeral and not reproduced.
 */

export interface BoardCardProps {
  card: BoardCardValue
  /** Lifted under a pointer. Drives the elevation the reference shows mid-drag. */
  dragging?: boolean | undefined
  className?: string | undefined
}

export function BoardCard({ card, dragging = false, className }: BoardCardProps) {
  /**
   * The card opens the **peek panel**, not the full page.
   *
   * `to={{ search }}` with no pathname keeps the board exactly where it is — same
   * route, same scroll, same filters — and adds `?peek=LOG-142`, which is the panel's
   * whole state (`lib/paths.ts` carries why it is a param and not a route). The full
   * page is one press further in, from the panel's "See full details".
   *
   * `useLocation()` rather than a `to` prop threaded down from the board, because the
   * *current* search string is what has to be preserved: building the link from
   * nothing would drop a board filter the moment someone clicked a card. It is one
   * hook per card reading one value, and every card on the board reads the same one.
   *
   * Cmd-click still does the right thing: a new tab opens the board with the panel
   * already on the issue, which is a shareable URL rather than a lost click.
   */
  const { search } = useLocation()

  return (
    /**
     * The whole card is the link, which is why nothing inside it may be one —
     * `card.key` is rendered as plain text below for exactly that reason, and the
     * overflow affordance is a `<button>`. Nesting an `<a>` inside an `<a>` is
     * invalid and browsers recover by closing the outer one early, which silently
     * breaks the card.
     *
     * `overflow-hidden` is load-bearing rather than defensive: the footer's
     * divider is a `border-t` on a full-bleed child, and without the clip it
     * would square off the two bottom corners `rounded-card` just rounded.
     *
     * `shrink-0` is load-bearing for a nastier reason, and the two interact. The
     * column stacks cards in an `overflow-y-auto` flex container, where the
     * default `flex-shrink: 1` outranks the overflow — so without it a column
     * with more cards than height does not scroll, it compresses each card, and
     * this element's own `overflow-hidden` then hides the footer that no longer
     * fits. Measured before the fix: a card asking for 315px rendered at 250.6
     * with no avatar and no counts.
     */
    <Link
      to={{ search: withPeek(search, card.key) }}
      data-slot="board-card"
      /**
       * The handle the peek panel focuses on close. `issue/issue-peek-panel.tsx` has the
       * reasoning: the panel is a sibling of `<main>` in a different subtree, so there
       * is no ref to pass, and without this a keyboard user who closes the panel lands
       * at the top of the document instead of back on the card they were reading.
       */
      data-issue-key={card.key}
      data-dragging={dragging ? 'true' : undefined}
      className={cn(
        'group/card flex shrink-0 flex-col overflow-hidden rounded-card bg-surface',
        'transition-shadow duration-90 ease-out',
        dragging ? 'shadow-drag' : 'shadow-card hover:shadow-raised',
        className,
      )}
    >
      <div className="flex flex-col px-5 pt-5.5 pb-6.5">
        {/**
         * `h-6` rather than a height inherited from the chips, and the row renders
         * even when the card has no labels. Two reasons, and the second is the one
         * that matters: the kebab lives here and the reference draws it on every
         * card, so a row that disappeared with the last label would take the card's
         * only affordance with it. Fixing the height then makes a card with no
         * labels exactly as tall as one with three, which is what stops a column
         * from having two card heights.
         *
         * The chips get their own `min-w-0 flex-1 overflow-hidden` box so a card
         * carrying six labels clips them instead of pushing the kebab off the
         * card. `LabelChip` truncates at `max-w-40`; that bounds one chip, not the
         * row.
         *
         * `flex-wrap items-start` inside a box that is exactly one chip tall is what
         * makes the clip land *between* chips rather than through one. Without it
         * the box cut the first chip that did not fit at whatever pixel the space
         * ran out — a violet sliver with half an `h` in it beside `2 blocked`, on
         * the fixture's second card — which read as a rendering fault. With it, a
         * chip that does not fit wraps to a second row that the 24px box hides, so
         * the row shows whole chips or none. What it costs is honest: the hidden
         * labels are not announced as hidden. The card's `title` and the peek panel
         * both carry the full list, and a `+N` count would have taken the same
         * 30px from the label that is shown.
         *
         * Everything after that box is flux's, and it is here because the
         * reference leaves 121px empty between its last chip (1217) and its kebab
         * (1338). Each is `h-6` like a chip, so the row's height is still the
         * `h-6` the arithmetic depends on, and `Badge`'s base carries `shrink-0`
         * so a long label clips its own chips rather than crushing a count.
         */}
        <div className="flex h-6 min-w-0 items-center gap-1.5">
          <div className="flex h-6 min-w-0 flex-1 flex-wrap items-start gap-1.5 overflow-hidden">
            {card.labels.map((label) => (
              <LabelChip key={label} label={label} />
            ))}
          </div>
          {/**
           * A breached SLA earns a chip of its own rather than a colour on an
           * existing one — §9 of the foundation spec: colour is never the only
           * carrier of meaning, and `slaState` is exactly the field it names.
           *
           * Outside the clipping box, unlike the labels: a breach is the one thing
           * on this card that must not be the item a sixth label pushes out of
           * view.
           */}
          {/**
           * `size="chip"` on all three, not `sm`. The `sm` rung is the uppercase
           * tracked micro-label, and beside the reference's sentence-case pills it
           * shouted — `2 BLOCKED` in 0.08em tracking next to `warehouse` in none
           * read as two badge systems on one row. Every pill on a card is now the
           * same 24px box, 15px semibold, sentence case, and the tone is the only
           * thing that differs: a `-soft` tint for flux's own readings, the `--tag-*`
           * hue for a label. `Breached` and `2 blocked` are still words, which is
           * the signal §9 needs the colour never to be alone in carrying.
           */}
          {card.slaState === 'breached' && (
            <Badge size="chip" variant="danger">
              Breached
            </Badge>
          )}
          {card.storyPoints !== null && (
            <Badge size="chip" variant="neutral">
              {card.storyPoints}
            </Badge>
          )}
          {card.blockedByCount > 0 && (
            <Badge size="chip" variant="warning">
              {card.blockedByCount} blocked
            </Badge>
          )}
          <CardMenu issueKey={card.key} />
        </div>

        {/**
         * `mt-4` from the chip row, `text-md` semibold. The reference's title ink
         * runs x 1076..1266 — 191px for 21 characters, which is 17px semibold and
         * not 17px medium; the same width at medium is 183px. Cap top 487 against
         * a 24px line box opening at 480.5 puts the calibration within 0.7px.
         */}
        <p className="mt-4 text-md font-semibold text-fg">{card.summary}</p>

        {card.descriptionExcerpt !== null && card.descriptionExcerpt.length > 0 && (
          /**
           * `line-clamp-3` because the reference shows three lines and the excerpt
           * is bounded at 240 characters, which is four lines at this width. The
           * clamp is what keeps a card 255px tall rather than 278px, and a column
           * of cards that are each a different height is the single most obvious
           * way this surface stops looking like the reference.
           */
          <p className="mt-1.25 line-clamp-3 text-md leading-5.75 text-fg-muted">
            {card.descriptionExcerpt}
          </p>
        )}

        {card.subtasks.length > 0 && <Subtasks card={card} />}
      </div>

      {/**
       * The footer, full-bleed so its `border-t` spans the card's whole width —
       * measured x 410..714 on a card at 408..716, i.e. edge to edge within the
       * scan's own antialiasing. Contrast the subtask divider inside `Subtasks`,
       * which is inset by the padding: the reference draws both, and drawing
       * either one the other's width is immediately visible.
       *
       * `border-border-subtle`, not `border-border`. The reference's divider is
       * #e5e7e7 on a white card and #0b0d0f on a #1d1f20 one — *darker* than the
       * card in both themes, which `--border-subtle` (#f5f5f5 / #212121) is the
       * only pair in the ladder to satisfy going the same direction in dark.
       */}
      <div className="flex items-center border-t border-border-subtle px-5 py-3.5">
        <UserAvatar
          user={card.assignee === null ? null : { ...card.assignee, isInactive: false }}
          size="lg"
          className="shrink-0"
        />
        {/**
         * The identifiers, in the band the reference leaves empty: its avatar ends
         * at 1115 and its comment glyph begins at 1253, so there are 138px here
         * that cost nothing to use. `ml-3` puts the type glyph at 1127; the three
         * of them measure about 103px at `size-3.5` and 15px mono, which ends near
         * 1230 and clears the counts by 20px.
         *
         * They were a row of their own below the description until this commit,
         * and a row is 36px on every card in the product — the one kind of
         * divergence a pixel-for-pixel copy cannot absorb, because it moves every
         * boundary beneath it. Deleting them instead was the alternative and it is
         * worse: a board you cannot cite an issue from, at a glance, is a worse
         * product than one that differs from the mockup here.
         *
         * `min-w-0 truncate` on the key rather than `shrink-0`, because a project
         * key is up to 10 characters by contract and the counts must win.
         */}
        <div className="ml-3 flex min-w-0 items-center gap-1.5">
          <TypeIcon issueTypeKey={card.issueTypeKey} className="shrink-0" />
          <span className="min-w-0 truncate font-mono text-sm text-fg-subtle">{card.key}</span>
          <PriorityIcon priority={card.priority} className="shrink-0" />
        </div>
        <div className="ml-auto flex items-center gap-5.5">
          <CardCount icon={MessageSquare} value={card.commentCount} label="comments" />
          <CardCount icon={Paperclip} value={card.attachmentCount} label="attachments" />
        </div>
      </div>
    </Link>
  )
}

/**
 * The subtask checklist, and the divider under it is inset rather than full-bleed.
 *
 * Column 1 of the light reference: two rows at a 31px pitch with 18px outline
 * circles flush to the content edge at x 428, labels 8px after them, then a
 * **1px divider at y 640.5 spanning x 429..695** — 21px inside each edge, which
 * is the card's own padding. The "+ Add Subtask" row is 12px below it and its `+`
 * ink is x 432..443, centred in the same 18px column as the circles.
 *
 * The circles are `size-4.5` and so is the `+`: `Plus` at 18px draws 11.6px of
 * ink against a measured 12, and putting it in the circles' box rather than
 * beside them is what keeps the two rows' left edges identical.
 *
 * ### The marker is neutral, and the done row is not struck through
 *
 * Both are measurements that reversed a first guess. The open circle's stroke
 * samples rgb(113,115,116) on the dark card and rgb(137,139,141) on the light one,
 * which is `--border-control` in each theme to within four channels — not
 * `--border-strong`, which is a rung darker on dark and two rungs lighter on light.
 * The done circle is a **grey** disc with a white tick — rgb(80,82,84) dark,
 * rgb(96,98,100) light — and not the success green this shipped with, which was the
 * one saturated thing on a card whose reference has none below the chip row. And the
 * done label keeps its weight and its colour: no strike. The two signals §9 asks for
 * are the filled disc and the tick inside it, against an empty ring; the strike was a
 * third that the reference does not draw.
 *
 * `bg-fg-subtle text-surface` is the nearest pair the palette has to that grey disc:
 * exact in light, and in dark a lighter disc with a dark tick where the reference has
 * a darker disc with a white one — the same information, inverted by a rung, and
 * recorded here rather than absorbed into a new token for a 18px circle.
 */
function Subtasks({ card }: { card: BoardCardValue }) {
  const hidden = card.subtaskTotal - card.subtasks.length

  return (
    <div className="mt-3 flex flex-col">
      {card.subtasks.map((subtask) => (
        <div key={subtask.id} className="flex h-7.75 items-center gap-2">
          <span
            aria-hidden="true"
            data-done={subtask.isDone ? 'true' : undefined}
            className={cn(
              'flex size-4.5 shrink-0 items-center justify-center rounded-chip border',
              subtask.isDone
                ? 'border-fg-subtle bg-fg-subtle text-surface'
                : 'border-border-control',
            )}
          >
            {subtask.isDone && <Check aria-hidden="true" className="size-3" strokeWidth={3} />}
          </span>
          <span
            className={cn(
              'min-w-0 truncate text-md',
              subtask.isDone ? 'text-fg-subtle' : 'text-fg-muted',
            )}
          >
            {subtask.summary}
          </span>
        </div>
      ))}

      {/**
       * `subtaskTotal` can exceed what was sent, and a checklist showing four of
       * nine with no indication is the worst version of this row: it looks
       * complete. The count is what makes the cap honest.
       */}
      {hidden > 0 && (
        <p className="flex h-7.75 items-center pl-6.5 text-md text-fg-subtle">
          {hidden} more subtask{hidden === 1 ? '' : 's'}
        </p>
      )}

      {/**
       * The reference's own affordance, disabled with a reason rather than
       * omitted — §5's second rule, and the same treatment `CardMenu` gets.
       * Creating a child issue needs the create surface
       * `docs/specs/web/issue.md` describes, and that does not exist yet.
       *
       * `-mx-5 px-5` on the divider is what makes it *inset* while the footer's
       * is not: the padding is on the body, so a plain `border-t` here is already
       * inset by it. It is spelled as a sibling `<span>` rather than a border on
       * the button so the 12px above and below it are both explicit.
       */}
      <span aria-hidden="true" className="mt-2.75 h-px shrink-0 bg-border-subtle" />
      {/**
       * `text-fg`, not a dimmed `--fg-subtle`: the reference's "+ Add Subtask" is its
       * brightest ink on the dark card — pure white, the same as the title — with a
       * `+` as heavy as the letters, and on the light card a dark grey. `text-fg` is
       * exact for dark and a rung darker than the light sample, which is the honest
       * choice between the two; the alternative pair does not exist as a token. The
       * unavailability is carried by `aria-disabled`, the cursor and the title.
       */}
      <button
        type="button"
        aria-disabled="true"
        aria-label={`Add a subtask to ${card.key} — not available yet`}
        title="Creating a subtask arrives with the issue surface"
        onClick={(event) => {
          /** The card is a link; without this the click navigates. */
          event.preventDefault()
        }}
        className="mt-3 flex h-7.75 items-center gap-2 text-fg aria-disabled:cursor-not-allowed"
      >
        <Plus aria-hidden="true" className="size-4.5 shrink-0" strokeWidth={2.25} />
        <span className="text-md">Add subtask</span>
      </button>
    </div>
  )
}

/**
 * The overflow menu, as a button rather than a menu — for now.
 *
 * The reference shows `⋮` on every card and opens a menu of card actions. Those
 * actions are transitions, assignment and rank changes, all of which are mutations
 * this surface cannot yet perform: `api/issues.ts` has no rank or move function
 * (CR-002), and there is no board mutation layer. A menu that opened onto four
 * disabled items would be four controls that silently do nothing.
 *
 * So it is present, disabled, and says why — §5's second rule, the same treatment
 * `new-project-button.tsx` uses. It keeps the card's geometry identical to the
 * reference, which is what the diff measures.
 *
 * It is visible at rest, and it used to appear on hover. The reference draws it on
 * every card — its ink measures 3×16px at x 1338..1340, which is not a hover state
 * in a static mockup but is also not ambiguous, because the *column* header's kebab
 * is drawn identically and nothing is hovered in either place. A hover-reveal is the
 * more fashionable choice and it is the wrong one here for two reasons beyond the
 * mockup: the card is a link, so on a touch device there is no hover to reveal it
 * with, and a control that only exists once you have already guessed it is there is
 * a control most people never find.
 *
 * It is drawn in `--fg` at full strength, and it was a 70% `--fg-subtle`. The
 * reference's kebab is pure white on the dark card and black on the light one — the
 * same ink as the title beside it — and a washed-out one on every card was the
 * quietest and most repeated departure on the board. The unavailability is carried
 * by `aria-disabled`, by `cursor-not-allowed` and by the title, the same three
 * signals every other inert control on this surface now relies on.
 *
 * `EllipsisVertical`, not `MoreHorizontal`: the reference's glyph is vertical, and
 * its ink measures 3px × 16px at x 1338..1340 — which `size-6` with `-mr-2` puts
 * at 1340.5 against a 1343 content edge. The column header's kebab measures
 * x 1358..1360 against a 1363 column edge, and the *same* pair predicts 1360.5.
 * One rule confirmed at two independent sites, which is why it is a rule and not
 * a nudge. `-mr-2` is a named negative step, so it is not the arbitrary value the
 * lint config rejects.
 */
function CardMenu({ issueKey }: { issueKey: string }) {
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-label={`Actions for ${issueKey} — not available yet`}
      title="Card actions arrive with the board mutation layer"
      onClick={(event) => {
        /** The card is a link; without this the click navigates. */
        event.preventDefault()
      }}
      className={cn(
        '-mr-2 flex shrink-0 items-center justify-center rounded-control',
        'text-fg aria-disabled:cursor-not-allowed',
      )}
    >
      <EllipsisVertical aria-hidden="true" className="size-6" strokeWidth={2.25} />
    </button>
  )
}

interface CardCountProps {
  icon: typeof MessageSquare
  value: number
  label: string
}

/**
 * Zero is not rendered. A row of `0`s is noise on every card that has nothing,
 * and the reference has no card showing one.
 *
 * `gap-1` inside a pair (icon ink ends 1268, "18" starts 1272) and `gap-5.5`
 * between pairs (the "18" ends 1289, the paperclip starts 1311 — 22px), both
 * measured. The icons are `size-5`: the comment glyph's ink is 16px square,
 * which is `MessageSquare` at 20px after the global 1.5 stroke rule.
 *
 * The reference's attachment glyph is a narrow vertical clip 9px wide by 15
 * tall; lucide's `Paperclip` is diagonal and wider. Kept as a knowing
 * divergence rather than drawn by hand, because a bespoke icon in one card
 * footer is a second icon set nobody maintains.
 *
 * `text-fg`: the counts are the reference's brightest ink — white on the dark card,
 * rgb(35,35,35) on the light one — not the secondary grey this shipped with. On a
 * card whose description is already muted, a muted count read as a third tier the
 * reference does not have.
 */
function CardCount({ icon: Icon, value, label }: CardCountProps) {
  if (value <= 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-md text-fg">
      <Icon aria-hidden="true" className="size-5" />
      <span aria-label={`${String(value)} ${label}`}>{value}</span>
    </span>
  )
}
