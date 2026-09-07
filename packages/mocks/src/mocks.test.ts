import { describe, expect, it } from 'vitest'
import {
  AttachmentSchema,
  BacklogViewSchema,
  BoardViewSchema,
  BootstrapSchema,
  CommentSchema,
  IssueDetailSchema,
  WorklogSchema,
  rank,
  type RichTextDoc,
  type RichTextNode,
} from '@flux/contracts'
import * as mocks from './index.js'
import { uuidFrom } from './determinism.js'

/**
 * The plain text of a rich-text document, for the assertions that are about a
 * comment's *length* rather than its structure — a one-word bubble and a wrapping
 * one are the two the layout cares about, and `JSON.stringify` on the doc would
 * measure the node names instead.
 */
function textOf(doc: RichTextDoc): string {
  const walk = (nodes: readonly RichTextNode[]): string =>
    nodes.map((node) => (node.text ?? '') + walk(node.content ?? [])).join('')
  return walk(doc.content)
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * What these tests are for.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The package's promise to the UI agent is narrow and total: **anything this
 * builds is a shape the real API could return.** Every builder already
 * `.parse()`es its output, so simply calling one is a test — which is why the
 * first block below is a loop over every exported builder rather than an
 * assertion per shape.
 *
 * The rest cover what parsing cannot see:
 *   • determinism, because a fixture that changes between runs makes every
 *     failure ambiguous;
 *   • id uniqueness, because the hash could collide and a collision would
 *     silently make two entities the same one;
 *   • internal consistency, because a board showing one issue and a detail
 *     view returning another puts the app in a state a real app cannot reach.
 */

describe('every builder produces something the contract accepts', () => {
  /**
   * Enumerated from the module's own exports rather than listed by hand. A
   * hand-written list is the thing that goes stale: a builder added next
   * month would be untested and nothing would say so.
   */
  const builders = Object.entries(mocks).filter(
    ([name, value]) => typeof value === 'function' && /^(a|an)[A-Z]/.test(name),
  ) as Array<[string, () => unknown]>

  it('finds the builders by convention, so a new one cannot be missed', () => {
    // If this number drops, a builder lost its `a`/`an` prefix and quietly
    // left the suite. If it rises without a deliberate addition, something
    // that is not a builder is being called below.
    expect(builders.length).toBeGreaterThanOrEqual(31)
  })

  for (const [name, fn] of builders) {
    it(`${name}() parses`, () => {
      expect(() => fn()).not.toThrow()
    })
  }
})

describe('determinism', () => {
  it('produces byte-identical output across calls', () => {
    expect(JSON.stringify(mocks.aBoardView())).toBe(JSON.stringify(mocks.aBoardView()))
    expect(JSON.stringify(mocks.anIssueDetail())).toBe(JSON.stringify(mocks.anIssueDetail()))
    expect(JSON.stringify(mocks.aBootstrap())).toBe(JSON.stringify(mocks.aBootstrap()))
  })

  it('does not share mutable state between calls', () => {
    // The defaults are a function, not an object, for exactly this reason.
    const first = mocks.aBoardView()
    first.columns.length = 0
    expect(mocks.aBoardView().columns).toHaveLength(4)
  })

  it('derives ids that are valid uuids', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      const u = uuidFrom(`probe:${i}`)
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      seen.add(u)
    }
    // A collision here would make two fixture entities indistinguishable —
    // the kind of bug that looks like a caching problem for a day.
    expect(seen.size).toBe(5000)
  })

  it('namespaces ids by kind, so "the first user" and "the first issue" differ', () => {
    expect(mocks.id('user', 1)).not.toBe(mocks.id('issue', 1))
  })

  it('has no wall-clock or random dependency', () => {
    // Cheap structural check on the source of truth for this claim. The two
    // APIs that would break resume-safety and snapshot stability are the two
    // named in determinism.ts, so assert the constant is fixed rather than
    // trying to detect the calls.
    expect(mocks.NOW).toBe('2026-03-02T09:00:00.000Z')
    expect(mocks.instant(0)).toBe(mocks.NOW)
    expect(mocks.instant(mocks.DAY)).toBe('2026-03-03T09:00:00.000Z')
    expect(mocks.localDate(0)).toBe('2026-03-02')
  })
})

