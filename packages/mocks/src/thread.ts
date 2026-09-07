import {
  AttachmentSchema,
  CommentPageSchema,
  CommentSchema,
  WorklogSchema,
  type Attachment,
  type Comment,
  type CommentPage,
  type RichTextDoc,
  type UserRef,
  type Worklog,
} from '@flux/contracts'
import { builder } from './builder.js'
import { DAY, HOUR, MINUTE, id, instant } from './determinism.js'
import { USER_ADA, USER_GRACE, USER_LINUS } from './tenancy.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The issue's own lists: comments, attachments, worklogs.
 * ══════════════════════════════════════════════════════════════════════
 *
 * CR-011's shapes, with fixtures behind them. The interesting one is the thread,
 * and the reason it is generated per issue rather than authored once is a
 * consistency rule the scenario already lives by: a card says `commentCount: 18`,
 * so opening it must produce **eighteen** comments. A hand-written thread of five
 * makes the count a decoration, and a UI built against that never renders the
 * scroll position, the "load more" boundary, or the day dividers that only appear
 * once a thread is longer than a screen.
 *
 * ### What the generated thread is careful to contain
 *
 * Not filler. Every case below is one a component gets wrong when it has never
 * seen it, and all of them are packed into the first six entries — so any thread
 * of six or more carries the whole set, and the shorter ones on the board (2 and
 * 4) are themselves the short-thread case:
 *
 *   - **Both sides.** Ada is the caller in every fixture, so her comments are the
 *     "mine" bubble and everyone else's are "theirs". A thread of one author has
 *     never laid out the alternation the reference draws.
 *   - **A reply.** `parentId` pointing at the first entry, because a flat renderer
 *     and a threaded one look identical until one exists.
 *   - **A link mark.** The rich-text renderer's only externally-reachable node
 *     type, and the one with a security decision attached (`rel`, `target`).
 *   - **An edit.** `editedAt` non-null and later than `createdAt`, which is what
 *     makes the "edited" marker appear. `updatedAt` alone cannot: it moves for any
 *     write to the row.
 *   - **An internal comment.** Visible to a member, filtered in the query for a
 *     guest. The badge that says so has to be drawn.
 *   - **A deactivated author.** Linus. `UserRef.isInactive` is what greys the
 *     avatar, and an all-active cast means nothing renders it.
 *   - **A one-word body.** "Confirmed." — the shortest bubble there is, and where
 *     a min-width or a padding assumption shows up.
 *
 * Timestamps run oldest-first, ending shortly before {@link NOW}, so the newest
 * comment is at the bottom the way every chat surface in the world draws it.
 */

const ADA: UserRef = {
  id: USER_ADA,
  displayName: 'Ada Okafor',
  avatarUrl: null,
  isInactive: false,
}
const GRACE: UserRef = {
  id: USER_GRACE,
  displayName: 'Grace Mbeki',
  avatarUrl: null,
  isInactive: false,
}
/** Deactivated — the case that greys an avatar instead of offering the name. */
const LINUS: UserRef = {
  id: USER_LINUS,
  displayName: 'Linus Haddad',
  avatarUrl: null,
  isInactive: true,
}

/** A paragraph of plain text, which is what most comments actually are. */
function para(text: string): RichTextDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const STATUS_PAGE = 'https://status.northwind.example/incidents/4182'

/**
 * The bodies, in order. Index 2 carries the link; the rest are paragraphs.
 *
 * Written as a warehouse-software conversation rather than as lorem ipsum because
 * line-wrapping is being measured off these: "Confirmed." must be one short
 * bubble and the second entry must wrap to three lines at the reference's 358px,
 * and neither is checkable against placeholder text of uniform length.
 */
const BODIES: readonly RichTextDoc[] = [
  para('Confirmed.'),
  para(
    'Reproduced on SCN-4 twice this morning. Both times the session dropped within ' +
      'a second of the handover job starting, so it looks like the job is invalidating ' +
      'sessions it does not own rather than the scanners timing out on their own.',
  ),
  {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Same window as the auth incident — ' },
          {
            type: 'text',
            text: STATUS_PAGE,
            marks: [{ type: 'link', attrs: { href: STATUS_PAGE } }],
          },
          { type: 'text', text: '. Worth ruling that out before we change anything here.' },
        ],
      },
    ],
  },
  para(
    'Flagging internally: the Cork depot is on the old firmware and I do not want ' +
      'to promise them a fix date until we know whether that matters.',
  ),
  para(
    'Handover job is ours. It calls revokeAll() when it should call revoke(deviceId), ' +
      'which explains why a manual handover never triggers it — the manual path does not ' +
      'go through that job at all.',
  ),
  para('Nice find. Do we need a migration for the sessions already orphaned, or do they age out?'),
  para('They age out after twelve hours. Nothing to migrate.'),
  para(
    'Pulled the scanner logs for the last four shifts and attached them. The pattern ' +
      'holds on every night shift and on none of the day shifts.',
  ),
]

