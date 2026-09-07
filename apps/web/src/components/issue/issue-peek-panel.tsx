import type { IssueDetail, UserRef } from '@flux/contracts'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { PriorityIcon } from '@/components/data/priority-icon'
import { StatusChip } from '@/components/data/status-chip'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
import { ErrorState } from '@/components/error-state'
import { CommentComposer } from '@/components/issue/comment-composer'
import { CommentThread } from '@/components/issue/comment-thread'
import { CopyLinkAction, MoreActions, WatchAction } from '@/components/issue/issue-actions'
import { plainText } from '@/components/issue/rich-text'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useShortcut } from '@/keyboard/use-shortcuts'
import { cn } from '@/lib/cn'
import { paths, withoutPeek } from '@/lib/paths'
import { useIssue } from '@/queries/issue'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The peek panel. Measured off `UI Images/JIRA 2` (light, authoritative),
 * cross-checked against `JIRA 1` (dark) and `JIRA 4` (the 3D view).
 * ══════════════════════════════════════════════════════════════════════
 *
 * Click a card, and this opens beside the board showing *that issue*: what it is, a
 * few details, and the conversation about it. `?peek=LOG-142` is the whole of its
 * state, so it survives a refresh, it is linkable, and Back closes it.
 *
 * ### What the reference actually draws, and what it maps onto
 *
 * The mockup's right-hand panel is a **person-to-person chat**: an avatar, a display
 * name, an `@handle`, a line of skills, a role chip, an "Open Full Chat" button, then
 * message bubbles and a composer. None of that is an issue tracker, and copying it
 * literally would have produced a DM product bolted to a board.
 *
 * The mapping is one-for-one and it holds at every level, which is why the geometry
 * transfers without a single measurement being invented:
 *
 * ```
 *   the reference             flux
 *   ─────────────────────     ─────────────────────────────────────────
 *   116px avatar circle   →   the issue type, as a 116px glyph disc
 *   display name          →   the summary
 *   @handle               →   the issue key, mono, with its priority
 *   skills, two lines     →   the description, two clamped lines
 *   two chips             →   status, and the assignee
 *   "Open Full Chat"      →   "See full details" → /browse/:issueKey
 *   message bubbles       →   the comment thread
 *   composer              →   a comment composer
 * ```
 *
 * ### The measured vertical stack, and the arithmetic behind each step
 *
 * Every number is a CSS pixel at 1× DPR, read off the light mockup with the window
 * content box at image origin (105, 103). The panel occupies app x 1400..1841 — 441px,
 * which `design/tokens.css` already carries as `--spacing-detail`, so the width is
 * `w-detail` and not a literal.
 *
 * ```
 *   mt-10        40      header box top
 *   h-9          36      close ×, and the three-icon cluster        →  ends 76
 *   mt-15.25     61
 *   size-29     116      the type disc, y 137..253 (measured 137..252)
 *   mt-4         16
 *   text-3xl  30/38      the summary, cap top 277.1 (measured 277)
 *   (stacked)  17/24     the key line, directly under it
 *   mt-2          8
 *   2 × 24       48      the description, y 339..387 (measured 345..387 of ink)
 *   mt-6.25      25
 *   h-11         44      the chip row, y 412..456 (measured 412..454)
 *   mt-19.25     77      the rule, at y 533 (measured ink rows 532..534)
 *   flex-1              the thread — everything above it is natural height
 *   h-14.25      57      the composer, y 1251..1307
 *   mb-5         20      the panel's bottom edge, y 1327
 * ```
 *
 * **`text-3xl` for the summary is derived, not chosen.** Inter's ascender is 0.969em,
 * its descender 0.241em and its cap height 0.727em. At 30/38 the half-leading is
 * (38 − 36.3)/2 = 0.85, the baseline sits 29.92 below the line box top, and the cap top
 * is 8.11 below it — so a line box at 269 puts caps at 277.1 against a measured 277.
 * `text-2xl` predicts 283.6 and does not fit any spacing step.
 *
 * **The two mockups disagree by 7–8px, and only above the rule.** Dark sits lower from
 * the disc through "Open Full Chat"; the thread and the composer are at the same y in
 * both. That is the shape of the layout, not a mockup error: the identity block takes
 * its natural height, the thread is `flex-1`, and the composer is pinned. So a summary
 * that wraps to two lines eats 38px of *thread*, and the panel's bottom edge does not
 * move. Light is authoritative for the numbers above.
 *
 * ### Where flux diverges, and why each one is not a shortcut
 *
 *   - **The header cluster is watch / copy link / kebab**, where the reference draws a
 *     video call, a phone call and a kebab. A video button on an issue is a feature
 *     this product does not have and will not have — §7, every visual element must have
 *     a reason to exist. Copy link works today; the other two say why they cannot.
 *   - **No presence dot** on the disc. The reference's green dot means "Mira is
 *     online". An issue has no analogue, and the two candidates — status and blocked —
 *     are already drawn as a chip and as a badge, in words. A coloured dot as the only
 *     carrier of either would be §9's exact prohibition.
 *   - **The priority rides on the key line.** The reference's chip row holds two chips
 *     spanning x 79..357, centred on 218 — a composition, not a full-width row, and a
 *     third chip widens it to ~400 and fills the box. So status and assignee are the
 *     two chips, and priority takes the empty half of the key line: that band is 441px
 *     wide carrying 69px of ink, and `board/board-card.tsx`'s footer already pairs a
 *     mono key with a `PriorityIcon` exactly this way. The cost is that the key text
 *     shifts ~13px right of its measured 183..252, inside a row that is still centred.
 *   - **The composer's right-hand glyph is `Send`**, not the reference's microphone and
 *     waveform. See `./comment-composer.tsx` — a voice note has no contract here.
 *   - **A day divider** appears in threads the reference never had to draw. See
 *     `./comment-thread.tsx`.
 *
 * All five are recorded in `docs/specs/web/issue.md` rather than absorbed silently.
 *
 * ### It is a sibling of `<main>`, and it is not a modal
 *
 * `shell/shell-frame.tsx`'s `panel` slot is where this renders — outside `<main>`, so
 * the board keeps its landmark and its scroll position, and with no focus trap and no
 * `inert` on the rest of the page. That is deliberate: a peek panel that trapped focus
 * would make "click through six cards" into six open-and-dismiss cycles, which is the
 * one interaction the panel exists to make fast.
 *
 * Not trapping focus is not the same as ignoring it. See `close` below.
 */

