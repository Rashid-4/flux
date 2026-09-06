import type { IssueKey as IssueKeyValue } from '@flux/contracts'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from '@/components/data/toaster'
import { Button } from '@/components/ui/button'
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
type CopyOutcome = 'idle' | 'copied' | 'failed'

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
  const [outcome, setOutcome] = useState<CopyOutcome>('idle')

  useEffect(() => {
    if (outcome === 'idle') return
    const timer = setTimeout(() => {
      setOutcome('idle')
    }, 4000)
    return () => {
      clearTimeout(timer)
    }
  }, [outcome])

  /**
   * A blocked clipboard has to be visible, not only announced.
   *
   * `navigator.clipboard` is absent on any non-secure origin and `writeText` rejects
   * outright when the permission is denied or the document is not focused — none of
   * which the user did anything to cause. The sr-only live region alone left a
   * sighted user pressing a button that did nothing, which
   * `docs/product-quality-bar.md` §13 calls worse than one that says why it cannot.
   * So the failure also takes the tone that does not expire, and it names the key,
   * because "copy failed" with an unknown subject is not actionable when there are
   * forty of these on screen.
   */
  const reportFailure = () => {
    setOutcome('failed')
    toast({
      title: `Could not copy ${issueKey}`,
      description: 'Your browser blocked clipboard access. Select the key and copy it manually.',
      tone: 'danger',
    })
  }

  const copy = () => {
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard === undefined) {
      reportFailure()
      return
    }
    void clipboard.writeText(issueKey).then(() => {
      setOutcome('copied')
    }, reportFailure)
  }

  const keyNode = (
    <code
      data-slot="issue-key-text"
      className="max-w-40 truncate font-mono text-sm text-fg-muted select-all"
      title={issueKey}
    >
      {issueKey}
    </code>
  )

  return (
    <span
      data-slot="issue-key"
      className={cn('inline-flex min-w-0 items-center gap-0.5', className)}
    >
      {linked ? (
        <Link
          to={paths.issue(issueKey)}
          className="min-w-0 text-fg-muted hover:text-fg hover:underline"
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
        {outcome === 'copied' ? `Copied ${issueKey}` : outcome === 'failed' ? 'Copy failed' : ''}
      </span>
    </span>
  )
}