/**
 * Ada is the caller, so her entries are the "mine" side of the thread.
 *
 * Linus is at index 5 rather than last so that the deactivated-author case lands
 * inside the first six entries with the others. At the end of the table he would
 * only appear on a thread of eight or more, and the board's threads are 0, 2, 4,
 * 11, 18 and 27 — so three of the six would never render a greyed avatar.
 */
const AUTHORS: readonly UserRef[] = [GRACE, GRACE, GRACE, ADA, ADA, LINUS, ADA, GRACE]

/**
 * Cycle through a non-empty table, with the narrowing in the *return type*.
 *
 * `noUncheckedIndexedAccess` types every element access as `T | undefined`, and
 * module-scope knowledge that the array is non-empty does not survive into a
 * caller. A conditional spread at each site would work and would put four
 * `?? fallback` branches into fixtures that can never take them; a helper whose
 * signature says `T` puts the one unreachable throw in one place.
 */
function cycle<T>(table: readonly T[], i: number): T {
  const value = table[i % table.length]
  if (value === undefined) throw new Error('cycle() over an empty table')
  return value
}

export const aComment = builder(CommentSchema, () => ({
  id: id<'CommentId'>('comment', 'log-101-1'),
  issueId: id<'IssueId'>('issue', 101),
  author: GRACE,
  body: cycle(BODIES, 1),
  parentId: null,
  isInternal: false,
  mentionedUserIds: [],
  version: 1,
  createdAt: instant(-2 * DAY),
  updatedAt: instant(-2 * DAY),
  editedAt: null,
}))

/**
 * `count` comments on `issueKey`, oldest first.
 *
 * Deterministic in the seed as well as in the content: the id is derived from the
 * issue key and the index, so the same comment has the same id in every process —
 * which is what lets a test assert on one by id, and what stops a React key from
 * changing between renders of the same thread.
 */
export function commentsFor(issueKey: string, count: number): Comment[] {
  const issueNumber = Number(issueKey.slice(issueKey.indexOf('-') + 1))
  const first = id<'CommentId'>('comment', `${issueKey}-0`)

  return Array.from({ length: count }, (_, i): Comment => {
    /**
     * Oldest first, ending 40 minutes before now, five hours apart. Uniform
     * spacing rather than a curve, because what a day divider needs is a thread
     * whose *span* scales with its length: 27 entries reach back five and a half
     * days and two entries stay inside one morning, so both sides of that divider
     * come out of one generator instead of a second long fixture.
     */
    const age = (count - i) * 5 * HOUR + 40 * MINUTE

    return aComment({
      id: id<'CommentId'>('comment', `${issueKey}-${String(i)}`),
      issueId: id<'IssueId'>('issue', issueNumber),
      author: cycle(AUTHORS, i),
      body: cycle(BODIES, i),
      /** The second entry replies to the first; everything after is top-level. */
      parentId: i === 1 && count > 1 ? first : null,
      /** One internal comment per thread, at the index where it is visible. */
      isInternal: i === 3,
      /** The reply mentions the person it is replying to. */
      mentionedUserIds: i === 1 ? [USER_GRACE] : [],
      version: i === 4 ? 2 : 1,
      createdAt: instant(-age),
      updatedAt: instant(i === 4 ? -age + 20 * MINUTE : -age),
      /** Edited twenty minutes after it was written — the "edited" marker's case. */
      editedAt: i === 4 ? instant(-age + 20 * MINUTE) : null,
    } as Parameters<typeof aComment>[0])
  })
}

/**
 * One page of a thread.
 *
 * `nextCursor` is null by default because the common fixture is a thread that
 * fits. Pass a cursor to get the case that matters more — a UI that has never
 * seen a non-null cursor has never drawn the boundary between "this is the whole
 * conversation" and "this is the end of page one", and those must not look alike.
 */
export function aCommentPage(items: Comment[] = [], nextCursor: string | null = null): CommentPage {
  // Parsed rather than returned, so this earns its place in the census that calls
  // every builder and asserts the contract accepts what came back.
  return CommentPageSchema.parse({ items, nextCursor })
}