export interface IssuePeekPanelProps {
  /** From `?peek=` — see `lib/paths.ts`. The panel's entire input. */
  issueKey: string
  /** The reader, for the thread's two-sided bubbles. */
  currentUserId: string
}

export function IssuePeekPanel({ issueKey, currentUserId }: IssuePeekPanelProps) {
  const issue = useIssue(issueKey)
  const location = useLocation()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLElement>(null)

  /** The URL with the panel gone, and nothing else about the page changed. */
  const closedTo = { pathname: location.pathname, search: withoutPeek(location.search) }

  /**
   * Closing, and putting focus back where it came from.
   *
   * The panel does not trap focus, so on close the browser would leave focus wherever
   * it happens to be — on a `<Link>` that has just been unmounted, which resets it to
   * `<body>` and drops a keyboard user at the top of the document. Restoring it to the
   * card that opened the panel is what makes "peek at three cards in a row" work
   * without a mouse.
   *
   * `data-issue-key` on the card is the handle, and a query is the honest way to find
   * it: the card lives in a different subtree under a different route component, so
   * there is no ref to pass. There is nothing to find when the panel was opened from a
   * pasted link, or when the board has since scrolled the card out of a virtualised
   * window — hence the optional call rather than an assertion, and focus then falls back
   * to the document, which is the browser's own behaviour and no worse than not trying.
   *
   * **The panel's own root carries the same attribute**, so the query has to exclude it.
   * Without that, a peek opened from a pasted link would "restore" focus to the `<aside>`
   * that is on its way out — harmless in effect, since focus lands on `<body>` either
   * way, but it makes the sentence above false and it means the whole behaviour rests on
   * `shell/shell-frame.tsx` rendering `<main>` before `{panel}`. Document order is not a
   * contract anything here can check, and a future layout that floats the panel first
   * would break focus restoration with no failing test to show for it.
   *
   * The navigation goes first. Focusing an element and *then* unmounting its
   * replacement's sibling is a race; focusing after the route has settled is not.
   */
  const close = () => {
    void navigate(closedTo)
    const tagged = document.querySelectorAll<HTMLElement>(
      `[data-issue-key="${cssEscape(issueKey)}"]`,
    )
    const card = Array.from(tagged).find((element) => element !== panelRef.current)
    card?.focus()
  }

  /**
   * Escape closes it, through the registry rather than through a handler on the panel.
   *
   * `keyboard/registry.ts` owns every binding in the product, and going through it buys
   * three things a local `onKeyDown` could not. The scope is *mount* — this component
   * only exists while `?peek=` is in the URL, so the binding appears and disappears with
   * the panel and there is no second scope concept to keep in sync with the router. The
   * key works wherever focus is, which matters because clicking a card leaves focus on
   * the card: a panel-scoped listener would have made Escape work only after Tab. And it
   * shows up in the `?` sheet, so it is discoverable rather than folklore.
   *
   * Non-global, so `isTextEntryTarget` suppresses it inside an input — Escape in the
   * command palette's filter closes the palette and leaves the panel where it was.
   *
   * The one interaction worth writing down: a Radix layer *without* a text field —
   * a `Select`, a menu — would be dismissed by the same Escape that closes this panel,
   * because both listen on the document and `DismissableLayer` does not always mark the
   * event handled. No such layer opens over the panel today. When one does, the fix is
   * `enabled` on this registration rather than a second stack of layer bookkeeping,
   * which is the reason `shell.escape` is documented-not-handled in the first place.
   */
  useShortcut({
    id: 'issue.peek.close',
    binding: [{ key: 'Escape' }],
    description: 'Close the details panel',
    group: 'View',
    run: close,
  })

  /**
   * On open, move focus into the panel — once per issue, not on every render.
   *
   * Without this, activating a card link leaves focus on the card and a screen reader
   * announces nothing: the panel is a new region that appeared somewhere else in the
   * document, and nothing in the accessibility tree said so. Focusing the container
   * (`tabIndex={-1}`, and labelled) announces the region and its name, and it is what
   * makes the Escape binding above reachable at all.
   *
   * The container and not the close button, deliberately. Focusing the first control
   * would read "Close, button" as the panel's introduction — announcing the exit before
   * the content — and it would also mean a stray Enter dismisses what was just opened.
   *
   * Keyed on `issueKey` so clicking a second card re-announces the new issue, and does
   * not steal focus back from wherever the reader has moved inside the panel.
   */
  useEffect(() => {
    panelRef.current?.focus()
  }, [issueKey])

  return (
    <aside
      ref={panelRef}
      data-slot="issue-peek-panel"
      data-issue-key={issueKey}
      tabIndex={-1}
      aria-label={`${issueKey} details`}
      aria-busy={issue.isPending || undefined}
      className={cn(
        'flex h-full w-detail shrink-0 flex-col overflow-hidden',
        /**
         * A 1px rule and not a shadow. The reference's light panel separates from the
         * canvas with a single hairline at x 1400 in (250,250,250); the dark one draws a
         * 4px near-black band there instead, which is recorded for the colour pass
         * rather than approximated with an opacity here.
         */
        'border-l border-border-subtle bg-panel',
      )}
    >
      <PanelHeader
        issueKey={issueKey}
        watcherState={issue.data?.watcherState}
        closedTo={closedTo}
        onClose={close}
      />

      {issue.isLoadingError ? (
        /**
         * `isLoadingError`, so a failed background refetch does not throw away a panel
         * the reader is in the middle of. The header above stays mounted either way —
         * a panel whose close button vanished with its content is a panel that has to
         * be dismissed with the Back button.
         */
        <ErrorState
          error={issue.error}
          onRetry={() => {
            void issue.refetch()
          }}
          heading="h2"
          className="px-6"
        />
      ) : issue.data === undefined ? (
        <IdentitySkeleton />
      ) : (
        <Identity issue={issue.data} />
      )}

      {/**
       * The thread renders whether or not the issue itself has arrived: it is a
       * separate query on a separate key, and holding it back would turn one slow
       * request into two. It is suppressed only on a hard failure above, where the
       * issue may not exist at all and a thread under an error is a thread for nothing.
       */}
      {!issue.isLoadingError && (
        <>
          <FullDetailsLink issueKey={issueKey} />
          <CommentThread
            issueKey={issueKey}
            currentUserId={currentUserId}
            pinToLatest
            className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-4"
          />
          <CommentComposer issueKey={issueKey} className="mx-6 mb-5" />
        </>
      )}
    </aside>
  )
}

