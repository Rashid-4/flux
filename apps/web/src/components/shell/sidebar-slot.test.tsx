import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarSlot } from '@/components/shell/sidebar-slot'
import { DURATION } from '@/design/motion'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §3: *"No layout shift when the sidebar animates: reserve
 * the width, animate the transform."* §12: *"Sidebar toggle: no layout thrash,
 * transform-animated."*
 *
 * What this file can and cannot check is worth stating before the tests, because the
 * gap is not small. **jsdom computes no layout and implements none of `inert`'s
 * semantics** — every `offsetWidth` is 0, no transition ever runs, and a focusable
 * element inside an `inert` subtree is still focusable there. So none of the
 * assertions below observe the behaviour a user gets; they observe that the right
 * instruction is given to the browser, which is a weaker claim honestly labelled.
 *
 * That is still the assertion worth having. Every one of the four defects this fix is
 * part of was a *seam* — a correct instruction that was never issued — and the
 * regression this guards against is exactly that shape: someone reads
 * `{sidebarOpen && …}` as the obvious way to write a toggle and puts the
 * mount/unmount back. A test that the panel survives a collapse fails on that change
 * immediately. Whether the collapse *animates* in Chrome, and whether an inert
 * subtree really leaves the tab order, are `e2e/` items, and `e2e/` does not exist —
 * which is the third place in this tree that now matters.
 */

/** A focusable child, because the tab-order half is the reason `inert` is there at all. */
function renderSlot(open: boolean) {
  const rendered = renderWithProviders(
    <SidebarSlot open={open}>
      <div className="absolute inset-y-0 right-0 flex w-tree flex-col" data-testid="panel">
        <button type="button">Filter projects</button>
      </div>
    </SidebarSlot>,
  )
  const slot = rendered.container.querySelector('[data-slot="sidebar-slot"]')
  expect(slot).not.toBeNull()
  return { ...rendered, slot: slot as HTMLElement }
}

describe('SidebarSlot', () => {
  /**
   * The defect this component exists for. `routes/shell.tsx` used to render
   * `{sidebarOpen && <ProjectSidebar … />}`, and an unmount throws away everything
   * `project-tree.tsx` holds in `useState`: the text in its filter field, the manual
   * expand/collapse `overrides` layered over the route's own, and the scroll position
   * of a list that can be hundreds of rows long. `[` is a shortcut, so that is the
   * cost of the gesture this panel gets most often.
   */
  it('keeps its panel mounted when collapsed, so nothing inside is lost', () => {
    const { slot, rerender } = renderSlot(true)

    expect(screen.getByTestId('panel')).toBeInTheDocument()
    expect(slot).toHaveAttribute('data-state', 'expanded')

    rerender(
      <SidebarSlot open={false}>
        <div className="absolute inset-y-0 right-0 flex w-tree flex-col" data-testid="panel">
          <button type="button">Filter projects</button>
        </div>
      </SidebarSlot>,
    )

    expect(slot).toHaveAttribute('data-state', 'collapsed')
    /** Still there. This is the whole assertion, and it is the one a rewrite back to a conditional fails. */
    expect(screen.getByTestId('panel')).toBeInTheDocument()
  })

  /**
   * "Reserve the width" means two different widths, and the second is the one that
   * makes the animation cheap: the *wrapper* is what changes, and the panel inside is
   * `w-tree` in both states, out of flow, so the project tree is laid out once and
   * never re-laid-out. If the panel's width ever became a function of `open`, every
   * frame of the transition would reflow every row in it.
   */
  it('changes its own width and never the panel’s', () => {
    const open = renderSlot(true)
    expect(open.slot).toHaveClass('w-tree')
    expect(open.slot).not.toHaveClass('w-0')
    expect(screen.getByTestId('panel')).toHaveClass('w-tree', 'absolute')
    open.unmount()

    const collapsed = renderSlot(false)
    expect(collapsed.slot).toHaveClass('w-0')
    expect(collapsed.slot).not.toHaveClass('w-tree')
    /** Unchanged, which is the point. */
    expect(screen.getByTestId('panel')).toHaveClass('w-tree', 'absolute')
  })

  /**
   * §12's *"no layout thrash"* is a claim about what is animated, so the class is what
   * there is to assert. `overflow-hidden` is load-bearing rather than tidiness: it is
   * what performs the slide, since the panel is pinned to the clip's right edge and
   * travels with it.
   */
  it('animates the width it reserves, and clips what leaves', () => {
    const { slot } = renderSlot(true)

    expect(slot).toHaveClass('transition-[width]', 'overflow-hidden', 'relative')
    /**
     * The tie back to `design/motion.ts`, which owns every duration in the product.
     * The class has to be a literal — Tailwind extracts class names by scanning source
     * text, so `duration-${DURATION.base}` would generate no rule and fail by emitting
     * no CSS — and this is what stops the literal drifting from the constant it copies.
     */
    expect(slot).toHaveClass(`duration-${DURATION.base.toString()}`)
    expect(slot).toHaveClass('ease-out')
    /**
     * And deliberately *no* `motion-reduce:` variant. `design/tokens.css` sets
     * `transition-duration: 1ms !important` on every element under
     * `prefers-reduced-motion: reduce`, and an `!important` author declaration outranks
     * the normal one this class produces — so the promise is kept in one place. A
     * second place making the same promise is a second place it can stop being true.
     */
    expect(slot.className).not.toContain('motion-reduce')
  })

  /**
   * The half that would otherwise make keeping the panel mounted *worse* than the
   * unmount it replaces. `overflow: hidden` clips pixels and does nothing to the tab
   * order, so a 0px sidebar full of links would be a dozen invisible tab stops between
   * the rail and the content — a keyboard user pressing Tab into nothing, repeatedly,
   * with no way to see why.
   *
   * jsdom implements none of that, so this asserts the attribute rather than its
   * effect. The attribute is the whole mechanism, and its absence is the bug.
   */
  it('is inert while collapsed and not while open', () => {
    const collapsed = renderSlot(false)
    expect(collapsed.slot).toHaveAttribute('inert')
    collapsed.unmount()

    const open = renderSlot(true)
    /** Absent, not `inert="false"` — a present `inert` attribute is inert whatever its value. */
    expect(open.slot).not.toHaveAttribute('inert')
  })

  /**
   * `inert` removes the subtree from the accessibility tree as well as from focus,
   * which is why there is no `aria-hidden` beside it. Two attributes making the same
   * claim is one that can later disagree, and axe is the check that the single one is
   * enough.
   */
  it('has no accessibility violations in either state', async () => {
    const open = renderSlot(true)
    await expectNoAxeViolations(open.container)
    open.unmount()

    const collapsed = renderSlot(false)
    await expectNoAxeViolations(collapsed.container)
  })
})