export const anAttachment = builder(AttachmentSchema, () => ({
  id: id<'AttachmentId'>('attachment', 'log-101-0'),
  issueId: id<'IssueId'>('issue', 101),
  commentId: null,
  filename: 'scanner-session-log-2026-02-28.txt',
  mimeType: 'text/plain',
  sizeBytes: 48_206,
  uploadedBy: GRACE,
  createdAt: instant(-2 * DAY),
  /**
   * Deliberately signature-free. The real one is presigned and short-lived, and a
   * fixture that carried a plausible-looking `?sig=` would get copied into a test
   * asserting the URL's shape — pinning a format that the storage provider owns
   * and that no client may parse.
   */
  downloadUrl: 'https://files.flux.example/download/log-101-0',
}))

/**
 * `count` files on `issueKey`. The mix is deliberate — a text log, a PNG, a PDF and
 * an MP4 — because the icon, the inline-preview decision and the "no preview
 * possible" fallback are three different code paths, and a fixture of one type only
 * ever exercises one of them. The MP4 is also the only entry whose size crosses
 * into megabytes, which is where a byte formatter's unit boundary shows up, and its
 * filename is the only one with a space in it.
 */
export function attachmentsFor(issueKey: string, count: number): Attachment[] {
  const issueNumber = Number(issueKey.slice(issueKey.indexOf('-') + 1))
  const files: readonly { filename: string; mimeType: string; sizeBytes: number }[] = [
    { filename: 'scanner-session-log-2026-02-28.txt', mimeType: 'text/plain', sizeBytes: 48_206 },
    { filename: 'handover-timeline.png', mimeType: 'image/png', sizeBytes: 271_884 },
    { filename: 'depot-firmware-matrix.pdf', mimeType: 'application/pdf', sizeBytes: 1_204_770 },
    { filename: 'SCN-4 shift change.mp4', mimeType: 'video/mp4', sizeBytes: 18_442_119 },
  ]

  return Array.from({ length: count }, (_, i): Attachment => {
    return anAttachment({
      id: id<'AttachmentId'>('attachment', `${issueKey}-${String(i)}`),
      issueId: id<'IssueId'>('issue', issueNumber),
      /** The third file arrived on a comment rather than on the issue. */
      commentId: i === 2 ? id<'CommentId'>('comment', `${issueKey}-2`) : null,
      ...cycle(files, i),
      uploadedBy: i % 2 === 0 ? GRACE : ADA,
      createdAt: instant(-(count - i) * 6 * HOUR),
      downloadUrl: `https://files.flux.example/download/${issueKey}-${String(i)}`,
    } as Parameters<typeof anAttachment>[0])
  })
}

const NOTES: readonly string[] = [
  'Pulled the session logs off SCN-4 and SCN-7 and lined them up with the job runs.',
  'Read the handover job end to end and wrote the revoke path up in the description.',
  'Paired with Grace on the fix and left the Cork firmware question open.',
]

export const aWorklog = builder(WorklogSchema, () => ({
  id: id<'WorklogId'>('worklog', 'log-101-0'),
  issueId: id<'IssueId'>('issue', 101),
  author: ADA,
  timeSpentSeconds: 90 * 60,
  startedAt: instant(-1 * DAY),
  description: cycle(NOTES, 0),
  createdAt: instant(-1 * DAY + 2 * HOUR),
  updatedAt: instant(-1 * DAY + 2 * HOUR),
}))

/**
 * `count` worklog entries summing to `totalSeconds`, so the list agrees with
 * `IssueSchema.timeSpentSeconds`.
 *
 * The remainder goes on the last entry rather than being distributed, because the
 * property that must hold is the *sum* — a UI that shows entries and an aggregate
 * has to be built against a set where adding the first up gives the second, and a
 * fixture that is off by a minute makes every such test look like a rounding bug.
 */
export function worklogsFor(issueKey: string, count: number, totalSeconds: number): Worklog[] {
  if (count === 0) return []

  const issueNumber = Number(issueKey.slice(issueKey.indexOf('-') + 1))
  const each = Math.floor(totalSeconds / count)

  return Array.from({ length: count }, (_, i): Worklog => {
    const isLast = i === count - 1
    return aWorklog({
      id: id<'WorklogId'>('worklog', `${issueKey}-${String(i)}`),
      issueId: id<'IssueId'>('issue', issueNumber),
      author: i % 2 === 0 ? ADA : GRACE,
      timeSpentSeconds: isLast ? totalSeconds - each * (count - 1) : each,
      startedAt: instant(-(count - i) * DAY),
      /** One entry with no note, which is most of them in practice. */
      description: i === 1 ? null : cycle(NOTES, i),
      createdAt: instant(-(count - i) * DAY + 3 * HOUR),
      updatedAt: instant(-(count - i) * DAY + 3 * HOUR),
    } as Parameters<typeof aWorklog>[0])
  })
}

export type { Attachment, Comment, CommentPage, Worklog }