describe('overrides', () => {
  it('merge deeply rather than replacing the branch', () => {
    const view = mocks.aBoardView({ permissions: { canRankIssues: false } })
    expect(view.permissions.canRankIssues).toBe(false)
    // Untouched siblings survive. A shallow merge would have dropped these,
    // and `.parse()` would then have failed — which is the point of parsing.
    expect(view.permissions.canManageBoard).toBe(true)
    expect(view.permissions.canTransitionIssues).toBe(true)
  })

  it('replace arrays whole instead of merging by index', () => {
    const view = mocks.aBoardView({ columns: [] })
    expect(view.columns).toHaveLength(0)
  })

  it('still validate, so an override cannot produce an impossible fixture', () => {
    expect(() =>
      // @ts-expect-error — a deliberately wrong type, which is half the guarantee:
      // the compiler rejects it, and if it were cast away, zod would too.
      mocks.anIssueDetail({ storyPoints: 'three' }),
    ).toThrow(/does not satisfy its contract schema/)
  })

  it('name the failing path in the error, not just "invalid"', () => {
    try {
      // @ts-expect-error — see above.
      mocks.aBoardView({ board: { name: 42 } })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toMatch(/board\.name/)
    }
  })
})

describe('the awkward cases are in the default fixtures', () => {
  /**
   * These assertions look like tests of the fixture, and they are — on
   * purpose. Each one guards a case a UI built against tidy data gets wrong,
   * and a well-meaning edit that "cleans up" the fixture would remove the
   * only coverage the corresponding UI state has.
   */
  const view = mocks.aBoardView()
  const cards = view.columns.flatMap((c) => c.cards)

  it('includes an unassigned card', () => {
    expect(cards.some((c) => c.assignee === null)).toBe(true)
  })

  it('includes a blocked card with a count above one', () => {
    expect(cards.some((c) => c.blockedByCount > 1)).toBe(true)
  })

  it('includes a card with no estimate', () => {
    expect(cards.some((c) => c.storyPoints === null)).toBe(true)
  })

  it('includes a breached SLA', () => {
    expect(cards.some((c) => c.slaState === 'breached')).toBe(true)
  })

  it('includes a child card, so parent rendering is exercised', () => {
    expect(cards.some((c) => c.parentKey !== null)).toBe(true)
  })

  /**
   * The five fields the card body added, and each of them changes the card's
   * height — so a fixture set where every card carries the same ones renders a
   * column of identical cards and proves nothing about the surface that has to
   * lay out unequal ones.
   */
  it('includes a card with no description, so nothing reserves space for one', () => {
    expect(cards.some((c) => c.descriptionExcerpt === null)).toBe(true)
    expect(cards.some((c) => c.descriptionExcerpt !== null)).toBe(true)
  })

  it('includes an excerpt at exactly the contract’s 240-character bound', () => {
    // One under the limit proves the field parses; one *at* it is the only
    // fixture that would catch an off-by-one in the server's truncation.
    expect(cards.some((c) => (c.descriptionExcerpt?.length ?? 0) === 240)).toBe(true)
  })

  it('includes a card with a subtask checklist, and one with a done row in it', () => {
    expect(cards.some((c) => c.subtasks.length > 0)).toBe(true)
    expect(cards.some((c) => c.subtasks.some((s) => s.isDone))).toBe(true)
    // Both treatments on one card, so the checked and open rows are visible
    // side by side rather than on two different cards.
    expect(
      cards.some((c) => c.subtasks.some((s) => s.isDone) && c.subtasks.some((s) => !s.isDone)),
    ).toBe(true)
  })

  it('includes a capped checklist, where subtaskTotal exceeds what was sent', () => {
    // The card must say how many it is not showing. A checklist of four with no
    // indication looks complete, which is the worst version of that row.
    expect(cards.some((c) => c.subtaskTotal > c.subtasks.length)).toBe(true)
  })

  it('includes a card with neither comments nor attachments', () => {
    // Zero renders nothing, so this is the fixture for the footer that is only
    // an avatar — and its absence is why a `0` on every card went unnoticed.
    expect(cards.some((c) => c.commentCount === 0 && c.attachmentCount === 0)).toBe(true)
    expect(cards.some((c) => c.commentCount > 0 && c.attachmentCount > 0)).toBe(true)
  })

  it('has a column over its WIP limit', () => {
    expect(view.columns.some((c) => c.wipExceeded)).toBe(true)
  })

  it('has a column whose totalCount exceeds the cards it sent', () => {
    // The paged-column case. A UI rendering `cards.length` as the count is
    // wrong here and only here.
    expect(view.columns.some((c) => c.totalCount > c.cards.length)).toBe(true)
  })

  it('has a backlog with a next page', () => {
    expect(mocks.aBacklogView().backlog.nextCursor).not.toBeNull()
  })

  it('has a future sprint that is over capacity', () => {
    expect(mocks.aBacklogView().sprints.some((s) => s.overCapacity)).toBe(true)
  })

  it('has an issue with an unavailable transition that explains itself', () => {
    const blocked = mocks.anIssueDetail().availableTransitions.filter((t) => !t.available)
    expect(blocked.length).toBeGreaterThan(0)
    for (const t of blocked) expect(t.unavailableReason).not.toBeNull()
  })

  it('has links in both directions', () => {
    const dirs = new Set(mocks.anIssueDetail().links.map((l) => l.direction))
    expect([...dirs].sort()).toEqual(['inward', 'outward'])
  })

  it('has a minimal issue where everything nullable is null', () => {
    const min = mocks.aMinimalIssueDetail()
    expect(min.description).toBeNull()
    expect(min.assignee).toBeNull()
    expect(min.priority).toBeNull()
    expect(min.storyPoints).toBeNull()
    expect(min.labels).toHaveLength(0)
    expect(min.links).toHaveLength(0)
  })
})

