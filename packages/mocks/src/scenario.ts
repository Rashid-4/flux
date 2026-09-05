import type { BacklogView, Bootstrap, BoardView, IssueDetail } from '@flux/contracts'
import { aBacklogView, aBoardView } from './board.js'
import { aDoneIssueDetail, aMinimalIssueDetail, anIssueDetail } from './issue.js'
import { aBootstrap } from './tenancy.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The scenario: one coherent world, built once.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The builders produce individual shapes. This produces a *consistent set* of
 * them — the same organization, the same board, the same issue keys across
 * bootstrap, board, backlog and detail.
 *
 * Consistency is the property that matters and the one independent fixtures
 * cannot give you. If `aBoardView()` shows LOG-101 and `anIssueDetail()`
 * returns LOG-404, then clicking a card in a mock-driven app navigates to an
 * issue that does not exist on the board it came from — and every routing,
 * cache-key and back-navigation bug hides behind that mismatch, because the
 * app is never in a state a real app could be in.
 *
 * This is what MSW handlers in `apps/web/src/test/` should be built from:
 * resolve `GET /issues/LOG-101` out of `scenario.issuesByKey`, not out of a
 * fresh `anIssueDetail()`.
 *
 * Built lazily and cached, so importing the package costs nothing until a
 * test asks for the world, and every caller in a run shares one instance.
 */
export interface Scenario {
  bootstrap: Bootstrap
  boardView: BoardView
  backlogView: BacklogView
  /** Keyed by issue key, which is what the URL carries. */
  issuesByKey: Readonly<Record<string, IssueDetail>>
  /** Every key on the board, in column-then-rank order. */
  boardIssueKeys: readonly string[]
}

let cached: Scenario | undefined

function build(): Scenario {
  const bootstrap = aBootstrap()
  const boardView = aBoardView()
  const backlogView = aBacklogView()

  const boardIssueKeys = boardView.columns.flatMap((c) => c.cards.map((card) => card.key))

  /**
   * A detail record for every card on the board, derived FROM the card so the
   * summary, points, assignee and status agree in both places. Deriving rather
   * than authoring twice is the only way that stays true when a card changes:
   * two hand-written copies of the same issue drift on the first edit, and the
   * symptom is a detail view that contradicts the card the user just clicked.
   */
  const issuesByKey: Record<string, IssueDetail> = {}
  for (const column of boardView.columns) {
    for (const card of column.cards) {
      issuesByKey[card.key] = anIssueDetail({
        id: card.id,
        key: card.key,
        number: Number(card.key.slice(card.key.indexOf('-') + 1)),
        summary: card.summary,
        issueTypeKey: card.issueTypeKey,
        statusId: card.statusId,
        statusCategory: card.statusCategory,
        priority: card.priority,
        storyPoints: card.storyPoints,
        assigneeId: card.assignee?.id ?? null,
        assignee: card.assignee,
        labels: card.labels,
        blockedByCount: card.blockedByCount,
        rank: card.rank,
        version: card.version,
      } as Parameters<typeof anIssueDetail>[0])
    }
  }

  // Two issues that are NOT on the board, so a test can navigate to something
  // outside the current view — which is what a search result or a link does.
  const minimal = aMinimalIssueDetail()
  const done = aDoneIssueDetail()
  issuesByKey[minimal.key] = minimal
  issuesByKey[done.key] = done

  return { bootstrap, boardView, backlogView, issuesByKey, boardIssueKeys }
}

export function scenario(): Scenario {
  cached ??= build()
  return cached
}
