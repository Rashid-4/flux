import { scenario } from '@flux/mocks'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ROUTE_PATTERNS } from '@/lib/paths'
import { expectNoAxeViolations } from '@/test/axe'
import { fails } from '@/test/failures'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { IssueSurface } from './issue'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `/browse/:issueKey` — what the page must say, not how it is spaced.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The geometry is not assertable here and these tests do not pretend otherwise —
 * jsdom applies no stylesheet, so a computed grid template is the empty string. What
 * *is* assertable is the set of claims the page makes about an issue, and those are
 * exactly the things that go wrong silently:
 *
 *   - **A link rendered in the wrong direction.** "blocks" and "is blocked by" are the
 *     same row read two ways, and getting it backwards inverts the meaning of a
 *     dependency while looking perfectly plausible. `anIssueDetail()` carries one of
 *     each precisely so this can be caught.
 *   - **A refused transition that does not say why.** The whole reason the page renders
 *     transitions at all is `unavailableReason` — hiding the option is the Jira
 *     behaviour `docs/specs/api/workflows.md` was written against.
 *   - **A not-found state that leaks which kind of not-found it is.** §10 makes missing,
 *     deleted and invisible deliberately indistinguishable, and the copy is where that
 *     promise is either kept or broken.
 *   - **A field list that is not a field list.** A `<dl>` whose `<dt>`s and `<dd>`s are
 *     not paired reads as an undifferentiated run of text to a screen reader, and looks
 *     completely fine.
 *
 * Every test renders through `shellBootstrap`, because the surface reads `bootstrap`
 * out of the outlet context the way it does in the app. Mocking `useShellContext` would
 * be the shortcut and would stop the test proving the route is shell-nested at all.
 */

const BOARD_KEY = scenario().boardIssueKeys[0] ?? ''
const DETAIL = scenario().issuesByKey[BOARD_KEY]

if (DETAIL === undefined) throw new Error('scenario() produced no board issues')

function renderIssue(key: string) {
  return renderWithProviders(<IssueSurface />, {
    initialPath: `/browse/${key}`,
    routePattern: ROUTE_PATTERNS.issue,
    shellBootstrap: scenario().bootstrap,
  })
}