describe('ranks are the real thing', () => {
  it('every card rank is valid per the contract', () => {
    for (const card of mocks.aBoardView().columns.flatMap((c) => c.cards)) {
      expect(rank.isValidRank(card.rank)).toBe(true)
    }
  })

  it('cards within a column are in ascending rank order', () => {
    // Boards send cards in rank order (BoardViewSchema.columns[].cards). A
    // fixture out of order would let a UI that re-sorts by accident pass.
    for (const column of mocks.aBoardView().columns) {
      const ranks = column.cards.map((c) => c.rank)
      expect(ranks).toEqual([...ranks].sort())
    }
  })

  it('supports the optimistic drag computation the UI will do', () => {
    const [first, second] = mocks.aBoardView().columns[0]?.cards ?? []
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const mid = rank.between(first?.rank ?? null, second?.rank ?? null)
    expect(rank.isValidRank(mid)).toBe(true)
    expect(mid > (first?.rank ?? '')).toBe(true)
    expect(mid < (second?.rank ?? '')).toBe(true)
  })
})

describe('the scenario is one consistent world', () => {
  const s = mocks.scenario()

  it('is cached, so every caller in a run shares one instance', () => {
    expect(mocks.scenario()).toBe(s)
  })

  it('has a detail record for every card on the board', () => {
    for (const key of s.boardIssueKeys) {
      expect(s.issuesByKey[key], `no issue detail for ${key}`).toBeDefined()
    }
  })

  it('agrees with itself about each issue', () => {
    for (const column of s.boardView.columns) {
      for (const card of column.cards) {
        const detail = s.issuesByKey[card.key]
        expect(detail?.summary).toBe(card.summary)
        expect(detail?.statusCategory).toBe(card.statusCategory)
        expect(detail?.storyPoints).toBe(card.storyPoints)
        expect(detail?.assignee?.id ?? null).toBe(card.assignee?.id ?? null)
        // The version must match too: the UI sends the version it read, so a
        // fixture where the card and the detail disagree would make every
        // optimistic-mutation test pass against the wrong number.
        expect(detail?.version).toBe(card.version)
      }
    }
  })

  it('includes issues that are not on the board', () => {
    const offBoard = Object.keys(s.issuesByKey).filter((k) => !s.boardIssueKeys.includes(k))
    // A search result or a link points somewhere outside the current view;
    // with no such issue, that navigation path cannot be tested.
    expect(offBoard.length).toBeGreaterThan(0)
  })

  it('has unique issue keys on the board', () => {
    expect(new Set(s.boardIssueKeys).size).toBe(s.boardIssueKeys.length)
  })

  it('parses whole, through the same schemas the API must satisfy', () => {
    expect(() => BootstrapSchema.parse(s.bootstrap)).not.toThrow()
    expect(() => BoardViewSchema.parse(s.boardView)).not.toThrow()
    expect(() => BacklogViewSchema.parse(s.backlogView)).not.toThrow()
    for (const issue of Object.values(s.issuesByKey)) {
      expect(() => IssueDetailSchema.parse(issue)).not.toThrow()
    }
    for (const thread of Object.values(s.commentsByIssueKey)) {
      for (const comment of thread) expect(() => CommentSchema.parse(comment)).not.toThrow()
    }
    for (const files of Object.values(s.attachmentsByIssueKey)) {
      for (const file of files) expect(() => AttachmentSchema.parse(file)).not.toThrow()
    }
  })

  /**
   * The equality that is the whole reason the thread is derived here.
   *
   * A card says `commentCount: 18`; the panel that opens out of it must produce
   * eighteen comments. When the two disagree the app is in a state no real API
   * could return, and every off-by-one at a "load more" boundary hides behind the
   * discrepancy — the count is what the UI compares its loaded length against.
   */
  it('has a thread exactly as long as each issue’s own commentCount', () => {
    for (const [key, issue] of Object.entries(s.issuesByKey)) {
      expect(s.commentsByIssueKey[key], `no thread for ${key}`).toBeDefined()
      expect(s.commentsByIssueKey[key]?.length, `thread length for ${key}`).toBe(issue.commentCount)
    }
  })

  it('has a file list exactly as long as each issue’s attachmentCount', () => {
    for (const [key, issue] of Object.entries(s.issuesByKey)) {
      expect(s.attachmentsByIssueKey[key], `no attachments for ${key}`).toBeDefined()
      expect(s.attachmentsByIssueKey[key]?.length, `attachment count for ${key}`).toBe(
        issue.attachmentCount,
      )
    }
  })

  it('has a card whose count matches the thread the panel will open', () => {
    // The card is what the panel reads its header from before the thread loads,
    // so the equality above has to hold against the *card* and not only against
    // the detail record derived from it.
    for (const column of s.boardView.columns) {
      for (const card of column.cards) {
        expect(s.commentsByIssueKey[card.key]?.length, `thread for ${card.key}`).toBe(
          card.commentCount,
        )
        expect(s.attachmentsByIssueKey[card.key]?.length, `files for ${card.key}`).toBe(
          card.attachmentCount,
        )
      }
    }
  })

  it('threads every comment to the issue it belongs to', () => {
    // A comment carrying another issue's id is how a cache keyed by issue ends up
    // serving one thread under two keys, which looks like a stale-data bug.
    for (const [key, thread] of Object.entries(s.commentsByIssueKey)) {
      const issueId = s.issuesByKey[key]?.id
      for (const comment of thread) expect(comment.issueId).toBe(issueId)
    }
    for (const [key, files] of Object.entries(s.attachmentsByIssueKey)) {
      const issueId = s.issuesByKey[key]?.id
      for (const file of files) expect(file.issueId).toBe(issueId)
    }
  })

  it('has both an empty thread and one longer than a screen', () => {
    const lengths = Object.values(s.commentsByIssueKey).map((t) => t.length)
    // The designed empty state and the scrolling one. Without the first, the
    // panel's empty state is never rendered; without the second, neither is its
    // scroll position or its day divider.
    expect(lengths).toContain(0)
    expect(Math.max(...lengths)).toBeGreaterThan(20)
  })

  it('orders every thread oldest first, which is the order it is drawn in', () => {
    for (const [key, thread] of Object.entries(s.commentsByIssueKey)) {
      const times = thread.map((c) => c.createdAt)
      expect(times, `thread order for ${key}`).toEqual([...times].sort())
    }
  })

  it('gives every comment a distinct id, across the whole world', () => {
    // Ids are derived from the issue key and the index, so a collision would mean
    // two comments sharing a React key — a swap on re-render rather than an error.
    const all = Object.values(s.commentsByIssueKey).flatMap((t) => t.map((c) => c.id))
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('the generated thread contains the cases a component gets wrong', () => {
  /**
   * Seven cases, each one a state a comment list renders incorrectly the first
   * time it meets it. They are asserted against a thread of six because that is
   * the promise `thread.ts` makes — every case inside the first six entries — and
   * a test written against the 27-entry thread would pass while that promise was
   * quietly broken.
   */
  const thread = mocks.commentsFor('LOG-101', 6)

  it('has both sides of the conversation', () => {
    // Ada is the caller in every fixture, so hers are the "mine" bubble. A thread
    // of one author has never laid out the alternation the reference draws.
    const authors = new Set(thread.map((c) => c.author.id))
    expect(authors.has(mocks.USER_ADA)).toBe(true)
    expect(authors.size).toBeGreaterThan(1)
  })

  it('has a reply, so a flat renderer and a threaded one differ', () => {
    const reply = thread.find((c) => c.parentId !== null)
    expect(reply).toBeDefined()
    // The parent must be in the same thread. A parentId pointing at nothing is
    // what makes a threaded renderer drop the reply silently.
    expect(thread.some((c) => c.id === reply?.parentId)).toBe(true)
  })

  it('has a body with a link mark on it', () => {
    // The rich-text renderer's only externally-reachable node, and the one with a
    // security decision attached (`rel`, `target`).
    const marks = thread.flatMap((c) =>
      (c.body.content ?? []).flatMap((node) =>
        (node.content ?? []).flatMap((leaf) => leaf.marks?.map((m) => m.type) ?? []),
      ),
    )
    expect(marks).toContain('link')
  })

  it('has an edited comment, marked by editedAt rather than updatedAt', () => {
    const edited = thread.find((c) => c.editedAt !== null)
    expect(edited).toBeDefined()
    // Later than createdAt, or the marker would read as "edited before it existed".
    expect(edited?.editedAt).not.toBe(edited?.createdAt)
    expect(String(edited?.editedAt) > String(edited?.createdAt)).toBe(true)
    // `updatedAt` alone cannot drive the marker: it moves for any write to the
    // row, so every unedited comment must have it equal to createdAt.
    for (const c of thread) {
      if (c.editedAt === null) expect(c.updatedAt).toBe(c.createdAt)
    }
    expect(edited?.version).toBeGreaterThan(1)
  })

  it('has an internal comment, which needs a badge saying so', () => {
    expect(thread.some((c) => c.isInternal)).toBe(true)
    expect(thread.some((c) => !c.isInternal)).toBe(true)
  })

  it('has a comment from a deactivated author', () => {
    // UserRef.isInactive is what greys the avatar and withdraws the name as a
    // link. An all-active cast means nothing ever renders it.
    expect(thread.some((c) => c.author.isInactive)).toBe(true)
  })

  it('has a one-word body and a body that wraps', () => {
    const lengths = thread.map((c) => textOf(c.body).length)
    expect(Math.min(...lengths)).toBeLessThan(12)
    expect(Math.max(...lengths)).toBeGreaterThan(150)
  })

  it('has a mention, so the mentioned-user path is not dead code', () => {
    expect(thread.some((c) => c.mentionedUserIds.length > 0)).toBe(true)
  })

  it('produces the same thread for the same arguments, in id and in content', () => {
    expect(JSON.stringify(mocks.commentsFor('LOG-101', 6))).toBe(JSON.stringify(thread))
  })

  it('is a prefix-stable generator: a longer thread ends at the same moment', () => {
    // Both threads end 40 minutes before NOW, so a fixture switched from 6 to 27
    // does not move "now" — which is what would silently invalidate a relative
    // timestamp assertion elsewhere.
    const long = mocks.commentsFor('LOG-101', 27)
    expect(long.at(-1)?.createdAt).toBe(thread.at(-1)?.createdAt)
  })

  it('returns nothing for a count of zero rather than one placeholder', () => {
    expect(mocks.commentsFor('LOG-101', 0)).toEqual([])
    // And the reply's parent guard holds: with one comment there is nothing to
    // reply to, so nothing may claim a parent.
    expect(mocks.commentsFor('LOG-101', 1)[0]?.parentId).toBeNull()
  })
})

describe('attachments and worklogs cover their own branches', () => {
  const files = mocks.attachmentsFor('LOG-101', 4)

  it('covers the icon, preview and no-preview paths with four mime types', () => {
    expect(new Set(files.map((f) => f.mimeType)).size).toBe(4)
    expect(files.some((f) => f.mimeType.startsWith('image/'))).toBe(true)
    expect(files.some((f) => f.mimeType === 'application/pdf')).toBe(true)
    expect(files.some((f) => f.mimeType.startsWith('video/'))).toBe(true)
  })

  it('crosses the byte formatter’s unit boundaries', () => {
    // Kilobytes and megabytes both, because a formatter tested only on one never
    // shows the other's rounding.
    expect(files.some((f) => f.sizeBytes < 1_000_000)).toBe(true)
    expect(files.some((f) => f.sizeBytes > 1_000_000)).toBe(true)
  })

  it('has one file that arrived on a comment rather than on the issue', () => {
    // The two are drawn in different places: a comment's attachment belongs under
    // its bubble, and the issue's belong in the panel's own list.
    expect(files.some((f) => f.commentId !== null)).toBe(true)
    expect(files.some((f) => f.commentId === null)).toBe(true)
  })

  it('carries a downloadUrl with no signature in it', () => {
    // A fixture with a plausible `?sig=` gets copied into a test that pins a URL
    // format the storage provider owns and no client may parse.
    for (const file of files) {
      expect(file.downloadUrl).toMatch(/^https:\/\//)
      expect(file.downloadUrl).not.toContain('?')
    }
  })

  it('sums worklog entries to the issue’s timeSpentSeconds', () => {
    // The property that must hold. An aggregate that disagrees with the entries
    // under it makes every such test look like a rounding bug.
    for (const count of [1, 3, 7]) {
      const logs = mocks.worklogsFor('LOG-101', count, 27_000)
      expect(logs).toHaveLength(count)
      expect(logs.reduce((sum, w) => sum + w.timeSpentSeconds, 0)).toBe(27_000)
      for (const w of logs) expect(() => WorklogSchema.parse(w)).not.toThrow()
    }
  })

  it('has a worklog with no note, which is most of them in practice', () => {
    const logs = mocks.worklogsFor('LOG-101', 4, 14_400)
    expect(logs.some((w) => w.description === null)).toBe(true)
    expect(logs.some((w) => w.description !== null)).toBe(true)
  })

  it('logs work at a time distinct from when it was recorded', () => {
    // `startedAt` is when the work happened; `createdAt` is when someone typed it
    // in. A fixture where they are equal cannot show which one a UI is rendering.
    for (const w of mocks.worklogsFor('LOG-101', 3, 10_800)) {
      expect(w.createdAt).not.toBe(w.startedAt)
    }
  })

  it('returns nothing for a count of zero, rather than dividing by it', () => {
    expect(mocks.worklogsFor('LOG-101', 0, 3600)).toEqual([])
  })
})

describe('error fixtures carry the fields their code actually returns', () => {
  it('validation_failed has per-field detail, including a custom field key', () => {
    const err = mocks.aValidationError()
    expect(err.fields?.length).toBeGreaterThan(0)
    expect(err.fields?.some((f) => f.path.startsWith('customFields.'))).toBe(true)
  })

  it('version_conflict carries currentVersion', () => {
    expect(mocks.aVersionConflictError(9).currentVersion).toBe(9)
  })

  it('permission_denied names the permission', () => {
    expect(mocks.aPermissionDeniedError().requiredPermission).toBe('issue.transition')
  })

  it('in_use is truncated, with a total larger than the list', () => {
    const err = mocks.anInUseError()
    expect(err.blockedByTotal).toBeGreaterThan(err.blockedBy?.length ?? 0)
  })

  it('confirmation_required carries the computed value', () => {
    const err = mocks.aConfirmationRequiredError()
    expect(err.confirmField).toBe('acknowledgeIssueCount')
    expect(err.confirmValue).toBe(218)
  })

  it('rate_limited says how long to wait', () => {
    expect(mocks.aRateLimitedError().retryAfterSeconds).toBe(30)
  })

  it('every error carries a traceId', () => {
    for (const build of [
      mocks.aValidationError,
      mocks.aVersionConflictError,
      mocks.aPermissionDeniedError,
      mocks.anInUseError,
      mocks.aConfirmationRequiredError,
      mocks.aRateLimitedError,
      mocks.aNotFoundError,
      mocks.aBareInternalError,
    ]) {
      expect(build().traceId).toBeTruthy()
    }
  })

  it('has a bare error with none of the optional fields set', () => {
    // The "renders when the optionals are absent" case, which is a separate
    // assertion from "renders when they are present".
    const err = mocks.aBareInternalError()
    expect(err.fields).toBeUndefined()
    expect(err.currentVersion).toBeUndefined()
    expect(err.retryAfterSeconds).toBeUndefined()
  })

  it('lets an explicit undefined clear a default', () => {
    const err = mocks.anApiError({ code: 'rate_limited', retryAfterSeconds: undefined })
    expect('retryAfterSeconds' in err).toBe(false)
  })
})
