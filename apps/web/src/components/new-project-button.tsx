import { Plus } from 'lucide-react'
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
  size?: 'sm' | 'md' | undefined
  /**
   * Which side the explanation opens on.
   *
   * A prop rather than a constant because the two call sites sit in opposite corners of
   * the screen. In the page header there is room below; pinned to the bottom of the
   * sidebar there is not, and `right` puts the tooltip over the content area where the
   * space actually is. Radix collision-detection would flip a bottom-side tooltip to
   * `top` there, which lands it on top of the project list it is explaining.
   */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left' | undefined
  className?: string | undefined
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
         * It is **not dimmed**, and it was. Both references draw this button at full
         * strength — a `--chrome-raised` pill with a `+` and the words in `--fg` at a
         * medium weight, 42px tall — and it is the one control at the foot of the
         * sidebar, so a 50% version of it was the most visible departure from the
         * mockup on the whole chrome. The same trade `board/board-toolbar.tsx` makes
         * for its unavailable layouts: the unavailability is carried by the three
         * signals that cost no pixels — `aria-disabled`, `cursor-not-allowed` at the
         * moment of reaching for it, and the tooltip that says why — rather than by
         * washing out a measured colour.
         *
         * `variant="ghost"` and the fill classes here rather than `secondary`: the
         * reference draws no border and no shadow, only the chrome's raised step, which
         * is the fill a selected sidebar row and the rail's brand disc share. `Button`
         * has no variant for "a filled pill on the chrome" and should not grow one for
         * a single call site; `cn` resolves the ghost hover fill in favour of
         * `--chrome-hover`, which is the quieter rung.
         */}
        <Button
          variant="ghost"
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
          className={cn(
            'rounded-card bg-chrome-raised text-md font-medium text-fg',
            'hover:bg-chrome-hover hover:text-fg aria-disabled:cursor-not-allowed',
            className,
          )}
        >
          {/**
           * A `+` and not a folder: the references write "+ New Project" and the plus
           * is what every create affordance on the board uses too (the column's
           * add-slot, "Add subtask"). `strokeWidth={2.25}` because the base rule in
           * `tokens.css` thins a default-weight icon to 1.5, which at 18px is a 1.1px
           * hairline the reference does not draw — its plus is as heavy as the text.
           */}
          <Plus aria-hidden="true" className="size-4.5" strokeWidth={2.25} />
          New project
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        Creating a project arrives with project settings.
      </TooltipContent>
    </Tooltip>
  )
}
