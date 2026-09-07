import type { Priority } from '@flux/contracts'
import {
  ChevronsDown,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  Minus,
  OctagonAlert,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/cn'

/**
 * Priority as a glyph plus a name, never as colour alone.
 *
 * `PrioritySchema` is a closed enum, so the map is exhaustive. The label is
 * the accessible name; the icon is `aria-hidden` because announcing both
 * "high" and a chevron is noise.
 *
 * ### `null` is "no priority", and never "loading"
 *
 * `BoardCardSchema.priority` and `IssueSchema.priority` are both `.nullable()`, and
 * the null means the field is unset — a perfectly ordinary state for an issue
 * nobody has triaged. Rendering a `Skeleton` for it, as this did, animated a promise
 * of data that was never coming on every untriaged card. See `./user-avatar.tsx` for
 * the same fix and the reasoning about where loading states actually belong.
 *
 * ### Why there is a runtime fallback under a closed enum
 *
 * **The compiler now says this branch is unreachable, and it is still correct to
 * keep.** Do not delete it as dead code.
 *
 * It was written because `BoardCardSchema.priority` was `z.string().nullable()`
 * while this prop was `Priority | null`, so every board call site needed a cast —
 * and an unmapped string made `PRIORITY[priority]` `undefined`, `reading.Icon`
 * threw, and one odd value on one card out of two hundred blanked the whole board
 * through the error boundary. That contract gap is closed:
 * `docs/change-requests/006-board-card-priority-type.md` is **accepted and
 * landed**, both the board card and the event snapshot now use
 * `PrioritySchema.nullable()`, and the casts are gone.
 *
 * What remains is the case a type cannot rule out. A deploy that adds a seventh
 * priority is served to tabs that are already open, running the previous bundle,
 * whose `PRIORITY` map has six keys. The response parses — the *server's* schema
 * knows the new value — and this component receives a `Priority` it has never
 * heard of. Without the fallback that is a thrown `TypeError` mid-render on a
 * board somebody is dragging cards around, which
 * `docs/product-quality-bar.md` rules out under partial failure: one unknown row
 * must degrade to a visible oddity, never take out the surface. The fallback
 * renders the unknown key as its own label with a neutral glyph.
 *
 * `priority-icon.test.tsx` pins it, and the test needs a cast to reach it —
 * that cast is the test doing its job, not a leak.
 */
const PRIORITY = {
  blocker: { label: 'Blocker', Icon: OctagonAlert, className: 'text-danger-accent' },
  critical: { label: 'Critical', Icon: ChevronsUp, className: 'text-danger-accent' },
  high: { label: 'High', Icon: ChevronUp, className: 'text-warning-accent' },
  medium: { label: 'Medium', Icon: Equal, className: 'text-fg-muted' },
  low: { label: 'Low', Icon: ChevronDown, className: 'text-fg-muted' },
  trivial: { label: 'Trivial', Icon: ChevronsDown, className: 'text-fg-subtle' },
} as const satisfies Record<
  Priority,
  { label: string; Icon: ComponentType<{ className?: string }>; className: string }
>

export interface PriorityIconProps {
  /** The priority, or `null` when the field is unset. Never a loading sentinel. */
  priority: Priority | null
  /** What an unset priority is called. The accessible name. */
  absentLabel?: string | undefined
  /**
   * Draw the name as visible text beside the glyph.
   *
   * For the places where the priority is a *stated field* rather than a mark in a
   * dense row — the issue page's details list. A chevron alone is unreadable there:
   * `<dt>Priority</dt>` followed by a `<dd>` holding an up-arrow asks the reader to
   * know a legend that is nowhere on screen, which is what §9 means by never colour
   * (or shape) alone.
   *
   * It is a prop on this component rather than a `<span>` beside it at the call site,
   * because the vocabulary — which word goes with which glyph, including the fallback
   * for a priority added by a deploy this bundle has not seen — has to stay in one
   * file. A call site rendering its own label is how "Blocker" and "Blocking" end up
   * in the product at the same time.
   *
   * The wrapper drops `role="img"` and its label when this is set: the text *is* the
   * accessible name, and keeping both announced it twice.
   */
  showLabel?: boolean | undefined
  className?: string | undefined
}

export function PriorityIcon({
  priority,
  absentLabel = 'No priority',
  showLabel = false,
  className,
}: PriorityIconProps) {
  const reading =
    priority === null
      ? { label: absentLabel, Icon: Minus, className: 'text-fg-subtle' }
      : (PRIORITY[priority] ?? { label: priority, Icon: Minus, className: 'text-fg-subtle' })
  const Icon = reading.Icon

  /**
   * `data-priority` stays absent for the unset case rather than carrying `"none"`.
   * There is no such value in `PrioritySchema`, and a selector or a test matching on it
   * would be asserting a vocabulary the contract does not have.
   */
  const identity = {
    'data-slot': priority === null ? 'priority-icon-absent' : 'priority-icon',
    'data-priority': priority ?? undefined,
  } as const

  const glyph = <Icon aria-hidden="true" className={cn('size-3.5', reading.className)} />

  if (showLabel) {
    return (
      <span {...identity} className={cn('inline-flex items-center gap-1.5', className)}>
        {glyph}
        {reading.label}
      </span>
    )
  }

  return (
    <span
      {...identity}
      role="img"
      aria-label={reading.label}
      title={reading.label}
      className={cn('inline-flex', className)}
    >
      {glyph}
    </span>
  )
}
