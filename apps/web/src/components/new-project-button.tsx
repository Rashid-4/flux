import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'

/**
 * "New project" — visible, disabled, and explicit about why.
 *
 * One component because it appears twice: pinned to the bottom of the sidebar and in
 * the projects page header. Two copies would be two places to remember to make live,
 * and the one that got missed would be a button that does nothing next to one that
 * works.
 *
 * ### Why it is rendered at all
 *
 * docs/product-quality-bar.md §13: *"a control that silently does nothing is worse
 * than one that says why it cannot."* Omitting it entirely would also satisfy that —
 * but this user *can* create projects, and the affordance belongs where they will look
 * for it. Showing it disabled with a reason answers the question they are about to
 * ask; hiding it leaves them hunting through settings for a thing that is not there.
 *
 * Creating a project means a key, a template, a workflow and a permission scheme —
 * that is the project-settings surface, not a dialog to bolt on here. When it exists,
 * this becomes live in one file: drop `aria-disabled`, the opacity class and the
 * `preventDefault` click, and open the dialog instead.
 */
export interface NewProjectButtonProps {
  /**
   * `bootstrap.orgPermissions.canCreateProject`.
   *
   * A required prop rather than read from context inside, so this component works in
   * the sidebar (which has bootstrap) and in a page (which has it through the outlet)
   * without either of them being the wrong shape. Permission booleans come from
   * bootstrap and are never inferred — docs/specs/web/README.md §4.
   */
  permitted: boolean
  size?: 'sm' | 'md'
  /**
   * Which side the explanation opens on.
   *
   * A prop rather than a constant because the two call sites sit in opposite corners of
   * the screen. In the page header there is room below; pinned to the bottom of the
   * sidebar there is not, and `right` puts the tooltip over the content area where the
   * space actually is. Radix collision-detection would flip a bottom-side tooltip to
   * `top` there, which lands it on top of the project list it is explaining.
   */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

export function NewProjectButton({
  permitted,
  size = 'md',
  tooltipSide = 'bottom',
  className,
}: NewProjectButtonProps) {
  if (!permitted) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/**
         * ### `aria-disabled`, not `disabled`
         *
         * A truly `disabled` button is removed from the tab order and dispatches no
         * pointer events at all — so the tooltip explaining *why* it cannot be used
         * would never open, for exactly the control that needs an explanation. The
         * usual workaround is a focusable `<span>` wrapper around the button, which
         * trades one problem for a non-semantic element carrying `tabIndex` and a
         * screen-reader announcement that says nothing about being unavailable.
         *
         * `aria-disabled="true"` keeps the real button, in the tab order, announced as
         * dimmed/unavailable, and still receiving hover and focus — so the reason is
         * reachable by pointer *and* by keyboard. axe agrees it is inactive: its
         * `color-contrast` rule skips any node `aria-disabled="true"`, so the 50%
         * opacity is exempt under WCAG 2.2 1.4.3 the same way a native `disabled`
         * would be.
         *
         * `aria-disabled:opacity-50` is here rather than in `ui/button.tsx` because
         * that file's `disabled:` pair is correct for a genuinely disabled button; this
         * is the one control in the app that is deliberately inert-but-reachable.
         */}
        <Button
          variant="secondary"
          size={size}
          aria-disabled="true"
          /**
           * The button has no action, and this is what makes that honest rather than
           * silent. Radix composes handlers with `checkForDefaultPrevented`, so
           * calling `preventDefault()` here suppresses `TooltipTrigger`'s own
           * `onClick`, which would otherwise *close* the tooltip. A user who clicks
           * the unavailable control keeps the sentence that explains it, instead of
           * clicking and watching the only explanation disappear.
           */
          onClick={(event) => {
            event.preventDefault()
          }}
          className={cn('aria-disabled:opacity-50', className)}
        >
          <FolderPlus aria-hidden="true" />
          New project
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        Creating a project arrives with project settings.
      </TooltipContent>
    </Tooltip>
  )
}