/**
 * Row one: the close button on the left, three actions on the right.
 *
 * ### The cluster's geometry, and the 4.5px that is left over
 *
 * The reference's ink centres are at x 302.5, 348 and 390.5 within the panel. Three
 * `size-9` buttons at `gap-2.5`, right-aligned inside `px-7`, land at 303, 349 and 395
 * — the first two within 1px, the kebab 4.5px right. Recorded rather than nudged: the
 * board's `-mr-2` trick for a kebab moves it to 403 and makes it worse, and a
 * one-off margin on one button in one panel is the kind of correction that reads as a
 * mistake to whoever maintains it next.
 *
 * ### The three on the right are `./issue-actions.tsx`
 *
 * Watch, copy link and more — the same three controls `routes/issue.tsx` puts in its
 * page header, so they live in one file and this one owns only the box around them.
 * Two of the three cannot act yet and both say why; the reasoning is there.
 *
 * What stays here is the `gap-2.5`, which is measured and is the panel's alone.
 */
function PanelHeader({
  issueKey,
  watcherState,
  closedTo,
  onClose,
}: {
  issueKey: string
  watcherState: IssueDetail['watcherState'] | undefined
  closedTo: { pathname: string; search: string }
  onClose: () => void
}) {
  return (
    <div className="mt-10 flex h-9 shrink-0 items-center px-7">
      {/**
       * `mt-10` and not `pt-10`, and the difference is 40 pixels of the whole panel.
       *
       * Tailwind's preflight sets `box-sizing: border-box` on everything, so `h-9`
       * declares the box's *outer* height: `h-9 pt-10` is a 36px box with 40px of
       * padding inside it, which is not a 76px header — it is a 36px header whose
       * content has been pushed out of the bottom of it. The stack above reads
       * `pt-10 → h-9 → ends 76`, and with padding it ended at 36: the disc landed at
       * 97 against a measured 137, and every row of the identity block came up 40px
       * short of the reference.
       *
       * It survived review because the *arithmetic* in the docblock was right and the
       * numbers were checked against each other rather than against a screenshot. What
       * caught it was the reference diff — the disc's own ink band, at 137..178 where
       * the reference has 139..250.
       */}
      {/**
       * A `Link`, not a button, and the `onClick` is an addition rather than the
       * mechanism. Closing the panel *is* a navigation — `?peek=` gone — so the
       * middle-click, the context menu and the status-bar preview all mean something
       * here, and a button would have taken all three away. `onClose` runs beside the
       * router's own handling to put focus back on the card; see `close` above.
       *
       * `rounded-chip bg-surface-2`, which is the reference's own treatment: the × sits
       * in a filled 36px disc while the three on the right have no fill at all. It is
       * the only control in the panel that is drawn as a surface, and that is what makes
       * it findable in a panel whose content changes on every card.
       */}
      <Link
        to={closedTo}
        onClick={onClose}
        aria-label={`Close ${issueKey}`}
        title="Close"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-chip',
          'bg-surface-2 text-fg-muted transition-colors duration-90 ease-out',
          'hover:bg-surface-3 hover:text-fg',
        )}
      >
        <X aria-hidden="true" className="size-4.5" />
      </Link>

      {/**
       * `gap-2.5` is the measured 10px, and it is the one number in this row that is
       * the panel's own — `routes/issue.tsx` draws the same three controls at `gap-3`
       * because its cluster sits beside a 30px title rather than inside a 441px panel.
       */}
      <div className="ml-auto flex items-center gap-2.5">
        <WatchAction issueKey={issueKey} watcherState={watcherState} />
        <CopyLinkAction issueKey={issueKey} />
        <MoreActions issueKey={issueKey} />
      </div>
    </div>
  )
}

