import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The 260px the project sidebar occupies — animated, and never unmounted.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §3: *"No layout shift when the sidebar animates: reserve
 * the width, animate the transform."* §12: *"Sidebar toggle: no layout thrash,
 * transform-animated."*
 *
 * What was here before was `{sidebarOpen && <ProjectSidebar … />}` in
 * `../../routes/shell.tsx`, which satisfies neither. 260px appeared and disappeared
 * between two frames with nothing in between, and the mount/unmount threw away
 * everything the tree was holding: the text in its filter field, the manual
 * expand/collapse `overrides` layered over the route's own, and its scroll position.
 * `[` is a shortcut, so that is not an occasional cost — it is the cost of the
 * gesture a power user makes most often with this panel.
 *
 * ### Why the width animates here rather than a transform on the panel
 *
 * Because the point of collapsing is to give the 260px to the content, and there is
 * no transform that does that: handing space back to `<main>` is a layout change by
 * definition. What "reserve the width" buys is the part that actually costs
 * something — the *panel's* width is reserved and constant. It is pinned at `w-tree`
 * and taken out of flow, so the expensive subtree, the whole project tree, is laid
 * out exactly once and never again. Two boxes resize per frame: this wrapper and
 * `<main>`. That is the difference between animating a container and animating a
 * list.
 *
 * ### `right-0` is what makes it a slide
 *
 * The panel's right edge is pinned to the clip's right edge, so as the clip narrows
 * the panel travels left and disappears behind the rail, and as it widens the panel
 * travels back out. The motion is a slide with no transform written anywhere — the
 * clip performs it. `left-0` instead would hold the panel still and wipe it into
 * view, which reads as unmasking rather than moving.
 *
 * ### `inert` when collapsed is not belt-and-braces
 *
 * `overflow: hidden` clips pixels. It does nothing to the tab order, so a 0px-wide
 * sidebar still holds a filter field, a row of project links and a create button —
 * a dozen invisible tab stops between the rail and the content, which is a worse
 * keyboard experience than the unmount this replaces. `inert` removes the subtree
 * from focus *and* from the accessibility tree, which is why there is no
 * `aria-hidden` beside it; two attributes making the same claim is one that can
 * later disagree. The rail's toggle carries `aria-expanded` for the state (see
 * `./icon-rail.tsx`), and deliberately no `aria-controls`: a reference into an inert
 * subtree points at a node that is not in the accessibility tree at all.
 *
 * Within the browser floor in `apps/web/README.md` — `inert` is Chrome 102, Safari
 * 15.5, Firefox 112, all older than the floor the stylesheet already sets.
 *
 * ### Reduced motion needs no code here
 *
 * `../../design/tokens.css` sets `transition-duration: 1ms !important` on every
 * element under `prefers-reduced-motion: reduce`, and an `!important` author
 * declaration outranks the normal one this class produces. §3 asks for *"instant,
 * not faster"* and 1ms is instant. A `motion-reduce:` variant here would be a
 * second place the same promise is made, which is the shape that drifts —
 * `./nav-drawer.tsx`'s `SPRING_BACK` records the same decision for the same reason.
 */
export interface SidebarSlotProps {
  /** `stores/chrome.ts`'s `sidebarOpen`. */
  open: boolean
  /**
   * The panel. It must be out of flow and `w-tree` — `absolute inset-y-0 right-0
   * w-tree` — so that narrowing this wrapper cannot reflow it. Both call sites
   * (`./project-sidebar.tsx`, `./shell-skeleton.tsx`) do that, which is also why the
   * skeleton goes through this component instead of drawing its own 260px column:
   * a placeholder that reserves width the loaded state does not is the layout jump
   * the skeleton exists to prevent.
   */
  children: ReactNode
}

export function SidebarSlot({ open, children }: SidebarSlotProps) {
  return (
    <div
      data-slot="sidebar-slot"
      /** For a test and for the devtools. The animation is driven by the width classes, not by this. */
      data-state={open ? 'expanded' : 'collapsed'}
      inert={!open}
      className={cn(
        /**
         * `hidden md:block`, which is the breakpoint that used to live on
         * `./project-sidebar.tsx`. Below 768px this panel is not on screen at all and
         * `./nav-drawer.tsx` is the navigation — so the rail's toggle carries the
         * complementary `hidden md:inline-flex` and the drawer's trigger `md:hidden`.
         *
         * `duration-190` is a literal rather than `duration-${DURATION.base}` because
         * Tailwind extracts class names by scanning source text: an interpolated one
         * matches nothing, generates no rule, and fails by emitting no CSS rather than
         * by erroring — the failure mode `design/palette.test.ts` exists for. The tie
         * to `DURATION.base` is asserted in `./sidebar-slot.test.tsx` instead.
         */
        'relative hidden shrink-0 overflow-hidden transition-[width] duration-190 ease-out md:block',
        open ? 'w-tree' : 'w-0',
      )}
    >
      {children}
    </div>
  )
}
