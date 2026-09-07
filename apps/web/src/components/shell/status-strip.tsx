import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * One row, at the very top of the window, saying something is not right.
 *
 * `docs/specs/web/shell.md` §11 asks for *"a persistent, non-blocking indicator"* and
 * the shell now has two things that need to be exactly that — offline, and a refresh
 * that failed. They are different conditions with different copy, but they are the
 * same object: the same height, the same colour, the same place, and at most one of
 * them visible at a time. Written twice they would drift by a pixel and then by a
 * colour, and the product bar's *"Reuse over duplication"* is aimed at precisely
 * this.
 *
 * ### The height is load-bearing
 *
 * `h-6` and `shrink-0`, inside `ShellFrame`'s `flex-col`, so the strip *takes* its
 * row rather than floating over one. A banner overlaying the header would cover the
 * search field the moment the network wobbled. `shrink-0` is what stops the flex
 * container reclaiming the row when the content below is tall.
 *
 * ### `role` is the caller's decision
 *
 * `status` is polite and `alert` interrupts, and which is correct depends on whether
 * the user needs to know *now*. Both current callers pass `status`: losing a network
 * and failing a refresh are conditions to notice, not to be spoken over mid-sentence.
 * The prop exists because the third caller may differ, and because a live region
 * silently defaulting to the wrong politeness is not something a reviewer would see.
 */
export interface StatusStripProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Rendered `aria-hidden` — the sentence beside it is the accessible content. */
  icon: LucideIcon
  children: ReactNode
  /**
   * An optional control on the right. A "Try again", typically.
   *
   * `| undefined` explicitly, because `exactOptionalPropertyTypes` is on: without it a
   * caller cannot pass the prop *and* pass `undefined`, which is what every conditional
   * `action={x ? <Button /> : undefined}` does. `../conventions.test.ts` enforces it
   * across the tree, and it is what caught this line.
   */
  action?: ReactNode | undefined
}

export function StatusStrip({
  icon: Icon,
  children,
  action,
  className,
  ...props
}: StatusStripProps) {
  return (
    <div
      className={cn(
        'flex h-6 shrink-0 items-center justify-center gap-2 px-3 text-sm',
        'bg-warning-soft text-warning-soft-fg',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {/**
       * `truncate` rather than wrap. The row is a fixed height so it cannot grow, and
       * a second line inside `h-6` would be clipped mid-glyph — which looks like a
       * rendering bug rather than a long sentence. Both messages are written to fit;
       * this is the guard for the narrow viewport where the shorter one does not.
       */}
      <span className="truncate">{children}</span>
      {action}
    </div>
  )
}