/**
 * The identity block: what this issue is, centred, in the reference's own rhythm.
 *
 * Everything here takes its natural height. A summary that wraps to two lines pushes
 * the rule and the thread down by 38px and leaves the composer where it was — which is
 * exactly the difference measured between the two mockups, so the behaviour is the
 * reference's rather than a tolerance.
 *
 * `text-center` throughout, because the reference centres every line of it, and
 * `px-6` so a long summary wraps inside the panel's own inset instead of at its edge.
 */
function Identity({ issue }: { issue: IssueDetail }) {
  /**
   * The description as one clamped preview, not a rendered document.
   *
   * `plainText` rather than `RichText`, and the reason is `line-clamp-2`: the clamp
   * needs `display: -webkit-box` on the element that holds the *lines*, and `RichText`
   * is a `flex-col` of paragraphs — so a clamp on it truncates the stack of paragraphs
   * rather than the text, and two short paragraphs would render in full where one long
   * one is cut. A two-line preview is what `plainText`'s own docblock exists for; the
   * document renders properly on the full page.
   */
  const excerpt = plainText(issue.description)

  return (
    <div className="flex shrink-0 flex-col items-center px-6 text-center">
      {/**
       * The 116px disc. The reference fills it with a photograph; the honest analogue
       * for an issue is its *type*, which is the one attribute that says what kind of
       * thing this is before a word of it is read.
       *
       * `bg-surface-2` and a 48px glyph: the disc has to read as a container at 116px,
       * and a 14px icon floating in it does not. `TypeIcon` owns the type → glyph map
       * (`bug → Bug`, `story → Bookmark`, and a fallback for tenant-defined types), so
       * the panel sizes it rather than picking an icon — reaching for `Bug` from lucide
       * here is how that vocabulary ends up in two files.
       */}
      <TypeIcon
        issueTypeKey={issue.issueTypeKey}
        name={issue.issueTypeName}
        className="mt-15.25 size-29 shrink-0 items-center justify-center rounded-chip bg-surface-2"
        glyphClassName="size-12 text-fg-muted"
      />

      {/**
       * The summary is the panel's heading, and `h2` is the level: `<main>`'s own `h1`
       * is the board's title, and this is a complementary region beside it rather than
       * a section of it. `line-clamp-2` because a 255-character summary is legal and
       * would otherwise push the rule off the panel; the full text is on the page the
       * link below leads to.
       */}
      <h2 className="mt-4 line-clamp-2 text-3xl font-semibold text-fg">{issue.summary}</h2>

      {/**
       * The key line. `IssueKey` is deliberately *not* used: it composes a link to
       * `/browse/:key` and a copy button, and both already exist in this panel — the
       * link as "See full details" and the copy in the header. Three ways to reach one
       * page, stacked 200px apart, is not thoroughness.
       *
       * `select-all` so a double-click takes the whole key rather than stopping at the
       * hyphen, which is the one thing `IssueKey` does here that nothing else would.
       */}
      <p className="flex items-center justify-center gap-1.5 font-mono text-md text-fg-muted">
        <PriorityIcon priority={issue.priority} />
        <span className="select-all">{issue.key}</span>
      </p>

      {excerpt === '' ? (
        /**
         * Designed, not defaulted — §11. One muted line, so the block is 24px shorter
         * rather than 48px emptier, and it says what is true instead of leaving a gap
         * that reads as a failed load.
         */
        <p className="mt-2 text-md text-fg-subtle">No description yet</p>
      ) : (
        <p className="mt-2 line-clamp-2 text-md text-fg-muted">{excerpt}</p>
      )}

      <div className="mt-6.25 flex max-w-full items-center justify-center gap-2.5">
        <StatusChip category={issue.statusCategory} label={issue.statusName} size="lg" />
        <AssigneeChip assignee={issue.assignee} />
      </div>
    </div>
  )
}

