import type {
  Attachment,
  BacklogView,
  Bootstrap,
  BoardView,
  Comment,
  IssueDetail,
} from '@flux/contracts'
import { aBacklogView, aBoardView } from './board.js'
import { aDoneIssueDetail, aMinimalIssueDetail, anIssueDetail } from './issue.js'
import { aBootstrap } from './tenancy.js'
import { attachmentsFor, commentsFor } from './thread.js'

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
  /**
   * The thread for every issue in `issuesByKey`, oldest first, and **exactly as
   * long as that issue's `commentCount`**.
   *
   * That equality is the whole reason this is derived here rather than authored:
   * a card that says 18 and a panel that shows 5 is a world no real API could
   * produce, and every off-by-one in a "load more" boundary hides behind it.
   */
  commentsByIssueKey: Readonly<Record<string, readonly Comment[]>>
  /** Likewise, `attachmentCount` files per issue. */
  attachmentsByIssueKey: Readonly<Record<string, readonly Attachment[]>>
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
        /**
         * The two counters, carried across for the same reason as the summary.
         * They were not, and the peek panel is what made it matter: a card said
         * `commentCount: 18`, the detail record kept the builder's default of 7,
         * and the panel opening from the card showed a different number from the
         * card it opened out of. Both are "the number of comments on LOG-101".
         *
         * `subtaskSummary` is deliberately NOT derived. `card.subtasks` is capped
         * by the server, so `done` cannot be counted from it — a hidden child that
         * is done would make the derived total quietly wrong, which is worse than
         * a fixture that says so here.
         */
        commentCount: card.commentCount,
        attachmentCount: card.attachmentCount,
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

  const commentsByIssueKey: Record<string, readonly Comment[]> = {}
  const attachmentsByIssueKey: Record<string, readonly Attachment[]> = {}
  for (const issue of Object.values(issuesByKey)) {
    commentsByIssueKey[issue.key] = commentsFor(issue.key, issue.commentCount)
    attachmentsByIssueKey[issue.key] = attachmentsFor(issue.key, issue.attachmentCount)
  }

  return {
    bootstrap,
    boardView,
    backlogView,
    issuesByKey,
    commentsByIssueKey,
    attachmentsByIssueKey,
    boardIssueKeys,
  }
}

export function scenario(): Scenario {
  cached ??= build()
  return cached
}
