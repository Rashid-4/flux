import type { IssueKey as IssueKeyValue } from '@flux/contracts'
import { Check, Copy } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { paths } from '@/lib/paths'

/**
 * The issue key as chrome: mono, copyable, and a link to the issue it names.
 *
 * ### It derives its own link
 *
 * `paths.issue(issueKey)` takes the key and nothing else — `/browse/:issueKey`,
 * because a key already names its project. So there is nothing for a caller to
 * supply, and requiring an `href` prop would mean every board card, every backlog
 * row and every search result had to remember to pass one, with a wrong value
 * silently possible in each. The component knows where an issue key goes.
 *
 * `linked={false}` is for the one case that is not a preference: a card whose whole
 * surface is already a link. Nesting an `<a>` inside an `<a>` is invalid HTML, and
 * browsers recover from it by closing the outer anchor early, which breaks the card.
 *
 * ### Why the router's `Link`
 *
 * A raw `<a href>` is a document navigation. It works, it looks identical, and it
 * throws away the query cache, the board's scroll position and every open popover
 * to fetch a fresh bundle — a several-hundred-millisecond flash of blank page where
 * a client transition is instant. `Link` is what the rest of the app uses; this was
 * the only anchor in the product that was not.
 */
export interface IssueKeyProps {
  issueKey: IssueKeyValue
  /**
   * Render the key as a link to the issue. Default `true`. Pass `false` when an
   * ancestor is already the link, or the markup is invalid.
   */
  linked?: boolean | undefined
  className?: string | undefined
}

export function IssueKey({ issueKey, linked = true, className }: IssueKeyProps) {
  /**
   * The transient confirmation, the reset timer and the visible failure all live in
   * `lib/clipboard.ts`. They were written here first and moved when
   * `issue/issue-peek-panel.tsx` needed the same behaviour for the issue's URL — see
   * that hook's header for why a blocked clipboard is the ordinary case rather than the
   * edge case, and why the toast is not the caller's option to omit.
   *
   * The key names itself in the failure, because "copy failed" with an unknown subject
   * is not actionable when there are forty of these on screen.
   */
  const { outcome, announcement, copy } = useCopyToClipboard({
    value: issueKey,
    label: issueKey,
    fallbackHint: 'Select the key and copy it manually.',
  })

  /**
   * ### Why `block` is on a `<code>`, and why it is load-bearing
   *
   * This was `max-w-40 truncate` on a default-`display:inline` element, and **both
   * halves were inert.** `max-width` and `overflow` do not apply to a non-replaced
   * inline box, so the key never truncated and never capped — it simply grew, and
   * pushed itself out of whatever it was inside. Measured on a 96px container: the
   * component rendered 149px wide and overflowed by 53px, with `scrollWidth`
   * reporting 0 because an inline box has no scroll box to report.
   *
   * `min-w-0` matters for the opposite direction. Squeezed onto a 280px board card
   * beside a status chip and an avatar, the whole component was crushed to **11px
   * with 58px of content** — the key illegible and the copy button drawn over it.
   * A flex item will not shrink below its content unless told it may, and the
   * ellipsis is what makes shrinking survivable.
   *
   * The floor is the other half of that. Truncating an identifier is already a
   * cost — `FLUX-12…` and `FLUX-128` are different issues — so it degrades to
   * something readable and stops, rather than to a sliver. Past the floor the key
   * overflows its parent visibly, which is a layout that needs fixing at the
   * surface rather than a defect this component can absorb quietly. `title` and
   * `select-all` keep the full value reachable either way.
   */
  const keyNode = (
    <code
      data-slot="issue-key-text"
      className="block max-w-40 min-w-10 truncate font-mono text-sm text-fg-muted select-all"
      title={issueKey}
    >
      {issueKey}
    </code>
  )

  return (
    <span
      data-slot="issue-key"
      className={cn('inline-flex max-w-full min-w-0 items-center gap-0.5', className)}
    >
      {linked ? (
        <Link
          to={paths.issue(issueKey)}
          className="block min-w-0 text-fg-muted hover:text-fg hover:underline"
        >
          {keyNode}
        </Link>
      ) : (
        keyNode
      )}
      <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={`Copy ${issueKey}`}>
        {outcome === 'copied' ? (
          <Check aria-hidden="true" className="text-success-accent" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </span>
  )
}