/**
 * The second chip: who is on it.
 *
 * `min-w-0` and a truncating label, because a display name has no length bound and the
 * pair of chips has 393px between them. The status chip is `shrink-0` from `Badge`'s
 * own base, so pressure lands here — which is the right order: "In progress" losing
 * characters is worse than "Ada Okaf…", since the status is a closed vocabulary a
 * reader completes from three letters and a name is not.
 *
 * ### `IssueDetailSchema.assignee` is not a `UserRef`, and that is a real gap
 *
 * It is `{ id, displayName, avatarUrl }` — three of `UserRefSchema`'s four fields,
 * hand-inlined, missing `isInactive`. So the `false` below is not a fact this component
 * knows; it is the only value it can supply, and it means **a departed assignee renders
 * here as an ordinary one** while the same person is correctly greyed out in a comment
 * bubble two hundred pixels below, because `CommentSchema.author` *is* a `UserRef`.
 *
 * Two surfaces disagreeing about whether someone still works here is exactly the defect
 * `UserRefSchema`'s docblock was written to prevent. It is not patched with a lookup
 * here: four read models inline these fields (`project.ts:98`, `issue.ts:113`,
 * `issue.ts:117`, `board.ts:223`) and the fix is one change request against all four,
 * not a cast at one call site. Filed; this comment is the evidence for it.
 */
