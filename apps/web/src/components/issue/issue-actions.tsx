import type { IssueDetail } from '@flux/contracts'
import { Check, EllipsisVertical, Eye, EyeOff, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { paths } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The three issue actions, shared by the panel header and the page header.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `issue-peek-panel.tsx` and `../../routes/issue.tsx` draw the same cluster — watch,
 * copy link, more — and they were the same forty lines twice until this file existed.
 * §31: the two callers disagree about the *box* (the panel right-aligns them inside
 * `px-7` at `gap-2.5`, measured; the page header hands them to
 * `SurfaceHeader`'s `actions` slot at `gap-3`) and agree about every control inside it,
 * so the controls are here and the cluster is not.
 *
 * ### Two of the three cannot act yet, and both say so
 *
 * Watching needs a mutation and the menu needs a page of them; neither exists.
 * `docs/product-quality-bar.md` §5 is explicit that an action you cannot perform is
 * *shown* and explains itself rather than being hidden, and §13 that a control which
 * silently does nothing is worse than one that says why it cannot. So both carry
 * `aria-disabled`, a `title`, and the reason inside their accessible name.
 *
 * **`aria-disabled` and not `disabled`.** A `disabled` button is removed from the tab
 * order, which takes the explanation away from precisely the user who cannot hover to
 * read it. `Button`'s `aria-disabled:` variants carry the dimmed appearance, and the
 * `onClick` below calls `preventDefault` so the control is inert in fact as well as in
 * attribute.
 *
 * The watch button is worth drawing *because* it reads real state:
 * `IssueDetailSchema.watcherState` is `watching | muted | none`, so the glyph and the
 * label report what is true today even though pressing it cannot change it.
 */

/** Why the two inert controls are inert. One sentence, used in three places. */
export const MUTATION_REASON = 'Editing arrives with the issue mutation layer'

/**
 * A `size-5` glyph in a `size-9` ghost button, in both callers.
 *
 * 20px rather than `Button`'s own 16px default: these sit beside a 30px title in one
 * caller and a 116px disc in the other, and 16px reads as a hint rather than a control
 * at either scale. Stated once here so the two headers cannot drift by a rung.
 */
const GLYPH = 'size-5'

export interface WatchActionProps {
  issueKey: string
  /**
   * `undefined` while the issue is still loading.
   *
   * The button is drawn anyway, showing the not-watching glyph, because it is part of
   * the header's geometry — a control that appears when the request lands is a header
   * that moves under the pointer. The label says "not watching" rather than guessing,
   * which is the honest reading of a state that has not arrived.
   */
  watcherState?: IssueDetail['watcherState'] | undefined
}

export function WatchAction({ issueKey, watcherState }: WatchActionProps) {
  const watching = watcherState === 'watching'
  const label =
    watcherState === 'muted' ? 'Muted' : watching ? 'Watching this issue' : 'Not watching'

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-disabled="true"
      aria-label={`${label} — ${issueKey} cannot be watched yet. ${MUTATION_REASON}.`}
      title={`${label}. ${MUTATION_REASON}.`}
      onClick={(event) => {
        event.preventDefault()
      }}
      className="text-fg-muted aria-disabled:opacity-70"
    >
      {watcherState === 'muted' ? (
        <EyeOff aria-hidden="true" className={GLYPH} />
      ) : (
        /**
         * The accent is the *only* thing distinguishing watching from not watching at a
         * glance, so it is not the only signal: the accessible name and the tooltip both
         * say which state this is in words. §9 — never colour alone.
         */
        <Eye aria-hidden="true" className={cn(GLYPH, watching && 'text-primary-accent')} />
      )}
    </Button>
  )
}

/**
 * The one that works.
 *
 * It copies an absolute URL rather than the issue key — `../data/issue-key.tsx` does
 * the key, and the two are different payloads for different jobs: a key goes in a
 * sentence, a link goes in a chat message. The confirmation is the glyph swapping to a
 * check for four seconds plus the live region below it, and a browser that blocks the
 * clipboard raises a toast rather than doing nothing. All three behaviours live in
 * `lib/clipboard.ts`.
 *
 * The live region is inside this component rather than beside it, so a caller cannot
 * render the button and forget the announcement — which is the failure mode of every
 * "remember to also add" API.
 */
export function CopyLinkAction({ issueKey }: { issueKey: string }) {
  const link = useCopyToClipboard({
    /**
     * An absolute URL, because the point of copying it is to paste it somewhere that is
     * not this app. `location.origin` rather than a configured base: this must be the
     * host the reader is actually on, or the link they hand a colleague opens the wrong
     * environment.
     */
    value: `${window.location.origin}${paths.issue(issueKey)}`,
    label: 'link',
    fallbackHint: 'Open the issue and copy the address from your browser.',
  })

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={link.copy}
        aria-label={`Copy a link to ${issueKey}`}
        title="Copy link"
        className="text-fg-muted"
      >
        {link.outcome === 'copied' ? (
          <Check aria-hidden="true" className={cn(GLYPH, 'text-success-accent')} />
        ) : (
          <Link2 aria-hidden="true" className={GLYPH} />
        )}
      </Button>
      <span role="status" className="sr-only">
        {link.announcement}
      </span>
    </>
  )
}

export function MoreActions({ issueKey }: { issueKey: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-disabled="true"
      aria-label={`More actions for ${issueKey} — not available yet. ${MUTATION_REASON}.`}
      title={MUTATION_REASON}
      onClick={(event) => {
        event.preventDefault()
      }}
      className="text-fg-muted aria-disabled:opacity-70"
    >
      <EllipsisVertical aria-hidden="true" className={GLYPH} />
    </Button>
  )
}
