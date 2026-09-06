import type { IssueKey as IssueKeyValue } from '@flux/contracts'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * The issue key as chrome: mono, copyable, and a link only when the caller
 * already knows where it goes.
 *
 * `apps/web/src/lib/paths.ts` is owned by another agent this session. Inventing
 * a URL shape here would race that file and bake a guess into every board card.
 * `href` is therefore a prop, not a derivation.
 */
type CopyOutcome = 'idle' | 'copied' | 'failed'

export interface IssueKeyProps {
  issueKey: IssueKeyValue
  href?: string | undefined
  className?: string | undefined
}

export function IssueKey({ issueKey, href, className }: IssueKeyProps) {
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

  const copy = () => {
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard === undefined) {
      setOutcome('failed')
      return
    }
    void clipboard.writeText(issueKey).then(
      () => {
        setOutcome('copied')
      },
      () => {
        setOutcome('failed')
      },
    )
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
      {href !== undefined ? (
        <a href={href} className="min-w-0 text-fg-muted hover:text-fg hover:underline">
          {keyNode}
        </a>
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
