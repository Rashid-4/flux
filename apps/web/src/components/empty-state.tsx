import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Nothing here yet, said in a way that tells the user what to do next.
 *
 * docs/product-quality-bar.md lists "empty" as one of the states every feature is
 * verified in, and the failure it is guarding against is not a crash — it is a
 * screen that renders a heading, a border and 400px of nothing. A user cannot tell
 * that apart from a load that silently failed, so they reload, and it looks the
 * same again.
 *
 * Three parts, and the third is what makes this worth a component: a **title** that
 * says what is absent, a **detail** that says why that is normal, and an **action**
 * that resolves it. An empty state with no way out of it is a dead end with better
 * typography.
 *
 * ### Not an error
 *
 * `role` is deliberately absent. Nothing is wrong — an empty backlog on a project
 * that starts on Monday is the correct state of the world, and announcing it as an
 * alert would interrupt a screen-reader user to tell them so. ./error-state.tsx is
 * the one that carries `role="alert"`, and the two are separate components rather
 * than one with a `variant` precisely so this distinction cannot be made by
 * accident.
 */
export interface EmptyStateProps {
  /**
   * A Lucide icon, sized by the caller.
   *
   * The caller passes the element rather than a name so this file imports no icons
   * of its own: AGENTS.md's rule is one Lucide import at a time at the point of use,
   * because a component that maps a string to an icon defeats tree-shaking and ships
   * the whole set.
   *
   * It is rendered inside an `aria-hidden` wrapper. The icon is never the message —
   * an inbox glyph tells a screen-reader user nothing the title does not already
   * say, and announcing it would be noise.
   */
  icon?: ReactNode
  /** What is absent. Sentence case, no trailing stop — "No issues in this sprint". */
  title: string
  /**
   * Why that is normal, or what to do about it. One sentence.
   *
   * Optional because some titles carry the whole message, and a detail line added
   * to fill the space ends up restating the title in more words.
   */
  detail?: string
  /**
   * The way out. Usually one `<Button>`; occasionally two, primary first.
   *
   * Rendered only when passed, and the caller decides whether to pass it — an
   * action the user lacks permission for must not be drawn as a disabled button
   * they cannot explain, and permission is a fact the caller has and this component
   * does not.
   */
  children?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, detail, children, className }: EmptyStateProps) {
  /**
   * `undefined`, `null` and `false` all mean "no action", and all three arrive in
   * practice: `undefined` from omitting the prop, `false` from a caller writing
   * `{canDoThing && <Button />}`, and `null` from a permission-gated component that
   * renders nothing — ./new-project-button.tsx does exactly that.
   *
   * Checking only for `undefined` would render the action row for the other two, which
   * is an empty flex container with a 4px top margin: invisible on its own, and
   * visible as an off-centre empty state once you know it is there. Three explicit
   * comparisons rather than a truthiness test, because `eqeqeq` is on and because
   * `Boolean(children)` would also discard the string `''` and the number `0`, neither
   * of which is a sensible action but neither of which this component should be
   * silently deciding about.
   */
  const hasAction = children !== undefined && children !== null && children !== false

  return (
    <div
      data-slot="empty-state"
      /**
       * `py-12` and centred, so this reads as a deliberate state rather than as
       * content that failed to fill its container. `max-w-sm` on the text keeps the
       * detail line to a readable measure on a wide board column; without it the
       * sentence stretches the full width of a 27" monitor.
       */
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {icon !== undefined && (
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-chip bg-surface-3 text-fg-subtle"
        >
          {icon}
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-md font-medium text-fg">{title}</p>
        {/**
         * `break-words` on the detail, not on the title. Detail lines quote things the
         * user typed — a filter query, a project key out of the address bar — and an
         * unbroken 60-character paste would otherwise widen this block past its
         * `max-w-sm` and push the empty state off centre. `break-words`
         * (`overflow-wrap: break-word`) only breaks a word that cannot fit on its own
         * line, so ordinary prose is unaffected; `break-all` would hyphenate
         * everything.
         */}
        {detail !== undefined && <p className="text-base break-words text-fg-muted">{detail}</p>}
      </div>
      {hasAction && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{children}</div>
      )}
    </div>
  )
}