function AssigneeChip({ assignee }: { assignee: IssueDetail['assignee'] }) {
  const user: UserRef | null =
    assignee === null
      ? null
      : {
          id: assignee.id,
          displayName: assignee.displayName,
          avatarUrl: assignee.avatarUrl,
          isInactive: false,
        }

  return (
    <Badge variant="outline" size="lg" data-slot="assignee-chip" className="min-w-0">
      <UserAvatar user={user} size="sm" absentLabel="Unassigned" decorative />
      {/**
       * The name is drawn beside the avatar rather than left to the avatar's `title`.
       * A 24px disc of initials is a reminder for someone who already knows the team
       * and unreadable for anyone who does not, and this is the panel that answers
       * "what is this issue" for a person seeing it for the first time.
       *
       * `decorative` above is the other half of that: with the name in text, the disc's
       * own `role="img"` label would announce it a second time.
       */}
      <span className="truncate">{user === null ? 'Unassigned' : user.displayName}</span>
    </Badge>
  )
}

/**
 * "See full details", straddling a full-bleed rule.
 *
 * The reference's divider ink runs x 0..142 and 296..440 on rows 532..534, with the
 * label's ink at 156..274 on rows 525..541 — so the rule is **full-bleed**, the label
 * sits in a 154px gap punched out of it, and the label's 24px line box is centred on
 * the rule's own centre at y 533. That is a fieldset-and-legend, drawn with a
 * background rather than a border-image.
 *
 * The mask is `px-4.5` and not `px-4`: 154px of gap around 118px of ink leaves 18px a
 * side. At 16 the rule would show through 2px either side of the text, which on a
 * 1px hairline is the difference between a legend and a strikethrough.
 *
 * `-mt-3` is the 12px that centres a 24px line box on the container's top border. The
 * label is a descendant of the bordered box, so its `bg-panel` paints over that border
 * without needing `relative` or a `z-index` — descendant backgrounds are painted after
 * an ancestor's border, which is the one place in CSS where document order alone is
 * enough.
 */
