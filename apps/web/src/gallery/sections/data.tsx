import { type Priority, PrioritySchema, StatusCategorySchema } from '@flux/contracts'
import { NOW } from '@flux/mocks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/data/confirm-dialog'
import { IssueKey } from '@/components/data/issue-key'
import { LabelChip } from '@/components/data/label-chip'
import { PriorityIcon } from '@/components/data/priority-icon'
import { formatRelative, RelativeTime } from '@/components/data/relative-time'
import { StatusChip } from '@/components/data/status-chip'
import { toast } from '@/components/data/toaster'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
import { VirtualList } from '@/components/data/virtual-list'
import { Button } from '@/components/ui/button'
import { Note, Panel, Section, Specimen } from '../frame'
import {
  ADA,
  BROKEN_PHOTO,
  INACTIVE,
  ISSUE_KEY,
  LABELS,
  LONG_ISSUE_KEY,
  LONG_NAME,
  MONONYM,
  TONE_USERS,
  WITH_PHOTO,
} from '../fixtures'

/**
 * The ten flux-level components, and — the part that matters — what each of them
 * does with no data, too much data, and a failure.
 *
 * One convention runs through all of them and is worth reading off the page rather
 * than out of a comment: **`null` means absent, never loading.** Four of these used
 * to render a `Skeleton` for `null`, which made unassigned issues and untriaged
 * priorities pulse forever — an animation promising data that was never coming, on
 * the majority of cards. Loading is composed by the caller in the shape of the
 * content, which is what the Skeleton row in "Surfaces" shows.
 */

const PRIORITIES = PrioritySchema.options
const CATEGORIES = StatusCategorySchema.options

/** The ages `formatRelative` has a distinct bucket for. */
const AGES: readonly { label: string; ms: number }[] = [
  { label: '20 seconds', ms: 20_000 },
  { label: '4 minutes', ms: 4 * 60_000 },
  { label: '3 hours', ms: 3 * 3_600_000 },
  { label: '2 days', ms: 2 * 86_400_000 },
  { label: '3 weeks', ms: 21 * 86_400_000 },
  { label: '14 months', ms: 425 * 86_400_000 },
]

/**
 * The fixture clock. `aBootstrap()` reports this as `serverTime`, and the gallery
 * seeds it into the query cache, so every instant below is read relative to it —
 * which is what makes these specimens stable rather than drifting with the wall
 * clock of whoever opens the page.
 */
const NOW_MS = Date.parse(NOW)

function instantBefore(ms: number): string {
  return new Date(NOW_MS - ms).toISOString()
}

/**
 * A client with nothing in it, so `useBootstrap()` has no data and the offset is
 * `null`. That is the real pre-bootstrap state — `RelativeTime` shows the absolute
 * date rather than guessing an "ago" against a clock it has not checked — and the
 * only honest way to show it on a page whose whole point is that bootstrap *has*
 * resolved. `retry: false` so the miss does not go looking for an API.
 */
const UNSEEDED_CLIENT = new QueryClient({
  defaultOptions: { queries: { retry: false, enabled: false } },
})

interface Row {
  id: string
  summary: string
}

const ROWS: readonly Row[] = Array.from({ length: 2_000 }, (_, index) => ({
  id: `row-${String(index)}`,
  summary: `FLUX-${String(1000 + index)} · Board column mapping survives a workflow republish`,
}))

/**
 * Typed rather than a bare `[]`, because `VirtualList` infers its item type from
 * `items` and an empty literal infers `never` — which then rejects the `children`
 * renderer the component requires even in the empty case.
 */
const EMPTY_ROWS: readonly Row[] = []