describe('IssueSurface', () => {
  /**
   * The key is on screen before the request resolves, and it is *text* rather than a
   * skeleton.
   *
   * The URL already contains it, so a grey bar in its place would be strictly less
   * information than the page had at mount. `findByRole` afterwards proves the swap to
   * the summary actually happens rather than the key being the permanent title.
   */
  it('shows the key immediately and the summary when it arrives', async () => {
    renderIssue(BOARD_KEY)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(BOARD_KEY)
    expect(
      await screen.findByRole('heading', { level: 1, name: DETAIL.summary }),
    ).toBeInTheDocument()
  })

  it('links its breadcrumb to the project board', async () => {
    renderIssue(BOARD_KEY)

    const crumb = await screen.findByRole('link', { name: DETAIL.projectName })
    expect(crumb).toHaveAttribute('href', `/projects/${DETAIL.projectKey}/board`)
  })

  /**
   * The details column is a real definition list, pair by pair.
   *
   * `<dt>Assignee</dt>` and the `<dd>` holding the name have to be siblings inside the
   * same `<div>` for the association to exist at all — a flat run of `<dt>`s followed by
   * a flat run of `<dd>`s renders identically and associates nothing.
   */
  it('pairs every field name with its value', async () => {
    renderIssue(BOARD_KEY)

    const assignee = await screen.findByText('Assignee')
    expect(assignee.tagName).toBe('DT')

    const pair = assignee.parentElement
    expect(pair).not.toBeNull()
    expect(
      within(pair as HTMLElement).getByText(DETAIL.assignee?.displayName ?? ''),
    ).toBeInTheDocument()

    /**
     * `showLabel` on the priority icon is what makes this row readable: without it the
     * `<dd>` is a chevron and the reader is asked to know a legend that is nowhere on
     * the page.
     */
    const priority = screen.getByText('Priority')
    expect(
      within(priority.parentElement as HTMLElement).getByText(
        /^(Blocker|Critical|High|Medium|Low|Trivial|No priority)$/,
      ),
    ).toBeInTheDocument()
  })

  /**
   * Both link directions, in words.
   *
   * The fixture carries an outward `blocks` and an inward one, so a renderer that read
   * `linkType` and ignored `direction` would print "blocks" twice and pass a test that
   * only looked for one of them.
   */
  it('says which way each link reads', async () => {
    renderIssue(BOARD_KEY)

    expect(await screen.findByText('blocks')).toBeInTheDocument()
    expect(screen.getByText('is blocked by')).toBeInTheDocument()

    const outward = DETAIL.links.find((link) => link.direction === 'outward')
    if (outward !== undefined) {
      expect(screen.getByRole('link', { name: outward.issue.summary })).toHaveAttribute(
        'href',
        `/browse/${outward.issue.key}`,
      )
    }
  })

  /**
   * A transition the workflow refuses shows the server's reason and its requirements.
   *
   * This is the assertion that pins the §5/§13 resolution: the row exists, it is
   * visible, and it explains itself — and it is not a button, because there is nothing
   * behind it to press yet.
   */
  it('explains a transition it cannot offer', async () => {
    const { container } = renderIssue(BOARD_KEY)

    const refused = DETAIL.availableTransitions.find((transition) => !transition.available)
    if (refused === undefined)
      throw new Error('the fixture no longer has an unavailable transition')

    /**
     * Scoped to this transition's own row. Two transitions in the fixture require a
     * comment, so a document-wide query for that sentence finds both — and asserting
     * "some row says it" would pass even if the requirement were attached to the wrong
     * transition, which is the bug worth catching.
     */
    await screen.findByText(refused.unavailableReason ?? '')
    const row = container.querySelector(`[data-transition="${refused.id}"]`)
    expect(row).not.toBeNull()
    const inRow = within(row as HTMLElement)

    expect(inRow.getByText(refused.unavailableReason ?? '')).toBeInTheDocument()
    if (refused.requiresComment) expect(inRow.getByText('Needs a comment.')).toBeInTheDocument()
    if (refused.requiresFieldKeys.length > 0) {
      expect(inRow.getByText(/^Needs: /)).toBeInTheDocument()
    }

    /** The target state is always named, whether or not the transition repeats its name. */
    expect(inRow.getByText(refused.toStateName)).toBeInTheDocument()

    // Information, not an affordance: nothing in the row is pressable.
    expect(inRow.queryByRole('button')).toBeNull()
  })

  /**
   * Attachments come from their own request, and the link goes to the presigned URL.
   *
   * `rel="noreferrer"` is asserted because its absence is invisible: the download works
   * either way, and what leaks is this application's URL — with the issue key in it — to
   * the storage host, in a header nobody looks at.
   */
  it('lists attachments with a download link that does not leak the referrer', async () => {
    renderIssue(BOARD_KEY)

    const files = scenario().attachmentsByIssueKey[BOARD_KEY] ?? []
    const first = files[0]
    if (first === undefined) throw new Error('the fixture no longer has attachments')

    const link = await screen.findByRole('link', { name: first.filename })
    expect(link).toHaveAttribute('href', first.downloadUrl)
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  /**
   * The unknown-key state, and specifically that it stays ambiguous.
   *
   * The key is echoed because a reader's first move is to check it against what they
   * pasted. What must never appear is a distinction between deleted, never-existed and
   * not-shared — so the copy is asserted to *contain* the hedge rather than merely to
   * be non-empty.
   */
  it('does not say whether a missing issue is missing or forbidden', async () => {
    renderIssue('LOG-9999')

    expect(
      await screen.findByText(/either does not exist or is not shared with you/),
    ).toBeInTheDocument()

    /**
     * The key appears twice, and both are wanted: once as the current breadcrumb, so the
     * reader keeps their bearings, and once inside the copy, because checking the key
     * against what they pasted is the first thing anyone does. The crumb is the one
     * asserted by role — `aria-current="page"` is what makes it the *current* location
     * rather than a third link to nowhere.
     */
    expect(screen.getByText('LOG-9999', { selector: '[aria-current="page"]' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View your projects/ })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  /**
   * Any other failure is the retryable error state, not the not-found copy.
   *
   * The distinction matters because they suggest opposite actions: one says the issue is
   * gone, the other says the request was. Telling a reader their issue does not exist
   * because a gateway hiccuped is the worse of the two errors.
   */
  it('offers a retry when the request fails for another reason', async () => {
    server.use(fails('GET', `/issues/${BOARD_KEY}`, 'internal_error'))
    renderIssue(BOARD_KEY)

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText(/either does not exist or is not shared with you/)).toBeNull()
  })

  it('has no axe violations once the issue has loaded', async () => {
    const { container } = renderIssue(BOARD_KEY)

    await screen.findByRole('heading', { level: 1, name: DETAIL.summary })
    await waitFor(() => {
      expect(screen.queryByText('Attachments')).toBeInTheDocument()
    })

    await expectNoAxeViolations(container)
  })
})
