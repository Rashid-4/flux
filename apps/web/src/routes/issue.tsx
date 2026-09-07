import type { IssueDetail, LinkType } from '@flux/contracts'
import { ArrowRight, Paperclip, SearchX } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { isApiRequestError } from '@/api/request'
import { IssueKey } from '@/components/data/issue-key'
import { LabelChip } from '@/components/data/label-chip'
import { PriorityIcon } from '@/components/data/priority-icon'
import { RelativeTime } from '@/components/data/relative-time'
import { StatusChip } from '@/components/data/status-chip'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { CommentComposer } from '@/components/issue/comment-composer'
import { CommentThread } from '@/components/issue/comment-thread'
import {
  CopyLinkAction,
  MoreActions,
  MUTATION_REASON,
  WatchAction,
} from '@/components/issue/issue-actions'
import { RichText } from '@/components/issue/rich-text'
import { PageSection } from '@/components/page-section'
import { PaletteAction } from '@/components/palette-action'
import { useShellContext } from '@/components/shell/context'
import {
  type SurfaceHeaderCrumb,
  SurfaceHeader,
  SurfaceHeaderCrumbs,
} from '@/components/surface-header'
import { Button } from '@/components/ui/button'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { useShortcut } from '@/keyboard/use-shortcuts'
import { useDocumentTitle } from '@/lib/document-title'
import { paths, projectKeyOf } from '@/lib/paths'
import { useIssue, useIssueAttachments } from '@/queries/issue'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `/browse/:issueKey` — the whole issue, on a page of its own.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The other end of the flow ../components/issue/issue-peek-panel.tsx starts: a card
 * opens the panel, the panel answers *what is this*, and "See full details" comes
 * here for everything the panel deliberately leaves out — the description as a
 * rendered document rather than a two-line excerpt, the links, the attachments, every
 * field, and the thread without a 441px measure around it.
 *
 * ### There is no reference image for this page
 *
 * `UI Images/JIRA 1.webp` and `JIRA 2.webp` draw the shell, the board and the panel,
 * and nothing else; `JIRA 3.webp` is a different product. So every number here comes
 * from the tokens those two images *did* calibrate — `px-gutter` (36) is the inset the
 * header, the sub-bar and the board columns all share, `pt-9` (36) is the header's own
 * top step, and the type steps are `tokens.css`'s. Nothing is invented per-surface,
 * which is the only way a page with no reference still looks like it belongs to the
 * ones that have one.
 *
 * ### Two columns, and the primary one is first in the DOM
 *
 * `minmax(0,1fr)` and a fixed 22rem, in that order, so reading order and visual order
 * agree and the description is what a screen reader meets first. The `minmax(0,…)` is
 * load-bearing rather than decorative: a grid track's default minimum is `auto`, so a
 * pasted 90-character URL inside `RichText` would widen the whole column past the
 * viewport instead of wrapping inside it — the same failure `min-w-0` prevents in a
 * flex row, spelled the way grid spells it.
 *
 * 22rem is 352px, and it is chosen against the widest thing in the column rather than
 * picked: a transition row holds a name, a status chip and a reason, and the reference
 * window's content column is 1469px — so with two 36px gutters and a 36px gap the
 * description keeps 1009px, which `max-w-3xl` then caps to a readable measure anyway.
 * With the peek panel *also* open (`?peek=` composes with any route) the column is
 * 956px wide and the split still leaves 568px, which is why the details column is a
 * fixed track and not a percentage.
 *
 * ### What this page does not do, and why each omission is stated rather than faked
 *
 * There is no mutation layer yet — `api/issues.ts` has reads only, deliberately, with
 * the reasoning in its own header. `docs/product-quality-bar.md` §13 says a control
 * that silently does nothing is worse than one that says why it cannot, and §5 says an
 * action you cannot perform is *shown* with its reason rather than hidden. Those two
 * rules pull in opposite directions on a page with twenty editable fields, so the line
 * drawn here is:
 *
 *   - **The three controls whose *position* is part of the layout are drawn inert and
 *     say so** — watch, the kebab, and the comment composer. Each already carries its
 *     own reason (`./../components/issue/issue-actions.tsx`, `comment-composer.tsx`),
 *     and a header that gains two buttons when the request lands is a header that moves
 *     under the pointer.
 *   - **Everything else is rendered as *state*, not as a dead control.** An empty
 *     assignee is the words "Unassigned", not a disabled "Assign" button; the workflow
 *     transitions are a list of what the workflow permits, with the server's own reason
 *     under the ones it does not, rather than three buttons that refuse to be pressed.
 *     Twenty inert affordances would satisfy the letter of §5 and produce a page whose
 *     every element is a promise it cannot keep.
 *
 * The other stated gaps: **change history** has no endpoint, so the spec's
 * Comments | History | All tab row would be one real tab and two empty ones — a
 * sentence says so instead. **Custom field values** arrive as `{key: unknown}` with no
 * field library on this screen to name or type them, so the count is reported and the
 * values are not guessed at. And `parentId`, `teamId`, `componentIds` and
 * `fixVersionIds` are bare ids on the read model with no accompanying names — a parent
 * cannot even be linked, since `/browse/:issueKey` takes a key — which is a change
 * request against `IssueDetailSchema` rather than four rows of raw UUIDs here.
 *
 * ### One fixture disagreement is rendered honestly rather than smoothed over
 *
 * `anIssue()` sets `blockedByCount: 0` while `anIssueDetail()` carries an inward
 * `blocks` link from LOG-103, which is `in_progress` — so the trigger-maintained count
 * should be 1. This page reads the count for the "Blocked by" row and the links array
 * for the links section, exactly as `docs/specs/web/issue.md` requires (the badge is
 * never derived from `links`, because `links` is a page of the most relevant ones and
 * not the whole set). On the mock data that shows as a link that says "is blocked by"
 * with no blocked row beside it. That is the fixture's bug surfacing, which is the
 * point: deriving the count here would hide it, and hide the real one the day a trigger
 * regresses.
 */

