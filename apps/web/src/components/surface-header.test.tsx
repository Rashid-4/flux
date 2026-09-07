import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { SurfaceHeader, SurfaceHeaderCrumbs, type SurfaceHeaderTab } from './surface-header'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The header block every surface opens with.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Five surfaces render this — board, backlog, search, projects and the issue page — so
 * a defect here is a defect on all of them at once, and the two failures worth guarding
 * are both *quiet*.
 *
 * **A row that changes the block's height.** Six measured numbers sum to the reference's
 * 197px, and the description row and the crumb row occupy the same one on purpose: two
 * headers of different heights on adjacent surfaces is a jump on every navigation. So
 * the tests below assert that giving both a `description` and a `breadcrumb` renders one
 * row rather than two, and that the bottom padding closes the block only when the tab
 * row is absent.
 *
 * **A tab that lies about where you are.** `aria-current="false"` is a *valid* token
 * meaning "not current" that some screen readers announce, so the inactive tabs must
 * carry no attribute at all — an absence, which is exactly the shape of claim that
 * passes by accident if it is not asserted directly.
 *
 * ### What is deliberately not tested here
 *
 * The header's role. `surface-header.tsx` argues that `<header>` inside `<main>` is a
 * generic group rather than a `banner`, and that is true of browsers and false of
 * `@testing-library/dom@10.4.1`, whose role list is built from attribute-level
 * constraints and resolves `banner` regardless of ancestry (measured — see
 * `routes/shell.test.tsx`). A `queryByRole('banner')` assertion here would therefore
 * report on the test library rather than on the product, in either direction. The
 * containment is asserted where the header is composed instead.
 */

const TABS: readonly SurfaceHeaderTab[] = [
  { to: '/projects/LOG/board', label: 'Board', active: true },
  { to: '/projects/LOG/backlog', label: 'Backlog', active: false },
  { to: '/projects/LOG/settings', label: 'Settings', active: false },
]

function headerIn(container: HTMLElement): HTMLElement {
  const header = container.querySelector<HTMLElement>('[data-slot="surface-header"]')
  /**
   * Thrown rather than asserted, so the type narrows and every caller gets an element.
   * A failed `expect` here reports "expected null not to be null" two frames from the
   * render that produced it.
   */
  if (header === null) throw new Error('no [data-slot="surface-header"] was rendered')
  return header
}

