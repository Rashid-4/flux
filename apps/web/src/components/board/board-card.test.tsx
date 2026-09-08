import { aBoardCard, id } from '@flux/mocks'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { BoardCard } from './board-card'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The card's blocks, and specifically the ones that change its height.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The card is measured geometry — 308 × 255 off `UI Images/JIRA 1` — and almost
 * none of that is assertable here. jsdom applies no stylesheet, so a computed
 * `line-height` is `normal` and a computed height is 0; `scripts/reference-diff.mjs`
 * against a real browser is what checks the pixels, and these tests must not
 * pretend to.
 *
 * What *is* checkable, and what the diff cannot see, is **which blocks render**.
 * Every one of the five fields the card gained is conditional, and each condition
 * changes the card's height: a description that renders when it should not adds
 * 74px, a subtask list that renders empty adds a divider to nothing, a `0` in the
 * footer adds a count to every card that has none. A column whose cards are each a
 * different height is the single most obvious way this surface stops looking like
 * the reference, and it is a conditional-rendering bug rather than a spacing one.
 *
 * So: presence, absence, and the two honesty rules — the capped subtask count and
 * the disabled affordances that say why.
 */
describe('BoardCard', () => {
  it('renders the summary, the key and a link that opens the peek panel', async () => {
    const card = aBoardCard()
    const { container } = renderWithProviders(<BoardCard card={card} />)

    /**
     * `?peek=` on the current route, **not** `/browse/:key`, and this test used to
     * assert the second one.
     *
     * The change is the product decision in `lib/paths.ts`: clicking a card opens the
     * issue in a panel beside the board, and the board must not go away — its scroll
     * position, its filters and the reader's place in it all survive because the route
     * does not change. `/browse/:key` is the full page, reached from the panel's "See
     * full details".
     *
     * Asserting the href rather than a click is deliberate. The behaviour that matters
     * is that this is a real link — middle-clickable, ⌘-clickable, copyable — and a
     * `fireEvent.click` would pass just as well against an `onClick` on a `<div>`,
     * which is the implementation this must not silently become.
     */
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', `/?peek=${card.key}`)
    expect(screen.getByText(card.summary)).toBeInTheDocument()
    expect(screen.getByText(card.key)).toBeInTheDocument()

    await expectNoAxeViolations(container)
  })

  /**
   * The panel composes with whatever the surface already has in its query string.
   *
   * A board carries its own filters there, and `withPeek` copies the existing params
   * rather than building `?peek=` from nothing — so opening a card cannot silently
   * clear the filter the reader was looking through. The naive
   * `` to={`?peek=${key}`} `` does exactly that, and the loss is invisible until
   * somebody notices their board went back to showing everything.
   */
  it('keeps the surface search params when it opens the panel', () => {
    const card = aBoardCard()
    renderWithProviders(<BoardCard card={card} />, {
      initialPath: '/projects/LOG/board?assignee=me',
    })

    const href = screen.getByRole('link').getAttribute('href') ?? ''
    expect(href).toContain('assignee=me')
    expect(href).toContain(`peek=${card.key}`)
  })

  /**
   * `data-issue-key` is what returns focus to this card when the panel closes.
   *
   * The panel's close path queries for it by attribute, so a rename here is a keyboard
   * user landing on `<body>` after pressing Escape — a silent regression in jsdom and
   * in a browser alike, which is why the attribute is pinned rather than assumed.
   */
  it('is findable by issue key, so the panel can return focus to it', () => {
    const card = aBoardCard()
    const { container } = renderWithProviders(<BoardCard card={card} />)

    expect(container.querySelector(`[data-issue-key="${card.key}"]`)).not.toBeNull()
  })

  /**
   * The card is `shrink-0`, and this is the one class on it whose absence is
   * invisible in jsdom and catastrophic in a browser.
   *
   * The column stacks cards in an `overflow-y-auto` flex container, where the
   * default `flex-shrink: 1` beats the overflow: without this the column
   * compresses each card instead of scrolling, and the card's own
   * `overflow-hidden` then clips the footer off. Measured on the real board — a
   * card needing 315px rendered at 250.6 with no avatar and no counts. jsdom
   * cannot see any of that, so the class is asserted directly.
   */
  it('refuses to be compressed by its column', () => {
    const { container } = renderWithProviders(<BoardCard card={aBoardCard()} />)
    expect(container.querySelector('[data-slot="board-card"]')?.className).toContain('shrink-0')
  })

  /**
   * ── Where flux's own fields live ──────────────────────────────────────
   *
   * These four assertions are about *position*, which normally belongs to the
   * render-diff rather than to jsdom. They are here because the thing they pin is
   * structural: the type, key, priority, estimate and blocked count have no
   * equivalent in the reference, and giving them a row of their own — which is
   * where they started — costs 36px on every card in the product and moves every
   * boundary below it. Putting them in the two bands the reference leaves empty
   * costs nothing, and "costs nothing" is a claim about which parent they are in.
   */
  describe('flux’s additions sit in the reference’s empty space', () => {
    it('puts the identifiers in the footer, beside the avatar', () => {
      const card = aBoardCard()
      const { container } = renderWithProviders(<BoardCard card={card} />)

      const footer = container.querySelector('[data-slot="user-avatar"]')?.parentElement
      expect(footer).not.toBeNull()
      expect(footer?.textContent).toContain(card.key)
      expect(footer?.querySelector('[data-slot="type-icon"]')).not.toBeNull()
      expect(footer?.querySelector('[data-slot="priority-icon"]')).not.toBeNull()
    })

    it('puts the estimate and the blocked count in the head row', () => {
      renderWithProviders(<BoardCard card={aBoardCard({ storyPoints: 5, blockedByCount: 2 })} />)

      const head = screen.getByRole('button', { name: /Actions for/ }).parentElement
      expect(head?.className).toContain('h-6')
      expect(head?.textContent).toContain('5')
      expect(head?.textContent).toContain('2 blocked')
    })

    /**
     * The body ends at the description or the checklist. A third block below
     * either one is the 36px regression this arrangement exists to avoid, and it
     * is the shape a future addition will naturally take, so it is asserted
     * rather than described.
     */
    it('leaves the card body with nothing below the description', () => {
      const card = aBoardCard({ subtasks: [], subtaskTotal: 0 })
      const { container } = renderWithProviders(<BoardCard card={card} />)

      const body = container.querySelector('.line-clamp-3')?.parentElement
      expect(body?.lastElementChild?.className).toContain('line-clamp-3')
    })
  })

  describe('the description excerpt', () => {
    it('renders clamped to three lines on the measured 23px leading', () => {
      const card = aBoardCard()
      renderWithProviders(<BoardCard card={card} />)

      /**
       * `card.descriptionExcerpt` is non-null in the default fixture; narrowed
       * rather than asserted non-null so a change to the default fails here with
       * a readable message instead of a `getByText(null)`.
       */
      const excerpt = card.descriptionExcerpt
      if (excerpt === null) throw new Error('aBoardCard() must default to an excerpt')

      const paragraph = screen.getByText(excerpt)
      /**
       * The classes, not the computed values: jsdom has no stylesheet, so
       * `leading-5.75` resolving to 23px is the render-diff's job. What this
       * catches is the clamp being dropped in a refactor, which is a 23px error
       * per extra line on every card in the column.
       */
      expect(paragraph.className).toContain('line-clamp-3')
      expect(paragraph.className).toContain('leading-5.75')
    })

    /**
     * `null` is "this issue has no description", and the card must reserve nothing
     * for it — seed 102 is the short card and it exists for this case.
     */
    it('renders nothing at all when the excerpt is null', () => {
      const card = aBoardCard({ descriptionExcerpt: null })
      const { container } = renderWithProviders(<BoardCard card={card} />)

      expect(container.querySelector('.line-clamp-3')).toBeNull()
    })

    /**
     * An empty string is not the same value as `null` and it reaches the card the
     * same way — a server that truncated to nothing, or a description of only
     * whitespace-stripped markup. Rendering it draws a 5px margin and an empty
     * paragraph, which is a 5px-taller card for no content.
     */
    it('renders nothing when the excerpt is an empty string', () => {
      const card = aBoardCard({ descriptionExcerpt: '' })
      const { container } = renderWithProviders(<BoardCard card={card} />)

      expect(container.querySelector('.line-clamp-3')).toBeNull()
    })
  })

  describe('the subtask checklist', () => {
    const withSubtasks = () =>
      aBoardCard({
        subtasks: [
          {
            id: id<'IssueId'>('issue', 1041),
            key: 'LOG-141',
            summary: 'Export current profiles',
            isDone: true,
          },
          {
            id: id<'IssueId'>('issue', 1042),
            key: 'LOG-142',
            summary: 'Reconcile against the vendor sheet',
            isDone: false,
          },
        ],
        subtaskTotal: 2,
      })

    it('gives a done subtask two signals, not one', () => {
      renderWithProviders(<BoardCard card={withSubtasks()} />)

      const done = screen.getByText('Export current profiles')
      const open = screen.getByText('Reconcile against the vendor sheet')

      /**
       * §9: colour is never the only carrier. The two signals are the *filled* disc
       * and the tick drawn inside it, against an empty ring for an open subtask —
       * both shape, neither hue. The fill is the neutral `--fg-subtle` and not a
       * success green, because the reference's done marker is a grey disc and the
       * card below its chip row is otherwise achromatic; a strike-through was a third
       * signal the reference does not draw, so the label's only change is its colour.
       */
      const doneMark = done.previousElementSibling
      const openMark = open.previousElementSibling
      expect(doneMark).toHaveAttribute('data-done', 'true')
      expect(doneMark?.className).toContain('bg-fg-subtle')
      expect(doneMark?.querySelector('svg')).not.toBeNull()

      expect(openMark).not.toHaveAttribute('data-done')
      expect(openMark?.className).toContain('border-border-control')
      expect(openMark?.className).not.toContain('bg-fg-subtle')
      expect(openMark?.querySelector('svg')).toBeNull()

      expect(done.className).not.toContain('line-through')
      expect(done.className).toContain('text-fg-subtle')
      expect(open.className).toContain('text-fg-muted')
    })

    /**
     * `subtaskTotal` can exceed what was sent — seed 104 is four of nine — and a
     * checklist showing four with no indication is the worst version of this row:
     * it looks complete.
     */
    it('says how many subtasks are not shown, and gets the plural right', () => {
      const capped = aBoardCard({ ...withSubtasks(), subtaskTotal: 9 })
      const { unmount } = renderWithProviders(<BoardCard card={capped} />)
      expect(screen.getByText('7 more subtasks')).toBeInTheDocument()
      unmount()

      const byOne = aBoardCard({ ...withSubtasks(), subtaskTotal: 3 })
      renderWithProviders(<BoardCard card={byOne} />)
      expect(screen.getByText('1 more subtask')).toBeInTheDocument()
    })

    it('says nothing when the list is complete', () => {
      renderWithProviders(<BoardCard card={withSubtasks()} />)
      expect(screen.queryByText(/more subtask/)).toBeNull()
    })

    /**
     * No subtasks means no block — not an empty block. The divider and the "Add
     * subtask" row live inside it, so rendering it for a card with no children
     * draws a rule under nothing and adds 43px.
     */
    it('renders no block, no divider and no add row when there are none', () => {
      renderWithProviders(<BoardCard card={aBoardCard({ subtasks: [], subtaskTotal: 0 })} />)
      expect(screen.queryByRole('button', { name: /Add a subtask/ })).toBeNull()
    })
  })

  describe('the footer counts', () => {
    it('labels each count with what it counts', () => {
      renderWithProviders(<BoardCard card={aBoardCard({ commentCount: 18, attachmentCount: 2 })} />)

      /**
       * The glyph is `aria-hidden`, so a bare "18" beside a bare "2" is what a
       * screen reader would otherwise read out. The label is the whole meaning.
       */
      expect(screen.getByLabelText('18 comments')).toHaveTextContent('18')
      expect(screen.getByLabelText('2 attachments')).toHaveTextContent('2')
    })

    /**
     * Zero renders nothing. A row of `0`s is noise on every card that has neither,
     * the reference has no card showing one, and seed 102 is the fixture for it.
     */
    it('renders neither count at zero', () => {
      const { container } = renderWithProviders(
        <BoardCard card={aBoardCard({ commentCount: 0, attachmentCount: 0 })} />,
      )

      expect(screen.queryByLabelText(/comments$/)).toBeNull()
      expect(screen.queryByLabelText(/attachments$/)).toBeNull()
      /** And no orphan glyph left behind by a count that stopped rendering. */
      expect(container.querySelector('[data-slot="board-card"] svg')).not.toBeNull()
    })
  })

  describe('the head row', () => {
    /**
     * The row is fixed at `h-6` and renders with no labels, which is the reason it
     * is worth a test: the kebab lives in it, the reference draws that on every
     * card, and a row that collapsed with the last label would give one column two
     * card heights as well as losing the card's only affordance.
     */
    it('keeps its height and its kebab on a card with no labels', () => {
      renderWithProviders(<BoardCard card={aBoardCard({ labels: [] })} />)

      const menu = screen.getByRole('button', { name: /Actions for LOG-101/ })
      expect(menu.parentElement?.className).toContain('h-6')
    })

    it('renders one chip per label', () => {
      const { container } = renderWithProviders(
        <BoardCard card={aBoardCard({ labels: ['warehouse', 'offline'] })} />,
      )

      expect(container.querySelectorAll('[data-slot="label-chip"]')).toHaveLength(2)
    })

    /**
     * §9 again: a breached SLA is a chip with a word in it, not a red border.
     */
    it('names a breached SLA rather than colouring something', () => {
      renderWithProviders(<BoardCard card={aBoardCard({ slaState: 'breached' })} />)
      expect(screen.getByText('Breached')).toBeInTheDocument()
    })
  })

  describe('the disabled affordances', () => {
    /**
     * §5's second rule — a control that cannot act is shown and says why — plus the
     * mechanical half: the whole card is a `<Link>`, so a button inside it that
     * does not cancel the click navigates instead of doing nothing, which is the
     * worst of the three possible behaviours.
     *
     * `fireEvent` returns `false` when the dispatched event was cancelled, so this
     * asserts the `preventDefault` rather than its symptom.
     */
    it('name what they will do, and do not navigate when clicked', () => {
      const card = aBoardCard({
        subtasks: [
          { id: id<'IssueId'>('issue', 1041), key: 'LOG-141', summary: 'Export', isDone: false },
        ],
        subtaskTotal: 1,
      })
      renderWithProviders(<BoardCard card={card} />)

      for (const name of [/Actions for LOG-101/, /Add a subtask to LOG-101/]) {
        const button = screen.getByRole('button', { name })
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).toHaveAttribute('title')
        expect(fireEvent.click(button)).toBe(false)
      }
    })
  })

  /**
   * The drag elevation is a class swap rather than a transform, so it is one of the
   * few visual facts this tier can check honestly.
   */
  it('lifts while dragging', () => {
    const { container } = renderWithProviders(<BoardCard card={aBoardCard()} dragging />)
    const cardEl = container.querySelector('[data-slot="board-card"]')

    expect(cardEl).toHaveAttribute('data-dragging', 'true')
    expect(cardEl?.className).toContain('shadow-drag')
    expect(cardEl?.className).not.toContain('shadow-card')
  })

  /**
   * The busiest card the contract allows, through axe in one pass: labels, a
   * breached badge, a clamped description, a mixed checklist that is also capped,
   * both counts, a blocked badge and points.
   */
  it('is clean under axe with every block rendered at once', async () => {
    const card = aBoardCard({
      labels: ['warehouse', 'offline'],
      slaState: 'breached',
      blockedByCount: 2,
      subtasks: [
        {
          id: id<'IssueId'>('issue', 1041),
          key: 'LOG-141',
          summary: 'Export current profiles',
          isDone: true,
        },
        { id: id<'IssueId'>('issue', 1042), key: 'LOG-142', summary: 'Reconcile', isDone: false },
      ],
      subtaskTotal: 9,
    })
    const { container } = renderWithProviders(<BoardCard card={card} />)

    expect(screen.getByText('2 blocked')).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })
})
