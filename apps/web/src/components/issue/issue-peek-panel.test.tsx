import { scenario } from '@flux/mocks'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useShortcutListener } from '@/keyboard/use-shortcuts'
import { expectNoAxeViolations } from '@/test/axe'
import { fails } from '@/test/failures'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { IssuePeekPanel } from './issue-peek-panel'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The peek panel — the behaviours the render-diff cannot see.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The panel's geometry is measured off `UI Images/JIRA 2` and checked by
 * `scripts/reference-diff.mjs` in a real browser. None of it is assertable in jsdom, so
 * none of it is asserted here. What is here is the half a screenshot cannot check, and
 * every case is one where the panel would look perfect and behave wrongly:
 *
 *   - **Closing keeps the surface.** `?peek=` is the panel's whole state, so closing is
 *     a navigation that must drop exactly one parameter. A close that navigated to the
 *     pathname would silently clear the board's filters, and the screenshot after it is
 *     indistinguishable from the screenshot before.
 *   - **Focus goes in, and comes back out to the card.** The panel is not modal; it
 *     opens somewhere else in the document, so without the move a screen reader is told
 *     nothing at all, and without the restore a keyboard reader lands on `<body>`.
 *   - **Escape works from the card, not just from inside.** Clicking a card leaves focus
 *     on the card, which is why the binding lives in the registry rather than in an
 *     `onKeyDown` on the panel — and that distinction is invisible until someone presses
 *     the key without tabbing first.
 *   - **A failed issue request keeps the header.** A panel whose close button vanished
 *     with its content can only be dismissed with the browser's Back button.
 *
 * `useShortcutListener()` is mounted by a wrapper here because the shell mounts it in
 * the app (`shell/shell-keyboard.tsx`) — the panel registers a binding and deliberately
 * does not attach a listener of its own, so a test that skipped this would prove Escape
 * does nothing and be right for the wrong reason.
 */

const KEY = scenario().boardIssueKeys[0] ?? ''
const CURRENT_USER = scenario().bootstrap.user.id

/**
 * Thrown at module scope rather than asserted in each test: a fixture that lost its
 * board issues is a broken instrument, not a failing behaviour.
 *
 * Re-bound through a second `const` because the narrowing has to survive into the two
 * hoisted `function` declarations below, and TypeScript will not carry one there — as
 * far as it knows a hoisted function could be called before the check runs. The
 * alternative was `DETAIL?.projectKey` at every use, which would make a missing fixture
 * render `/projects/undefined/board` instead of failing.
 */
const found = scenario().issuesByKey[KEY]
if (found === undefined) throw new Error('scenario() produced no board issues')
const DETAIL = found

/** What the panel is looking at when it restores focus, and the location it left. */
function Board() {
  const location = useLocation()
  useShortcutListener()

  return (
    <>
      <span data-testid="url">{`${location.pathname}${location.search}`}</span>
      {/**
       * Rendered *after* the panel on purpose. In the running app `<main>` comes first,
       * so a `document.querySelector` for the key would find this card either way —
       * which is exactly why the order is inverted here. The panel's root carries the
       * same `data-issue-key`, and the close path has to skip its own node rather than
       * rely on a layout decision made in another file.
       */}
      <button type="button" data-issue-key={KEY}>
        {DETAIL.summary}
      </button>
    </>
  )
}

function renderPanel(search = '') {
  return renderWithProviders(
    <>
      <IssuePeekPanel issueKey={KEY} currentUserId={CURRENT_USER} />
      <Board />
    </>,
    { initialPath: `/projects/${DETAIL.projectKey}/board${search}` },
  )
}

