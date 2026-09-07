import { describe, expect, it } from 'vitest'
import {
  BacklogViewSchema,
  BoardViewSchema,
  BootstrapSchema,
  IssueDetailSchema,
  rank,
} from '@flux/contracts'
import * as mocks from './index.js'
import { uuidFrom } from './determinism.js'

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
    expect(builders.length).toBeGreaterThanOrEqual(19)
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