export function DataSection() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)

  return (
    <Section
      id="data"
      title="Data components"
      note="The ten components in components/data/. Each row includes the states nobody draws: absent, overflowing, and failed."
    >
      <Panel
        label="UserAvatar · all eight hues"
        note="Hash-stable: the same user id is always the same colour."
      >
        {TONE_USERS.map((user) => (
          <Specimen key={user.id} label={`tone ${String(TONE_USERS.indexOf(user))}`}>
            <UserAvatar user={user} />
          </Specimen>
        ))}
      </Panel>

      <Panel label="UserAvatar · sizes and states">
        <Specimen label="sm">
          <UserAvatar user={ADA} size="sm" />
        </Specimen>
        <Specimen label="md">
          <UserAvatar user={ADA} />
        </Specimen>
        <Specimen label="lg">
          <UserAvatar user={ADA} size="lg" />
        </Specimen>
        <Specimen label="photo">
          <UserAvatar user={WITH_PHOTO} size="lg" />
        </Specimen>
        <Specimen label="photo 404 → initials">
          <UserAvatar user={BROKEN_PHOTO} size="lg" />
        </Specimen>
        <Specimen label="inactive · own hue at 50%">
          <UserAvatar user={INACTIVE} size="lg" />
        </Specimen>
        <Specimen label="unassigned · null">
          <UserAvatar user={null} size="lg" />
        </Specimen>
        <Specimen label="null, relabelled">
          <UserAvatar user={null} absentLabel="Any assignee" />
        </Specimen>
        <Specimen label="one-word name">
          <UserAvatar user={MONONYM} />
        </Specimen>
        <Specimen label="very long name">
          <UserAvatar user={LONG_NAME} />
        </Specimen>
      </Panel>

      <Note>
        The unassigned avatar is a designed state, not a fallback: a dashed ring around an empty
        silhouette reads as a slot waiting to be filled, and it keeps the box the same size so
        assigning someone does not reflow the row.
      </Note>

      <Panel label="StatusChip" note="Tone is the family; the glyph is the non-colour signal.">
        {CATEGORIES.map((category) => (
          <Specimen key={category} label={category}>
            <StatusChip category={category} />
          </Specimen>
        ))}
        <Specimen label="workflow state name">
          <StatusChip category="in_progress" label="In code review" />
        </Specimen>
        <Specimen label="overlong state name">
          <StatusChip category="todo" label="Waiting on the platform security review board" />
        </Specimen>
      </Panel>

      <Panel label="PriorityIcon">
        {PRIORITIES.map((priority: Priority) => (
          <Specimen key={priority} label={priority}>
            <PriorityIcon priority={priority} />
          </Specimen>
        ))}
        <Specimen label="null · no priority">
          <PriorityIcon priority={null} />
        </Specimen>
        <Specimen label="null, relabelled">
          <PriorityIcon priority={null} absentLabel="Any priority" />
        </Specimen>
      </Panel>

      <Panel
        label="TypeIcon"
        note="IssueTypeKey is not a closed enum — the values are tenant-defined, so an unknown key gets the generic glyph and its own name rather than nothing."
      >
        {['epic', 'story', 'task', 'bug', 'subtask', 'initiative', 'theme'].map((key) => (
          <Specimen key={key} label={key}>
            <TypeIcon issueTypeKey={key} />
          </Specimen>
        ))}
        <Specimen label="tenant-defined key">
          <TypeIcon issueTypeKey="incident_review" name="Incident review" />
        </Specimen>
        <Specimen label="unknown, no name">
          <TypeIcon issueTypeKey="spike" />
        </Specimen>
      </Panel>

      <Panel label="LabelChip">
        {LABELS.map((label) => (
          <Specimen key={label} label={label.length > 16 ? 'long · truncates' : 'fits'}>
            <LabelChip label={label} />
          </Specimen>
        ))}
        <Specimen label="empty string · renders nothing">
          <span className="rounded-control border border-dashed border-border-strong px-2 py-1 text-2xs text-fg-subtle">
            <LabelChip label="" />
            nothing here
          </span>
        </Specimen>
        <Specimen label="a row of them" wide>
          {LABELS.map((label) => (
            <LabelChip key={label} label={label} />
          ))}
        </Specimen>
      </Panel>

      <Panel
        label="IssueKey"
        note="Derives its own link. Copy failure raises a toast that names the key."
      >
        <Specimen label="linked · the default">
          <IssueKey issueKey={ISSUE_KEY} />
        </Specimen>
        <Specimen label="unlinked · inside a card that is already a link">
          <IssueKey issueKey={ISSUE_KEY} linked={false} />
        </Specimen>
        <Specimen label="long key">
          <IssueKey issueKey={LONG_ISSUE_KEY} />
        </Specimen>
        <Specimen label="constrained · truncates">
          <div className="w-24">
            <IssueKey issueKey={LONG_ISSUE_KEY} />
          </div>
        </Specimen>
      </Panel>

      <Panel
        label="RelativeTime"
        note="Rendered against the server's clock, not the browser's. The gallery seeds a bootstrap so the offset resolves; the last specimen drops that on purpose, which is the state every surface shows before bootstrap lands."
      >
        <Specimen label="an hour ago">
          <RelativeTime instant={instantBefore(3_600_000)} />
        </Specimen>
        <Specimen label="yesterday">
          <RelativeTime instant={instantBefore(86_400_000)} />
        </Specimen>
        <Specimen label="last year">
          <RelativeTime instant={instantBefore(400 * 86_400_000)} />
        </Specimen>
        <Specimen label="in the future">
          <RelativeTime instant={instantBefore(-2 * 3_600_000)} />
        </Specimen>
        <Specimen label="no offset yet · absolute">
          <QueryClientProvider client={UNSEEDED_CLIENT}>
            <RelativeTime instant={instantBefore(3_600_000)} />
          </QueryClientProvider>
        </Specimen>
        <Specimen label="null · absent">
          <RelativeTime instant={null} />
        </Specimen>
        <Specimen label="null, relabelled">
          <RelativeTime instant={null} absentLabel="Not resolved" />
        </Specimen>
        <Specimen label="unparseable input">
          <RelativeTime instant="not-a-date" />
        </Specimen>
        <Specimen label="formatRelative buckets" wide>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {AGES.map((age) => (
              <span key={age.label} className="font-mono text-2xs text-fg-subtle">
                {age.label} → {formatRelative(NOW_MS - age.ms, NOW_MS)}
              </span>
            ))}
            <span className="font-mono text-2xs text-fg-subtle">
              future → {formatRelative(NOW_MS + 3 * 3_600_000, NOW_MS)}
            </span>
          </div>
        </Specimen>
      </Panel>

      <Panel
        label="Toaster"
        note="Max three visible, oldest dropped first. danger never expires — it is the one carrying something the user has to act on, and auto-hiding it is a control that silently takes its own report away."
      >
        <Specimen label="neutral">
          <Button
            size="sm"
            onClick={() => {
              toast({ title: 'Draft saved' })
            }}
          >
            Raise neutral
          </Button>
        </Specimen>
        <Specimen label="success">
          <Button
            size="sm"
            onClick={() => {
              toast({
                title: 'Sprint 24 started',
                description: '18 issues committed.',
                tone: 'success',
              })
            }}
          >
            Raise success
          </Button>
        </Specimen>
        <Specimen label="info">
          <Button
            size="sm"
            onClick={() => {
              toast({ title: 'Import queued', description: 'Roughly 40 minutes.', tone: 'info' })
            }}
          >
            Raise info
          </Button>
        </Specimen>
        <Specimen label="danger · no timeout">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              toast({
                title: 'Could not copy FLUX-128',
                description:
                  'Your browser blocked clipboard access. Select the key and copy it manually.',
                tone: 'danger',
              })
            }}
          >
            Raise danger
          </Button>
        </Specimen>
        <Specimen label="overflow · four at once">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              for (const n of [1, 2, 3, 4]) {
                toast({ title: `Bulk update ${String(n)} of 4 failed`, tone: 'danger' })
              }
            }}
          >
            Raise four
          </Button>
        </Specimen>
      </Panel>

      <Panel label="ConfirmDialog" note="Always destructive. There is no primary confirm variant.">
        <Specimen label="open it">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirmPending(false)
              setConfirmOpen(true)
            }}
          >
            Delete sprint
          </Button>
        </Specimen>
        <Specimen label="open it, pending">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setConfirmPending(true)
              setConfirmOpen(true)
            }}
          >
            Delete sprint (in flight)
          </Button>
        </Specimen>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete Sprint 24?"
          description="18 issues will return to the backlog. The sprint report will no longer be available."
          confirmLabel="Delete sprint"
          pending={confirmPending}
          onConfirm={() => {
            setConfirmOpen(false)
            toast({ title: 'Sprint 24 deleted', tone: 'success' })
          }}
        />
      </Panel>

      <Panel
        label="VirtualList"
        note="2,000 rows, one tab stop. Arrow keys move aria-activedescendant and scroll the row into view; the active row is kept in the DOM by a rangeExtractor so the IDREF never dangles."
        className="flex-col items-stretch"
      >
        <Specimen label="2,000 rows · focus it and press End" wide>
          <VirtualList
            items={ROWS}
            label="Backlog"
            estimateSize={() => 32}
            getItemKey={(row) => row.id}
            className="h-48 w-full max-w-xl rounded-card border border-border"
          >
            {(row) => (
              <div className="flex h-row items-center gap-2 px-3 text-base text-fg">
                <span className="truncate">{row.summary}</span>
              </div>
            )}
          </VirtualList>
        </Specimen>
        <Specimen label="empty · the default message" wide>
          <VirtualList
            items={EMPTY_ROWS}
            label="Empty backlog"
            estimateSize={() => 32}
            getItemKey={(row) => row.id}
            className="h-24 w-full max-w-xl rounded-card border border-border"
          >
            {(row) => <span>{row.summary}</span>}
          </VirtualList>
        </Specimen>
        <Specimen label="empty · a designed state" wide>
          <VirtualList
            items={EMPTY_ROWS}
            label="Filtered backlog"
            estimateSize={() => 32}
            getItemKey={(row) => row.id}
            className="h-32 w-full max-w-xl rounded-card border border-border"
            empty={
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-base text-fg">No issues match this filter</p>
                <p className="text-sm text-fg-muted">
                  Four filters are active. Clearing the assignee would show 84 issues.
                </p>
                <Button size="sm" variant="secondary">
                  Clear filters
                </Button>
              </div>
            }
          >
            {(row) => <span>{row.summary}</span>}
          </VirtualList>
        </Specimen>
      </Panel>
    </Section>
  )
}
