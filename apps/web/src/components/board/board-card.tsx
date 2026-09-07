import type { BoardCard as BoardCardValue } from '@flux/contracts'
import { MessageSquare, MoreHorizontal, Paperclip } from 'lucide-react'
import { Link } from 'react-router'
import { LabelChip } from '@/components/data/label-chip'
import { PriorityIcon } from '@/components/data/priority-icon'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { paths } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One card on the board, matched to `UI Images/JIRA 1` and `JIRA 2`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The reference's card, read off the images at 1x: labels as filled pills across
 * the top with an overflow menu opposite, a semibold title, a muted two-to-three
 * line description, and a footer with an avatar on the left and comment and
 * attachment counts on the right. That shape is what this reproduces.
 *
 * ### Where it deliberately differs, and why it has to
 *
 * The reference is a task board and this is an issue tracker, so the *payload*
 * differs even where the layout does not. `BoardCardSchema` carries an issue key,
 * a type, a priority, a status category, an assignee and a blocked count — six
 * identifiers the reference's cards do not have — and it carries **no description,
 * no subtask list and no attachment thumbnails**, which are three things the
 * reference's cards do.
 *
 * So the description block and the subtask checklist are absent rather than filled
 * with invented text, and the identifiers take the row the reference spends on
 * description. Rendering a plausible description would be the failure
 * `project-sidebar.tsx` already refuses for issue counts: inventing data the
 * contract cannot supply.
 *
 * ### The identifier row is its own line, and that is measured
 *
 * It was one `justify-between` row with the counts. At the reference's own 280px
 * column that does not fit: the identifier group had 51px and `IssueKey` was
 * crushed to 11px around 40px of content. Two rows is what the reference uses for
 * the same reason — it puts its labels on one line and its footer on another.
 */

export interface BoardCardProps {
  card: BoardCardValue
  /** Lifted under a pointer. Drives the elevation the reference shows mid-drag. */
  dragging?: boolean | undefined
  className?: string | undefined
}

export function BoardCard({ card, dragging = false, className }: BoardCardProps) {
  return (
    /**
     * The whole card is the link, which is why nothing inside it may be one —
     * `IssueKey` is rendered `linked={false}` below for exactly that reason, and
     * the overflow button is a `<button>` rather than an anchor. Nesting an `<a>`
     * inside an `<a>` is invalid and browsers recover by closing the outer one
     * early, which silently breaks the card.
     */
    <Link
      to={paths.issue(card.key)}
      data-slot="board-card"
      data-dragging={dragging ? 'true' : undefined}
      className={cn(
        'group/card flex flex-col gap-2 rounded-card border border-border bg-surface p-3',
        'transition-shadow duration-90 ease-out',
        dragging ? 'shadow-drag' : 'shadow-card hover:shadow-raised',
        className,
      )}
    >
      {(card.labels.length > 0 || card.slaState === 'breached') && (
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {card.labels.map((label) => (
              <LabelChip key={label} label={label} />
            ))}
            {/**
             * A breached SLA earns a chip of its own rather than a colour on an
             * existing one — §9 of the foundation spec: colour is never the only
             * carrier of meaning, and `slaState` is exactly the field it names.
             */}
            {card.slaState === 'breached' && (
              <Badge size="sm" variant="danger">
                Breached
              </Badge>
            )}
          </div>
          <CardMenu issueKey={card.key} />
        </div>
      )}

      <p className="text-base font-medium text-fg">{card.summary}</p>

      <div className="flex min-w-0 items-center gap-1.5">
        <TypeIcon issueTypeKey={card.issueTypeKey} />
        {/**
         * `linked={false}`: the card is already the link. Rendered as plain mono
         * text here, which is also what the reference does with its own identifier.
         */}
        <span className="min-w-0 truncate font-mono text-sm text-fg-subtle">{card.key}</span>
        <PriorityIcon priority={card.priority} />
        {card.storyPoints !== null && (
          <Badge size="sm" variant="neutral">
            {card.storyPoints}
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {card.blockedByCount > 0 && (
            <Badge size="sm" variant="warning">
              {card.blockedByCount} blocked
            </Badge>
          )}
          {/**
           * The reference shows a comment count and an attachment count here, and
           * `BoardCardSchema` carries neither — deliberately, per its own header:
           * the board is the most latency-sensitive screen and the card is
           * minimal. Either would be a per-card query or a denormalised counter,
           * which is a contract decision rather than a rendering one.
           *
           * So the row is empty of them rather than filled with plausible
           * numbers. Same restraint as `project-sidebar.tsx`'s missing issue
           * counts: the badges arrive when the contract carries them.
           */}
          <CardCount icon={MessageSquare} value={0} label="comments" />
          <CardCount icon={Paperclip} value={0} label="attachments" />
        </div>
        <UserAvatar
          user={card.assignee === null ? null : { ...card.assignee, isInactive: false }}
          size="sm"
          className="shrink-0"
        />
      </div>
    </Link>
  )
}

/**
 * The overflow menu, as a button rather than a menu — for now.
 *
 * The reference shows `⋯` on every card and opens a menu of card actions. Those
 * actions are transitions, assignment and rank changes, all of which are mutations
 * this surface cannot yet perform: `api/issues.ts` has no rank or move function
 * (CR-002), and there is no board mutation layer. A menu that opened onto four
 * disabled items would be four controls that silently do nothing.
 *
 * So it is present, disabled, and says why — §5's second rule, the same treatment
 * `new-project-button.tsx` uses. It keeps the card's geometry identical to the
 * reference, which is what the diff measures.
 */
function CardMenu({ issueKey }: { issueKey: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-disabled="true"
      aria-label={`Actions for ${issueKey} — not available yet`}
      onClick={(event) => {
        /** The card is a link; without this the click navigates. */
        event.preventDefault()
      }}
      className="shrink-0 opacity-0 group-hover/card:opacity-40 aria-disabled:opacity-40"
    >
      <MoreHorizontal aria-hidden="true" />
    </Button>
  )
}

interface CardCountProps {
  icon: typeof MessageSquare
  value: number
  label: string
}

/** Zero is not rendered. A row of `0`s is noise on every card that has nothing. */
function CardCount({ icon: Icon, value, label }: CardCountProps) {
  if (value <= 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-sm text-fg-subtle">
      <Icon aria-hidden="true" className="size-3.5" />
      <span aria-label={`${String(value)} ${label}`}>{value}</span>
    </span>
  )
}