describe('IssuePeekPanel', () => {
  it('names itself after the issue it is showing', async () => {
    renderPanel()

    const panel = screen.getByRole('complementary', { name: `${KEY} details` })
    expect(panel).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => {
      expect(panel).not.toHaveAttribute('aria-busy')
    })
  })

  /**
   * The identity block says what the issue is, in the four ways the reference's chat
   * header said who a person was.
   *
   * `h2` and not `h1`: the panel sits beside `<main>`, whose `h1` is the board's own
   * title. Two `h1`s in one document is a heading outline with no root.
   */
  it('shows the summary, the key, the status and the assignee', async () => {
    renderPanel()

    expect(
      await screen.findByRole('heading', { level: 2, name: DETAIL.summary }),
    ).toBeInTheDocument()
    expect(screen.getByText(DETAIL.key)).toBeInTheDocument()
    expect(screen.getByText(DETAIL.statusName)).toBeInTheDocument()
    expect(screen.getByText(DETAIL.assignee?.displayName ?? 'Unassigned')).toBeInTheDocument()
  })

  /**
   * "See full details" is the one route out of the panel, and its accessible name
   * carries the key.
   *
   * A reader listing this panel's links hears four words with no subject otherwise, and
   * the panel's own label was two hundred pixels of content ago.
   */
  it('links to the full page, and says which issue it is the full page of', async () => {
    renderPanel()

    const link = await screen.findByRole('link', { name: `See full details for ${KEY}` })
    expect(link).toHaveAttribute('href', `/browse/${KEY}`)
  })

  /**
   * Closing drops `?peek=` and nothing else.
   *
   * The board's filters live in the same query string, so a close that rebuilt the URL
   * from the pathname would clear them — and the reader would see their board go back to
   * showing everything with no explanation. `withoutPeek` is unit-tested in
   * `lib/paths.test.ts`; what this pins is that the panel actually uses it.
   */
  it('closes without discarding the rest of the query', async () => {
    renderPanel('?assignee=me&peek=LOG-101')

    fireEvent.click(screen.getByRole('link', { name: `Close ${KEY}` }))

    await waitFor(() => {
      expect(screen.getByTestId('url')).toHaveTextContent(
        `/projects/${DETAIL.projectKey}/board?assignee=me`,
      )
    })
  })

  /**
   * Focus moves into the panel on open — to the container, not to the close button.
   *
   * Focusing the first control would announce the exit before the content and would mean
   * a stray Enter dismisses what was just opened.
   */
  it('takes focus when it opens, and takes it to the region', async () => {
    renderPanel()

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('complementary'))
    })
  })

  /**
   * Escape closes it from wherever focus is, and hands focus back to the card.
   *
   * Both halves are the reason the binding is registered rather than handled locally:
   * the key is pressed while focus is still on the card that opened the panel, which a
   * panel-scoped listener would never see.
   */
  it('closes on Escape and puts focus back on the card', async () => {
    renderPanel('?peek=LOG-101')

    const card = screen.getByRole('button', { name: DETAIL.summary })
    card.focus()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTestId('url')).toHaveTextContent(`/projects/${DETAIL.projectKey}/board`)
    })
    expect(document.activeElement).toBe(card)
  })

  /**
   * The header survives a failed issue request, and the thread does not run under it.
   *
   * Two separate claims about the same failure. The close button has to stay, or the
   * panel is undismissable without the Back button. The thread has to go, because a 404
   * here means the issue may not exist and a comment list under an error is a list for
   * nothing — the composer is the visible half of that.
   */
  it('keeps its close button when the issue fails to load, and drops the thread', async () => {
    server.use(fails('GET', `/issues/${KEY}`, 'internal_error'))
    const { container } = renderPanel()

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Close ${KEY}` })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="comment-thread"]')).toBeNull()
    expect(container.querySelector('[data-slot="comment-composer"]')).toBeNull()
  })

  /**
   * The issue with nothing on it, which is the whole reason `aMinimalIssueDetail()`
   * exists: no description, nobody assigned, no comments.
   *
   * §11 — both empty states are designed rather than left as gaps. A missing description
   * reads as a load that failed, and a chip that renders an empty avatar beside an empty
   * name reads as a name that has not arrived; "Unassigned" is a fact.
   */
  it('says when there is no description and nobody assigned', async () => {
    const minimal = scenario().issuesByKey['LOG-200']
    if (minimal === undefined) throw new Error('scenario() no longer seeds LOG-200')
    expect(minimal.description).toBeNull()

    renderWithProviders(<IssuePeekPanel issueKey={minimal.key} currentUserId={CURRENT_USER} />)

    expect(await screen.findByText('No description yet')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('is clean under axe with the issue and its thread loaded', async () => {
    const { container } = renderPanel()

    await screen.findByRole('heading', { level: 2, name: DETAIL.summary })
    await waitFor(() => {
      expect(container.querySelector('[data-slot="comment-bubble"]')).not.toBeNull()
    })

    await expectNoAxeViolations(container)
  })
})