function FullDetailsLink({ issueKey }: { issueKey: string }) {
  return (
    <div className="mt-19.25 shrink-0 border-t border-border-subtle">
      <div className="-mt-3 flex justify-center">
        <Link
          to={paths.issue(issueKey)}
          data-slot="full-details-link"
          className={cn(
            'bg-panel px-4.5 text-md font-medium text-primary-accent',
            'transition-colors duration-90 ease-out hover:text-fg hover:underline',
          )}
        >
          See full details
          {/**
           * The visible label is four words and the announced one names the issue,
           * because a screen-reader user listing this panel's links hears "See full
           * details" with no subject — and the panel's own label is the only thing that
           * would have disambiguated it, two hundred pixels of content earlier.
           */}
          <span className="sr-only"> for {issueKey}</span>
        </Link>
      </div>
    </div>
  )
}

/**
 * The identity block, while it loads.
 *
 * The same boxes at the same sizes in the same order, which is the whole point:
 * `docs/specs/web/README.md` §11 asks for a placeholder in the shape of the content it
 * stands in for, and the measurable version of that is that nothing moves when the data
 * lands. A spinner in a 400px block moves everything.
 *
 * The summary is two lines at unequal widths rather than one full-width bar, because a
 * summary that wraps is the common case here and a single bar promises a shorter title
 * than usually arrives.
 */
function IdentitySkeleton() {
  return (
    <div className="flex shrink-0 flex-col items-center px-6" aria-hidden="true">
      {/**
       * The heights are the real line boxes minus the 4px that separates two bars, so
       * each pair sums to what the type occupies: 36 + 4 + 36 = 76 for two `text-3xl`
       * lines, and 22 + 4 + 22 = 48 for two `text-md` ones. A skeleton that is a
       * *little* shorter than its content is the shape that shifts the rule below it.
       */}
      <Skeleton className="mt-15.25 size-29 rounded-chip" />
      <Skeleton className="mt-4 h-9 w-[78%]" />
      <Skeleton className="mt-1 h-9 w-[52%]" />
      <Skeleton className="mt-2 h-6 w-24" />
      <Skeleton className="mt-2 h-5.5 w-[86%]" />
      <Skeleton className="mt-1 h-5.5 w-[64%]" />
      <div className="mt-6.25 flex items-center gap-2.5">
        <Skeleton className="h-11 w-36 rounded-chip" />
        <Skeleton className="h-11 w-32 rounded-chip" />
      </div>
    </div>
  )
}

/**
 * `CSS.escape`, with a fallback for the one environment that lacks it.
 *
 * The selector above interpolates an issue key into an attribute value, and an
 * unescaped `"` in it would end the attribute string and change the selector's meaning.
 * `IssueKeySchema` is `PROJ-123` and cannot contain one — but a selector built by
 * string concatenation from *any* outside value is the pattern that goes wrong when the
 * schema later loosens, and this is a one-line inoculation against that.
 *
 * `CSS` is absent in a bare Node environment, which is where the unit tests for this
 * file run; the fallback strips everything the key's own grammar does not allow rather
 * than trying to escape it, because a key that needs escaping is already not a key.
 */
function cssEscape(value: string): string {
  const css: typeof CSS | undefined = globalThis.CSS
  if (css !== undefined && typeof css.escape === 'function') return css.escape(value)
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}
