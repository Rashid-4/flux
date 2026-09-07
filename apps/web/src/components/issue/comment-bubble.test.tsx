import { aComment, id, instant, MINUTE, USER_ADA, USER_LINUS } from '@flux/mocks'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { CommentBubble } from './comment-bubble'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One bubble — and specifically, whether a listener learns what a viewer sees.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The bubble's whole design is that **side means author**: mine on the right in blue,
 * theirs on the left in grey, and the name printed once at the start of a run rather than
 * on every entry. That is the reference's own arrangement and it is the right one on
 * screen — and it carries the entire attribution in two things a screen reader cannot
 * perceive, alignment and fill.
 *
 * So the property under test is the compensation, and it is an exclusive-or rather than a
 * belt-and-braces: exactly one of the visible name and the announced one, never both.
 * Both is the failure `components/error-state.tsx` documents — a listener hears the name
 * twice and cannot tell whether that is one comment or two.
 *
 * The rest is §9. "Deactivated" is a word because the grey it is otherwise drawn in is
 * the only difference between a former colleague and a current one, and "edited" is a
 * word because a pencil glyph is a claim about provenance that a glyph cannot make.
 *
 * Wrapped in `<ol>` because the bubble is an `<li>`: a bare `<li>` is invalid markup and
 * axe reports it, which would make every test in this file fail for a reason that is the
 * test's fault rather than the component's.
 */

function inList(children: React.ReactNode) {
  return renderWithProviders(<ol>{children}</ol>)
}

/** Linus is the deactivated member of the cast — see `@flux/mocks`. */
const LINUS = { id: USER_LINUS, displayName: 'Linus Haddad', avatarUrl: null, isInactive: true }

describe('CommentBubble', () => {
  it('draws an incoming comment on the left, with the author named once', () => {
    const { container } = inList(<CommentBubble comment={aComment()} mine={false} startsRun />)

    const bubble = container.querySelector('[data-slot="comment-bubble"]')
    expect(bubble).not.toHaveAttribute('data-mine')
    expect(bubble?.className).toContain('items-start')
    expect(screen.getByText('Grace Mbeki')).toBeInTheDocument()
    /** Named visibly, so it must not also be announced. */
    expect(screen.queryByText(/wrote:/)).toBeNull()
  })

  it('draws my own comment on the right, and announces that it is mine', () => {
    const mine = aComment({
      author: { id: USER_ADA, displayName: 'Ada Okafor', avatarUrl: null, isInactive: false },
    })
    const { container } = inList(<CommentBubble comment={mine} mine startsRun />)

    const bubble = container.querySelector('[data-slot="comment-bubble"]')
    expect(bubble).toHaveAttribute('data-mine', 'true')
    expect(bubble?.className).toContain('items-end')
    /**
     * "You wrote:" and not "Ada Okafor wrote:". The bubble's colour says "you" to a
     * viewer, and the second person is what says it to a listener — a listener hearing
     * their own name in a thread they are reading has to work out that it means them.
     */
    expect(screen.getByText('You wrote:')).toBeInTheDocument()
    expect(screen.queryByText('Ada Okafor')).toBeNull()
  })

  /**
   * A continuation bubble drops the name from the screen and gains it in the announcement.
   *
   * This is the pair that makes the rule non-vacuous: the same comment renders one way at
   * the head of a run and the other way inside it, and neither way has the name twice.
   */
  it('announces the author when it stops printing one', () => {
    inList(<CommentBubble comment={aComment()} mine={false} startsRun={false} />)

    expect(screen.getByText('Grace Mbeki wrote:')).toBeInTheDocument()
    /**
     * The bare name is gone. `queryByText` compares an element's whole normalised text,
     * so this does not match the announcement above it — which is what makes it an
     * assertion about the visible attribution rather than a tautology.
     */
    expect(screen.queryByText('Grace Mbeki')).toBeNull()
  })

  it('says a departed colleague is departed, in words as well as in grey', () => {
    inList(<CommentBubble comment={aComment({ author: LINUS })} mine={false} startsRun />)

    expect(screen.getByText('Linus Haddad')).toBeInTheDocument()
    expect(screen.getByText('Deactivated')).toBeInTheDocument()
  })

  /** And in the announcement too, on a continuation bubble where the chip is not drawn. */
  it('carries the deactivation into the announcement when the name is not shown', () => {
    inList(<CommentBubble comment={aComment({ author: LINUS })} mine={false} startsRun={false} />)

    expect(screen.getByText('Linus Haddad (deactivated) wrote:')).toBeInTheDocument()
  })

  /**
   * `editedAt`, not `updatedAt` — a marker that appeared because someone ran a migration
   * would be a claim about a colleague's writing that nothing in the data supports.
   */
  it('marks an edited comment, and dates the edit in the title', () => {
    const editedAt = instant(-20 * MINUTE)
    inList(<CommentBubble comment={aComment({ editedAt })} mine={false} startsRun />)

    const marker = screen.getByText('· edited')
    expect(marker).toHaveAttribute('title', `Edited ${editedAt}`)
  })

  it('does not mark a comment nobody edited', () => {
    inList(<CommentBubble comment={aComment({ editedAt: null })} mine={false} startsRun />)
    expect(screen.queryByText('· edited')).toBeNull()
  })

  /**
   * An internal comment says so on either fill.
   *
   * The word, plus a lock: this is the one label in the thread whose absence has a
   * consequence outside the product — a comment meant for the team, read as though it were
   * visible to the customer.
   */
  it('labels an internal comment', () => {
    inList(<CommentBubble comment={aComment({ isInternal: true })} mine={false} startsRun />)
    expect(screen.getByText('Internal')).toBeInTheDocument()
  })

  /**
   * A reply quotes one line of what it is answering.
   *
   * The quote is what makes a flat thread readable without nesting, and it is built from
   * the *loaded* parent — so the interesting assertion is the one below it: a reply whose
   * parent is on an earlier page renders with no quote rather than with an empty one.
   */
  it('quotes the comment it is replying to', () => {
    const parent = aComment()
    const reply = aComment({ id: id<'CommentId'>('comment', 'log-101-2'), parentId: parent.id })
    const { container } = inList(
      <CommentBubble comment={reply} mine={false} startsRun parent={parent} />,
    )

    expect(container.querySelector('[data-slot="comment-reply-quote"]')).not.toBeNull()
  })

  it('renders no quote when the parent is not loaded', () => {
    const orphan = aComment({ parentId: id<'CommentId'>('comment', 'log-101-0') })
    const { container } = inList(<CommentBubble comment={orphan} mine={false} startsRun />)

    expect(container.querySelector('[data-slot="comment-reply-quote"]')).toBeNull()
  })

  it('is clean under axe on both sides at once', async () => {
    const { container } = inList(
      <>
        <CommentBubble
          comment={aComment({ author: LINUS, isInternal: true })}
          mine={false}
          startsRun
        />
        <CommentBubble comment={aComment({ editedAt: instant(-MINUTE) })} mine startsRun={false} />
      </>,
    )

    await expectNoAxeViolations(container)
  })
})