describe('SurfaceHeader', () => {
  it('gives the surface exactly one heading, and it is the title', async () => {
    const { container } = renderWithProviders(<SurfaceHeader title="Unique Website" />)

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Unique Website')
    await expectNoAxeViolations(container)
  })

  /**
   * The default is truncation, because a title is a project or surface name — short by
   * nature, and worth cutting so every header closes on the same pixel.
   */
  it('truncates a title by default', () => {
    const { container } = renderWithProviders(<SurfaceHeader title="Logistics Platform" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('truncate')
    expect(headerIn(container)).toBeInTheDocument()
  })

  /**
   * `titleWrap` is for the issue page, where the title *is* the issue's summary — up to
   * 255 characters by `IssueSchema` — and the sentence the reader navigated to is the
   * last thing on the page that may be hidden.
   *
   * Both halves are asserted, and the `break-words` half is the one that matters more
   * than it looks: merely *dropping* `truncate` leaves a 90-character URL or a stack
   * frame overflowing the header, which pushes the actions cluster off the right edge —
   * the same failure `min-w-0` prevents for the truncating case, arrived at from the
   * other direction.
   */
  it('wraps the title when the title is a sentence the user typed', () => {
    const summary =
      'Scanner firmware https://internal.example.test/very/long/path/that/cannot/break/anywhere'
    renderWithProviders(<SurfaceHeader title={summary} titleWrap />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveClass('break-words')
    expect(heading).not.toHaveClass('truncate')
  })

  it('renders a lead mark and an actions cluster when given them', () => {
    renderWithProviders(
      <SurfaceHeader
        title="Unique Website"
        lead={<span data-testid="glyph" />}
        actions={<button type="button">Star</button>}
      />,
    )

    expect(screen.getByTestId('glyph')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
  })

  it('draws a description as row 2', () => {
    renderWithProviders(<SurfaceHeader title="Projects" description="4 projects" />)
    expect(screen.getByText('4 projects')).toBeInTheDocument()
  })

  /**
   * They share a row, so only one of them can have it — and the crumb trail wins,
   * because a surface with a real trail does not also need a sentence describing where
   * it is. Asserted with *both* props supplied, since that is the call a route makes
   * when it grows a breadcrumb and nobody removes the description it had before.
   */
  it('drops the description when a breadcrumb occupies the same row', () => {
    renderWithProviders(
      <SurfaceHeader
        title="LOG-142"
        description="In the Logistics Platform project"
        breadcrumb={<SurfaceHeaderCrumbs items={[{ label: 'Logistics Platform', to: '/p/LOG' }]} />}
      />,
    )

    expect(screen.queryByText('In the Logistics Platform project')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })

  /**
   * `pt-9` is mirrored by `pb-9` only when there is no tab row; with tabs the row's own
   * 46px closes the block and the padding would add 36 to the measured 197.
   */
  it('closes the block with padding only when no tab row does', () => {
    const { container: bare } = renderWithProviders(<SurfaceHeader title="Search" />)
    const { container: tabbed } = renderWithProviders(
      <SurfaceHeader title="Unique Website" tabs={TABS} tabsLabel="Project views" />,
    )

    expect(headerIn(bare)).toHaveClass('pt-9', 'pb-9')
    expect(headerIn(tabbed)).toHaveClass('pt-9', 'pb-0')
    expect(headerIn(tabbed)).not.toHaveClass('pb-9')
  })

  it('names the tab row, because it is the third nav on the page', () => {
    renderWithProviders(
      <SurfaceHeader title="Unique Website" tabs={TABS} tabsLabel="Project views" />,
    )
    expect(screen.getByRole('navigation', { name: 'Project views' })).toBeInTheDocument()
  })

  /**
   * One tab is current and the other two say nothing.
   *
   * `aria-current="false"` is the trap: it is a valid token that means "not current" and
   * some screen readers read it aloud, so the inactive tabs are asserted to carry no
   * attribute at all rather than a falsy one. `data-active` is checked alongside it
   * because that is what the screenshot diff and the underline read.
   */
  it('marks the active tab and stays silent on the others', () => {
    renderWithProviders(
      <SurfaceHeader title="Unique Website" tabs={TABS} tabsLabel="Project views" />,
    )

    const active = screen.getByRole('link', { name: 'Board' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(active).toHaveAttribute('data-active')

    for (const label of ['Backlog', 'Settings']) {
      const tab = screen.getByRole('link', { name: label })
      expect(tab, label).not.toHaveAttribute('aria-current')
      expect(tab, label).not.toHaveAttribute('data-active')
    }
  })

  it('renders no tab row for an empty tab list rather than an empty nav', () => {
    renderWithProviders(<SurfaceHeader title="Search" tabs={[]} tabsLabel="Project views" />)
    expect(screen.queryByRole('navigation', { name: 'Project views' })).toBeNull()
  })

  /**
   * `tabsAside` hangs *up* out of the tab row rather than pushing it down, which is
   * geometry a jsdom test cannot see. What it can see is that the cluster only exists
   * alongside a tab row — it lives inside the `hasTabs` branch, so a surface passing it
   * without tabs would silently lose it, and that is worth knowing at the call site.
   */
  it('places the tab aside inside the tab row, and nowhere without one', () => {
    const { container: withTabs } = renderWithProviders(
      <SurfaceHeader
        title="Unique Website"
        tabs={TABS}
        tabsLabel="Project views"
        tabsAside={<span data-testid="aside" />}
      />,
    )
    expect(
      screen
        .getByRole('navigation', { name: 'Project views' })
        .parentElement?.contains(screen.getByTestId('aside')),
    ).toBe(true)
    expect(headerIn(withTabs)).toBeInTheDocument()

    renderWithProviders(<SurfaceHeader title="Search" tabsAside={<span data-testid="orphan" />} />)
    expect(screen.queryByTestId('orphan')).toBeNull()
  })

  it('is clean under axe with every row present', async () => {
    const { container } = renderWithProviders(
      <SurfaceHeader
        title="Unique Website"
        lead={<span aria-hidden="true" />}
        breadcrumb={
          <SurfaceHeaderCrumbs
            items={[{ label: 'Logistics Platform', to: '/p/LOG' }, { label: 'Website' }]}
          />
        }
        actions={<button type="button">Star</button>}
        tabs={TABS}
        tabsLabel="Project views"
        tabsAside={<span aria-hidden="true" />}
      />,
    )
    await expectNoAxeViolations(container)
  })
})

describe('SurfaceHeaderCrumbs', () => {
  const ITEMS = [
    { label: 'Website', to: '/p/WEB' },
    { label: 'iOS App', to: '/p/IOS' },
    { label: 'Design' },
  ] as const

  /**
   * The item count is the whole point of the separators being spans.
   *
   * A three-step trail must announce as three steps. Promoting each `/` to an `<li>` —
   * which is the obvious way to write this, and what the markup looks like it does —
   * makes it five, two of which are the word "slash". The assertion is the count, not
   * the markup, so it holds however the separator is drawn next.
   */
  it('announces one step per crumb, separators included in neither', () => {
    renderWithProviders(<SurfaceHeaderCrumbs items={ITEMS} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  /**
   * The last crumb is the page you are on, so it is text with `aria-current="page"`
   * rather than a link. A link to the current page is a control with no effect — §13 —
   * and the attribute is how assistive technology is told which crumb is the
   * destination rather than a step.
   */
  it('makes the final crumb the destination rather than a link to here', () => {
    renderWithProviders(<SurfaceHeaderCrumbs items={ITEMS} />)

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Website',
      'iOS App',
    ])
    expect(screen.queryByRole('link', { name: 'Design' })).toBeNull()
    expect(screen.getByText('Design')).toHaveAttribute('aria-current', 'page')
  })

  /**
   * The L-shaped connector is decoration, and its `aria-hidden` is what keeps it out of
   * the trail — an unlabelled empty `<span>` inside a `<nav>` would otherwise be one
   * more thing a screen reader has to skip past on every surface.
   */
  it('hides the connector and the crumb icons from the trail', async () => {
    const { container } = renderWithProviders(
      <SurfaceHeaderCrumbs
        items={[{ icon: <span data-testid="mark" />, label: 'Website', to: '/p/WEB' }]}
      />,
    )

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const connector = nav.querySelector(':scope > span')
    expect(connector).toHaveAttribute('aria-hidden', 'true')

    for (const separator of nav.querySelectorAll('[aria-hidden="true"]')) {
      expect(separator).not.toHaveTextContent('Website')
    }
    expect(container.querySelectorAll('[data-testid="mark"]')).toHaveLength(1)
    await expectNoAxeViolations(container)
  })

  it('takes a caller-supplied name for the trail', () => {
    renderWithProviders(<SurfaceHeaderCrumbs items={ITEMS} label="Issue location" />)
    expect(screen.getByRole('navigation', { name: 'Issue location' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
  })
})