/** 22rem of details, and the description takes what is left. */
const COLUMNS = 'lg:grid-cols-[minmax(0,1fr)_22rem]'

export function IssueSurface() {
  const { issueKey } = useParams<{ issueKey: string }>()
  /**
   * `?? ''` is unreachable and is not a branch. React Router does not match an empty
   * dynamic segment, so `/browse/` falls through to `*` and `routes/not-found.tsx`
   * answers it; the param is always a non-empty string here. If it somehow were not,
   * the request 404s and the not-found state below renders — which is the same outcome
   * a hand-written guard would produce, without a second copy of the copy.
   */
  const key = issueKey ?? ''
  const { bootstrap } = useShellContext()
  const issue = useIssue(key)
  const detail = issue.data

  /**
   * The key leads, because a tab strip is 150px wide. `LOG-142 · Warehouse scanner…`
   * distinguishes six open issues where the summary alone truncates to `Warehouse…`
   * on every one of them.
   */
  useDocumentTitle(detail === undefined ? key : `${key} · ${detail.summary}`)

  /**
   * `m` focuses the comment box — the one shortcut of the ten in
   * `docs/specs/web/issue.md` §14 that this page can honour.
   *
   * Eight of the others (`a` assign, `i` assign to me, `e` edit, `l` label, `s` status,
   * `c` comment, `.` actions, `Backspace` delete) need mutations that do not exist, and
   * `keyboard/registry.ts` is explicit that the documented-not-handled variant requires
   * a real `implementedBy` *"so the variant cannot be used to quietly park a shortcut
   * nobody wrote"*. So they are not registered and the `?` sheet does not list them:
   * a shortcut in the sheet that does nothing is worse than one nobody knew about.
   *
   * `y` (copy the issue key) is the near miss worth recording. It is implementable, but
   * the key's copy control is `components/data/issue-key.tsx`, which owns the transient
   * ✓ and the blocked-clipboard toast; a keystroke copying from off-screen would either
   * duplicate that state machine or confirm nothing a sighted user can see, which is the
   * silent success §13 rules out. It waits for the moment this page renders that control
   * itself.
   *
   * Scoped to `bodyRef` rather than to the document: `?peek=` composes with this route,
   * so a document-wide query could find the panel's composer instead of the page's.
   */
  const bodyRef = useRef<HTMLDivElement>(null)
  useShortcut({
    id: 'issue.focus-composer',
    binding: [{ key: 'm' }],
    description: 'Focus the comment box',
    group: 'View',
    run: () => {
      bodyRef.current?.querySelector<HTMLElement>('[data-slot="comment-composer"]')?.focus()
    },
  })

  /**
   * The project crumb is resolved from the *URL* first and the response second.
   *
   * `projectKeyOf` parses `LOG-142` → `LOG`, so the crumb and its link exist before
   * `GET /issues/:key` answers; `bootstrap.projects` supplies the human name for the
   * common case where the reader can see the project, and the response's own
   * `projectName` takes over when it lands. The point of the ladder is that no crumb
   * appears, disappears or changes width mid-load — the issue key would otherwise slide
   * sideways on every cold open of the most-visited page in the product.
   */
  const projectKey = projectKeyOf(key)
  /**
   * Compared case-insensitively for the reason `routes/board.tsx` gives: a key typed
   * into the address bar in lower case still resolves in the router, so a `===` here
   * would miss the project and drop the crumb on a URL that works.
   */
  const knownProject =
    projectKey === null
      ? undefined
      : bootstrap.projects.find((candidate) => candidate.key.toLocaleUpperCase() === projectKey)
  const crumbs: SurfaceHeaderCrumb[] =
    projectKey === null
      ? [{ label: key }]
      : [
          {
            label: detail?.projectName ?? knownProject?.name ?? projectKey,
            to: paths.board(projectKey),
          },
          { label: key },
        ]

  if (issue.isLoadingError) {
    /**
     * `isLoadingError` and not `isError`, the same distinction `routes/shell.tsx` and
     * the peek panel both make: an issue that arrived, painted, and then failed a
     * background refetch is still fully readable, and replacing it with a retry button
     * over a network blip is the worse of the two failures.
     */
    const missing = isApiRequestError(issue.error) && issue.error.knownCode === 'not_found'

    return (
      <>
        <SurfaceHeader
          title={missing ? 'Issue not found' : key}
          breadcrumb={<SurfaceHeaderCrumbs items={crumbs} />}
          actions={<PaletteAction />}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center px-gutter">
          {missing ? (
            <EmptyState
              icon={<SearchX aria-hidden="true" className="size-5" />}
              title="No issue with that key"
              /**
               * Deliberately ambiguous between deleted, never-existed and not-yours,
               * matching `docs/specs/api/issues.md` §10 and `routes/planned.tsx`'s
               * project copy: confirming that `SECRET-1` exists but is not shared with
               * you is an information leak dressed as helpfulness. The key is echoed
               * because the first thing a reader does is check it against what they
               * typed or pasted.
               */
              detail={`“${key}” either does not exist or is not shared with you. If a colleague sent this link, ask them for access to the project.`}
            >
              <Button asChild variant="secondary" size="sm">
                <Link to={paths.projects()}>
                  View your projects
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </EmptyState>
          ) : (
            <ErrorState
              error={issue.error}
              onRetry={() => {
                void issue.refetch()
              }}
              heading="h2"
            />
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <SurfaceHeader
        /**
         * The summary is the title, and the key is what stands in for it while the
         * request is in flight — not a skeleton bar. The URL already contains the key,
         * so showing `LOG-142` immediately is strictly more information than a grey
         * rectangle, and the swap is one line of text changing rather than a shape
         * becoming text.
         */
        title={detail?.summary ?? key}
        titleWrap
        lead={
          detail === undefined ? (
            /**
             * The one skeleton in the header, because a glyph has no textual stand-in:
             * the type is not in the URL. Same 24px box, so the title does not shift
             * left by 34px when it arrives.
             */
            <Skeleton className="size-6 rounded-control" />
          ) : (
            <TypeIcon
              issueTypeKey={detail.issueTypeKey}
              name={detail.issueTypeName}
              className="size-6 items-center justify-center"
              glyphClassName="size-6"
            />
          )
        }
        breadcrumb={<SurfaceHeaderCrumbs items={crumbs} />}
        actions={
          <>
            <WatchAction issueKey={key} watcherState={detail?.watcherState} />
            <CopyLinkAction issueKey={key} />
            <MoreActions issueKey={key} />
          </>
        }
      />

      {/**
       * `<main>` is what scrolls in the shell, and this is the block inside it that
       * holds a document — so `overflow-y-auto` lives here rather than being inherited,
       * and `min-h-0` is what lets a flex child shrink below its content so the
       * scroller has something to scroll within.
       */}
      <div
        ref={bodyRef}
        data-slot="issue-body"
        className={`grid min-h-0 flex-1 gap-x-gutter gap-y-10 overflow-y-auto px-gutter py-9 ${COLUMNS}`}
      >
        {detail === undefined ? (
          <IssueSkeleton />
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-10">
              <Description detail={detail} />
              <Subtasks summary={detail.subtaskSummary} />
              <LinkedIssues links={detail.links} />
              <Attachments issueKey={key} expected={detail.attachmentCount} />
              <Comments
                issueKey={key}
                currentUserId={bootstrap.user.id}
                count={detail.commentCount}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-8">
              <Details detail={detail} />
              <Transitions detail={detail} />
            </div>
          </>
        )}
      </div>
    </>
  )
}

/**
 * The description, rendered rather than excerpted.
 *
 * `max-w-3xl` is a reading measure — 48rem holds roughly 90 characters at `text-md`,
 * which is at the upper end of what a line can be before the eye loses its place
 * returning to the left edge. The column is wider than that on a 1841px window, and the
 * text deliberately does not fill it.
 *
 * The empty case is a sentence and not an "Add a description" button: there is nothing
 * to add it with yet, and the page's header explains the line that draws.
 */
function Description({ detail }: { detail: IssueDetail }) {
  return (
    <PageSection title="Description" className="gap-3">
      {detail.description === null ? (
        <p className="text-md text-fg-muted">No description yet.</p>
      ) : (
        <RichText doc={detail.description} className="max-w-3xl text-md text-fg" />
      )}
    </PageSection>
  )
}

/**
 * How much of the breakdown is done — the count, and a bar for the glance.
 *
 * Rendered only when there is a breakdown at all. `subtaskSummary` is `{total, done}`
 * and nothing more, so the children cannot be listed: there is no endpoint that returns
 * them and no names to render if there were. A "Subtasks" section holding a link to a
 * search that does not exist would be worse than the honest count.
 *
 * The bar is `aria-hidden` because the line above it already says the same thing in
 * words — `docs/product-quality-bar.md` §9 wants the visual never to be the only
 * signal, which cuts both ways: a `role="progressbar"` here would announce the ratio a
 * second time.
 */
function Subtasks({ summary }: { summary: IssueDetail['subtaskSummary'] }) {
  if (summary.total <= 0) return null

  const done = Math.min(summary.done, summary.total)
  const percent = Math.round((done / summary.total) * 100)

  return (
    <PageSection title="Subtasks" className="gap-3">
      <p className="text-md text-fg">
        {String(done)} of {String(summary.total)} done
      </p>
      <div
        aria-hidden="true"
        className="h-1.5 w-full max-w-3xl overflow-hidden rounded-chip bg-surface-3"
      >
        {/**
         * An inline `width` because the value is data. It is the one thing on this page
         * that cannot be a token — a percentage computed at render time has no utility
         * to name it, and the lint rule's own exemption note says layout facts are not
         * token material.
         */}
        <div className="h-full rounded-chip bg-success-solid" style={{ width: `${percent}%` }} />
      </div>
    </PageSection>
  )
}

/**
 * Which direction a link reads in, in words rather than in an arrow.
 *
 * `LinkTypeSchema` is closed and `direction` is `outward | inward`, so this is
 * exhaustive by construction — `Record<LinkType, …>` fails to compile the day a sixth
 * link type lands, which is the point of writing it this way rather than as a lookup
 * with a fallback.
 *
 * `relates_to` reads the same both ways, and saying so explicitly is better than a
 * special case in the renderer: a symmetric relationship with two labels is how a UI
 * ends up claiming that A relates to B while B is "related from" A.
 */
const LINK_LABELS: Record<LinkType, { outward: string; inward: string }> = {
  blocks: { outward: 'blocks', inward: 'is blocked by' },
  relates_to: { outward: 'relates to', inward: 'relates to' },
  duplicates: { outward: 'duplicates', inward: 'is duplicated by' },
  causes: { outward: 'causes', inward: 'is caused by' },
  clones: { outward: 'clones', inward: 'is cloned by' },
}

/**
 * The links, grouped by what they mean.
 *
 * Grouped in first-seen order rather than sorted: the server returns the most relevant
 * links first, and re-ordering them alphabetically would put "clones" above "is blocked
 * by" on an issue whose blocker is the only thing that matters.
 *
 * The summary is the link and the key is not (`linked={false}`), which is deliberate:
 * `IssueKey` renders as a link *and* a copy button, so leaving both live would put two
 * tab stops and two identical destinations in every row. One link on the sentence a
 * person reads, one button for the identifier they paste.
 */
function LinkedIssues({ links }: { links: IssueDetail['links'] }) {
  if (links.length === 0) return null

  const groups: { label: string; entries: IssueDetail['links'] }[] = []
  for (const link of links) {
    const label = LINK_LABELS[link.linkType][link.direction]
    const existing = groups.find((group) => group.label === label)
    if (existing === undefined) groups.push({ label, entries: [link] })
    else existing.entries.push(link)
  }

  return (
    <PageSection title="Linked issues" className="gap-4">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <p className="text-xs text-fg-muted">{group.label}</p>
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.issue.id} className="flex min-w-0 items-center gap-3">
                <IssueKey issueKey={entry.issue.key} linked={false} />
                <Link
                  to={paths.issue(entry.issue.key)}
                  className="min-w-0 flex-1 truncate text-md text-fg hover:underline"
                >
                  {entry.issue.summary}
                </Link>
                <StatusChip
                  category={entry.issue.statusCategory}
                  label={entry.issue.statusName}
                  className="shrink-0"
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </PageSection>
  )
}

/**
 * Decimal units, because this is a file size a person compares with their operating
 * system's own number. macOS, iOS and every storage provider's invoice use powers of
 * 1000; `1024` here would report a 1.5 MB upload as 1.4 MB and leave the reader
 * wondering which of the two is lying.
 *
 * One decimal place below 100 and none above it, so a column of these has a stable
 * width without a monospace font.
 */
const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

function formatBytes(bytes: number): string {
  let value = Math.max(bytes, 0)
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${String(rounded)} ${BYTE_UNITS[unit] ?? 'B'}`
}

/**
 * The attachments, on their own query.
 *
 * Separate from the issue because they are separately paginated and separately stale —
 * `ATTACHMENT_STALE_TIME_MS` is a minute, where the issue itself is not cached that
 * long. `attachmentCount` comes from the issue and is shown beside the heading so the
 * reader knows how many are coming before the second request lands.
 *
 * ### `target="_blank" rel="noreferrer"`, and `download` that will not always apply
 *
 * `downloadUrl` is presigned, short-lived and minted per request against a storage host
 * that is not this origin. `rel="noreferrer"` is the part that matters: without it the
 * app's own URL — which contains the issue key, and on other surfaces a search query —
 * travels to that host in a `Referer` header. `noreferrer` implies `noopener`, so the
 * opened context cannot reach back through `window.opener` either.
 *
 * `download` is honest about being advisory: browsers ignore it cross-origin, so a file
 * the storage host serves inline opens in the new tab rather than saving. `_blank` is
 * what makes that survivable — an in-place navigation would tear down the SPA, its
 * query cache and this page's scroll position to display a PDF.
 */
function Attachments({ issueKey, expected }: { issueKey: string; expected: number }) {
  const list = useIssueAttachments(issueKey)
  const items = list.data ?? []

  return (
    <PageSection
      title="Attachments"
      className="gap-3"
      aside={
        expected > 0 ? <span className="text-xs text-fg-muted">{String(expected)}</span> : undefined
      }
    >
      {list.isLoadingError ? (
        <ErrorState
          error={list.error}
          onRetry={() => {
            void list.refetch()
          }}
        />
      ) : list.isPending ? (
        <div className="flex flex-col gap-3">
          <SkeletonText className="w-3/5 text-md" />
          <SkeletonText className="w-2/5 text-md" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Paperclip aria-hidden="true" className="size-5" />}
          title="No attachments"
          detail="Files added to this issue will be listed here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((attachment) => (
            <li key={attachment.id} className="flex min-w-0 flex-col gap-0.5">
              <a
                href={attachment.downloadUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="truncate text-md text-primary-accent hover:underline"
              >
                {attachment.filename}
              </a>
              <p className="truncate text-xs text-fg-muted">
                {formatBytes(attachment.sizeBytes)} · {attachment.uploadedBy.displayName} ·{' '}
                <RelativeTime instant={attachment.createdAt} />
              </p>
            </li>
          ))}
        </ul>
      )}

      {/**
       * `aria-disabled` and a guarded handler rather than `disabled`, which is the idiom
       * `issue-actions.tsx` established and the right one here for a second reason: a
       * `disabled` button is removed from the tab order the instant it is pressed, so a
       * keyboard user's focus falls to `<body>` mid-load and they lose their place in
       * the list they were reading.
       */}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          aria-disabled={list.isFetchingNextPage || undefined}
          onClick={() => {
            if (list.isFetchingNextPage) return
            void list.fetchNextPage()
          }}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Show more attachments'}
        </Button>
      )}
    </PageSection>
  )
}

/**
 * The thread, as a section of a document rather than a bounded scroller.
 *
 * `pinToLatest` is left false — its own docblock has the reason: scrolling a *page* to
 * its newest comment on load throws away the summary the reader navigated to, which is
 * the opposite of the right behaviour in the panel, where the thread *is* the surface.
 *
 * The history sentence is here rather than in a tab row. `docs/specs/web/issue.md` §9
 * asks for Comments | History | All, and there is no history endpoint —
 * `@flux/mocks` has no generator for a page of `IssueHistoryEntry` either — so two of
 * the three tabs would be empty. One line that says what is missing is worth more than
 * a control that proves it.
 */
function Comments({
  issueKey,
  currentUserId,
  count,
}: {
  issueKey: string
  currentUserId: string
  count: number
}) {
  return (
    <PageSection
      title="Comments"
      className="gap-4"
      aside={count > 0 ? <span className="text-xs text-fg-muted">{String(count)}</span> : undefined}
    >
      <CommentThread issueKey={issueKey} currentUserId={currentUserId} />
      <CommentComposer issueKey={issueKey} />
      <p className="text-xs text-fg-muted">
        Change history — who changed what, and when — is not on this screen yet.
      </p>
    </PageSection>
  )
}

/**
 * One `<dt>`/`<dd>` pair, wrapped in a `<div>`.
 *
 * The wrapper is valid inside a `<dl>` as of HTML 5.2 and it is what lets each pair be
 * a flex column without `display: contents`, which Safari still drops from the
 * accessibility tree in some versions — a `<dl>` whose pairs are invisible to a screen
 * reader is a worse trade than one extra element.
 */
function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-fg-muted">{term}</dt>
      <dd className="min-w-0 text-md text-fg">{children}</dd>
    </div>
  )
}

/**
 * A person, as a disc and a name.
 *
 * `decorative` on the avatar, because the name is right there in text — without it a
 * screen reader says "Ada Okafor, Ada Okafor", which is the duplicate
 * `components/error-state.tsx` argues against.
 *
 * `isInactive: false` is a known gap rather than a claim. `IssueDetailSchema` inlines
 * three of `UserRefSchema`'s fields for its reporter and assignee and omits that one,
 * so a departed assignee renders at full opacity here and greyed out in a comment
 * bubble two hundred pixels away. It is one of four read models that hand-inline
 * `UserRef`, and the change request is against the contract rather than patched here.
 */
function Person({ user, absent }: { user: IssueDetail['assignee']; absent: string }) {
  if (user === null) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <UserAvatar user={null} size="sm" absentLabel={absent} decorative />
        <span className="truncate text-fg-muted">{absent}</span>
      </span>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar
        user={{
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isInactive: false,
        }}
        size="sm"
        decorative
      />
      <span className="truncate">{user.displayName}</span>
    </span>
  )
}

/**
 * A `LocalDate` — `2026-03-08` — rendered as a date and not as an instant.
 *
 * Two decisions, and both are the classic date-only bug. The string is parsed as UTC
 * midnight and formatted in UTC, so `2026-03-08` renders as 8 March everywhere; parsed
 * as local and formatted local it would also work, but `new Date('2026-03-08')` is
 * specified to be UTC while `new Date('2026-03-08T00:00')` is local, and mixing the two
 * is how a due date reads a day early west of Greenwich.
 *
 * And it is not `RelativeTime`: that component's tooltip carries a time and a zone,
 * which a date-only value does not have — "8 Mar 2026, 00:00 GMT" invents a precision
 * the field never held.
 *
 * The formatter is cached at module scope for the reason `relative-time.tsx` gives:
 * constructing an `Intl.DateTimeFormat` is among the most expensive calls a browser
 * offers, and a backlog renders hundreds of these.
 */
let dateFormatter: Intl.DateTimeFormat | null = null

function formatLocalDate(value: string): string {
  dateFormatter ??= new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const parsed = new Date(`${value}T00:00:00Z`)
  // A malformed value renders as itself rather than as "Invalid Date", which at least
  // shows the reader what the server sent.
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed)
}

/** Seconds of work as hours and minutes. Days are deliberately not a unit — see below. */
function formatDuration(seconds: number): string {
  const total = Math.max(Math.round(seconds / 60), 0)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${String(minutes)}m`
  if (minutes === 0) return `${String(hours)}h`
  return `${String(hours)}h ${String(minutes)}m`
}

/**
 * Every field on the issue, as a definition list.
 *
 * ### Why the empty ones are words and not affordances
 *
 * `docs/specs/web/issue.md` §13 asks for each optional field to render as something you
 * can act on rather than the word "None", and it also asks a read-only issue to be *"a
 * page that says it is read-only, not a page of dead controls"*. With no mutation layer
 * both cannot hold, and the second is the one that survives: "Unassigned" is a true
 * statement about the issue, while a disabled "Assign" button is a false promise about
 * the product. When the mutation layer lands these `<dd>`s become the editable cells the
 * spec describes, and the words become their empty states — which is the same text.
 *
 * ### The rows that are absent rather than empty
 *
 * Time tracking, resolution, blocked-by and custom fields draw nothing at all when they
 * have nothing to say, because unlike an assignee they are not part of every issue's
 * identity: an issue with no estimate is not "missing" one, and four rows of dashes on
 * every untracked issue is noise that makes the six rows that matter harder to find.
 */
function Details({ detail }: { detail: IssueDetail }) {
  const tracked =
    detail.originalEstimateSeconds !== null ||
    detail.remainingEstimateSeconds !== null ||
    detail.timeSpentSeconds > 0
  const customFieldCount = Object.keys(detail.customFields).length

  return (
    <PageSection title="Details" className="gap-3">
      <dl className="flex flex-col gap-4">
        <Field term="Status">
          <StatusChip category={detail.statusCategory} label={detail.statusName} />
        </Field>

        <Field term="Assignee">
          <Person user={detail.assignee} absent="Unassigned" />
        </Field>

        <Field term="Reporter">
          <Person user={detail.reporter} absent="Unknown" />
        </Field>

        <Field term="Priority">
          {/**
           * `showLabel`, so the `<dd>` reads "High" rather than asking the reader to
           * know what an upward chevron means. The glyph is `aria-hidden` inside that
           * form and the text is the accessible name.
           */}
          <PriorityIcon priority={detail.priority} showLabel />
        </Field>

        <Field term="Story points">
          {detail.storyPoints === null ? (
            <span className="text-fg-muted">Not estimated</span>
          ) : (
            String(detail.storyPoints)
          )}
        </Field>

        <Field term="Sprint">
          {detail.sprintName === null ? (
            <span className="text-fg-muted">Not in a sprint</span>
          ) : (
            detail.sprintName
          )}
        </Field>

        <Field term="Labels">
          {detail.labels.length === 0 ? (
            <span className="text-fg-muted">None</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {detail.labels.map((label) => (
                <LabelChip key={label} label={label} />
              ))}
            </span>
          )}
        </Field>

        <Field term="Due date">
          {detail.dueDate === null ? (
            <span className="text-fg-muted">No due date</span>
          ) : (
            formatLocalDate(detail.dueDate)
          )}
        </Field>

        <Field term="Start date">
          {detail.startDate === null ? (
            <span className="text-fg-muted">Not started</span>
          ) : (
            formatLocalDate(detail.startDate)
          )}
        </Field>

        {tracked && (
          <Field term="Time tracking">
            {/**
             * Three numbers on three lines rather than "2h of 4h, 2h remaining" on one:
             * the estimate, what is left and what has been logged are independently
             * nullable, and a sentence built from them has to be rewritten for each of
             * the eight combinations.
             */}
            <span className="flex flex-col gap-0.5">
              <span>
                Estimate:{' '}
                {detail.originalEstimateSeconds === null
                  ? 'none'
                  : formatDuration(detail.originalEstimateSeconds)}
              </span>
              <span>
                Remaining:{' '}
                {detail.remainingEstimateSeconds === null
                  ? 'unknown'
                  : formatDuration(detail.remainingEstimateSeconds)}
              </span>
              <span>Logged: {formatDuration(detail.timeSpentSeconds)}</span>
            </span>
          </Field>
        )}

        {detail.blockedByCount > 0 && (
          <Field term="Blocked by">
            {/**
             * The trigger-maintained count, never a length of `links` — `links` is the
             * most relevant page of them, so counting it would under-report on an issue
             * with many. The file header records the one fixture where the two disagree.
             */}
            <span className="text-danger-accent">
              {detail.blockedByCount === 1
                ? '1 unfinished issue'
                : `${String(detail.blockedByCount)} unfinished issues`}
            </span>
          </Field>
        )}

        {detail.resolution !== null && (
          <Field term="Resolution">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate">{detail.resolution}</span>
              {detail.resolvedAt !== null && (
                <span className="text-xs text-fg-muted">
                  <RelativeTime instant={detail.resolvedAt} />
                </span>
              )}
            </span>
          </Field>
        )}

        <Field term="Created">
          <RelativeTime instant={detail.createdAt} />
        </Field>

        <Field term="Updated">
          <RelativeTime instant={detail.updatedAt} />
        </Field>

        {customFieldCount > 0 && (
          <Field term="Custom fields">
            {/**
             * The count, and not the values. `CustomFieldValuesSchema` is
             * `Record<string, unknown>` — validated server-side against the project's
             * field configs, which is why "unknown" does not mean "unchecked" — and the
             * definitions that give each key a label, a type and a renderer are a
             * separate endpoint this screen does not call. Printing `severity: major`
             * would put an internal key in front of a user and guess at how to format a
             * value whose type is genuinely not known here.
             */}
            <span className="text-fg-muted">
              {customFieldCount === 1 ? '1 value' : `${String(customFieldCount)} values`}, not shown
              yet — this screen does not load the field library that names them.
            </span>
          </Field>
        )}
      </dl>
    </PageSection>
  )
}

/**
 * What the workflow permits next — as state, not as three buttons.
 *
 * This is the page's clearest example of the line drawn in the file header. The data is
 * genuinely useful: `availableTransitions` carries the server's own resolved answer,
 * including *why* a transition is refused ("Blocked by LOG-103, which is not done.") and
 * what it would need first. Rendering it as a list delivers all of that. Rendering it as
 * `aria-disabled` buttons would deliver the same words wrapped in three controls that
 * cannot be pressed, on a page that already has two.
 *
 * `permissions.canTransition` is read rather than inferred from a role, because the
 * contract is explicit that the client must never infer permissions — that is how a UI
 * offers a button the server then refuses.
 *
 * The requirement lines are the transition's own `requiresFieldKeys` with underscores
 * turned into spaces. That is a display transform on a field *key*, not a translation:
 * there is no field library on this screen to look up a label, and `affected_sites` is
 * more use to a reader than nothing.
 */
function Transitions({ detail }: { detail: IssueDetail }) {
  if (detail.availableTransitions.length === 0) return null

  return (
    <PageSection title="Next states" className="gap-3">
      <p className="text-xs text-fg-muted">
        {detail.permissions.canTransition
          ? `Moving this issue is not available yet. ${MUTATION_REASON}.`
          : 'You do not have permission to move this issue.'}
      </p>
      <ul className="flex flex-col gap-3">
        {detail.availableTransitions.map((transition) => {
          const requirements: string[] = []
          if (!transition.available) {
            requirements.push(transition.unavailableReason ?? 'Not available right now.')
          }
          if (transition.requiresComment) requirements.push('Needs a comment.')
          if (transition.requiresFieldKeys.length > 0) {
            requirements.push(
              `Needs: ${transition.requiresFieldKeys.map((field) => field.replaceAll('_', ' ')).join(', ')}.`,
            )
          }

          /**
           * A transition named after the state it lands in prints its own name twice —
           * `Done  [Done]` — and the fixture has exactly that case.
           *
           * The chip is the one that stays, because it carries strictly more: the word
           * *and* the category, as an icon and a tone. A bare "Done" beside it is the
           * kind of element §7 rules out — visible, aligned, and carrying nothing the
           * thing next to it does not already say.
           *
           * Compared case-insensitively and trimmed, because "Done" and "done " are the
           * same duplication and a workflow's names are typed by an administrator.
           */
          const named = transition.name.trim().toLocaleLowerCase()
          const target = transition.toStateName.trim().toLocaleLowerCase()
          const redundant = named === target

          return (
            <li
              key={transition.id}
              /**
               * The row is addressable by transition id, which is what lets a test scope
               * an assertion to *this* transition's requirements. Two transitions in one
               * workflow can both say "Needs a comment.", so a document-wide query for
               * that sentence is ambiguous — and the resolution belongs here rather than
               * in a `nth-child` in the test, which would break on a reorder.
               */
              data-transition={transition.id}
              className="flex min-w-0 flex-col gap-1"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
                {/**
                 * Muted when unavailable, and never *only* muted: every unavailable
                 * transition renders its reason on the line below, which is the signal a
                 * reader who cannot distinguish the two greys still gets. §9.
                 */}
                {!redundant && (
                  <span
                    className={
                      transition.available
                        ? 'min-w-0 flex-1 truncate text-md text-fg'
                        : 'min-w-0 flex-1 truncate text-md text-fg-muted'
                    }
                  >
                    {transition.name}
                  </span>
                )}
                <StatusChip
                  category={transition.toStateCategory}
                  label={transition.toStateName}
                  className={redundant ? 'min-w-0' : 'shrink-0'}
                />
                {/**
                 * A spacer so the chip sits left of the requirement lines it explains,
                 * rather than being pushed to the right edge on the rows that dropped
                 * their duplicate name.
                 */}
                {redundant && <span className="flex-1" />}
              </span>
              {requirements.map((line) => (
                <span key={line} className="pl-5.5 text-xs text-fg-muted">
                  {line}
                </span>
              ))}
            </li>
          )
        })}
      </ul>
    </PageSection>
  )
}

/**
 * The loading state, in this page's own geometry.
 *
 * Two grid children, so the columns are where they will be when the data lands and
 * nothing moves sideways. The bars are `SkeletonText`, which is one line of whatever
 * type scale it sits in — so the skeleton's rhythm follows the type tokens rather than
 * a set of hand-measured heights that drift the first time a step changes.
 *
 * Ragged widths on purpose: four bars of identical length read as a table.
 */
function IssueSkeleton() {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-10">
        <div className="flex flex-col gap-3">
          <SkeletonText className="w-24 text-label" />
          <div className="flex max-w-3xl flex-col gap-2 text-md">
            <SkeletonText />
            <SkeletonText className="w-11/12" />
            <SkeletonText className="w-4/6" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <SkeletonText className="w-28 text-label" />
          <div className="flex flex-col gap-2 text-md">
            <SkeletonText className="w-3/5" />
            <SkeletonText className="w-2/5" />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <SkeletonText className="w-20 text-label" />
        {/**
         * Six pairs, which is the number of rows every issue has — status, assignee,
         * reporter, priority, created, updated. The conditional rows are not drawn,
         * because a skeleton that promises a "Time tracking" row on an issue that has
         * none is a layout that shrinks when the data arrives.
         */}
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex flex-col gap-1">
            <SkeletonText className="w-16 text-xs" />
            <SkeletonText className="w-2/3 text-md" />
          </div>
        ))}
      </div>
    </>
  )
}
