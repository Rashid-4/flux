import { MessageSquare, MoreHorizontal, Paperclip, Plus } from 'lucide-react'
import { IssueKey } from '@/components/data/issue-key'
import { LabelChip } from '@/components/data/label-chip'
import { PriorityIcon } from '@/components/data/priority-icon'
import { StatusChip } from '@/components/data/status-chip'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Note, Panel, Section } from '../frame'
import { ADA, INACTIVE, ISSUE_KEY, LONG_SUMMARY, SHORT_SUMMARY, TONE_USERS } from '../fixtures'

/**
 * The primitives assembled into the three shapes they actually appear in.
 *
 * This section builds nothing reusable and exports no component — it lives inside
 * `src/gallery/` on purpose. A shared `IssueCard` belongs to the board surface and
 * to the session that owns `routes/`, and inventing one here would be a second
 * definition for that session to collide with.
 *
 * What it is for is the thing a specimen grid cannot show: **density in
 * aggregate.** A chip judged on its own always looks fine. Eight of them on a
 * 280px card, three times down a column, is where one extra pixel of padding
 * becomes a card that fits five rows instead of six — and that comparison against
 * `UI Images/` is the whole of task 2.
 */

interface CardProps {
  issueKeyValue: typeof ISSUE_KEY
  summary: string
  category: 'todo' | 'in_progress' | 'done' | 'cancelled'
  priority: 'blocker' | 'high' | 'medium' | 'low' | null
  typeKey: string
  labels: readonly string[]
  assignee: typeof ADA | null
  comments: number
  attachments: number
}

/**
 * `rounded-card` + `shadow-card` on `surface`, which is the elevation rung the
 * README assigns to an issue card at rest. Not a component — a specimen.
 */
function BoardCard({
  issueKeyValue,
  summary,
  category,
  priority,
  typeKey,
  labels,
  assignee,
  comments,
  attachments,
}: CardProps) {
  return (
    <article className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {labels.map((label) => (
            <LabelChip key={label} label={label} />
          ))}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${issueKeyValue}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </div>

      {/*
        No `leading-snug`. The relative leading utilities multiply the font size,
        and with a 13px base every one of them lands on a fraction — `snug` is
        1.375 × 13 = 17.875px. A fractional line box puts every baseline in the
        block on a half pixel, which is a real softness on text, and it made the
        card's own height fractional too (175.63px). The type step already
        carries an integer line-height; taking it is both crisper and less to
        say.
      */}
      <p className="text-base text-fg">{summary}</p>

      {/*
        Two rows, not one, and this is the shape `UI Images/JIRA 3.webp` uses.
        It started as a single `justify-between` row and it did not fit: measured
        at the reference's own 280px column, the identifier group had 51px to
        spend and `IssueKey` was crushed to 11px around 40px of content — the key
        illegible, the copy button drawn over it. `IssueKey` now degrades to an
        ellipsis at a legible floor rather than to a sliver, but degrading well is
        not the same as fitting, and an issue key is the one thing on a card that
        has to stay readable.

        So the metadata that identifies the issue gets its own line, and the
        counts and people get the next one. Nothing was dropped and nothing was
        made smaller.
      */}
      <div className="flex min-w-0 items-center gap-1.5">
        <TypeIcon issueTypeKey={typeKey} />
        <IssueKey issueKey={issueKeyValue} />
        <PriorityIcon priority={priority} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusChip category={category} />
          {comments > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-sm text-fg-subtle">
              <MessageSquare aria-hidden="true" className="size-3.5" />
              <span aria-label={`${String(comments)} comments`}>{comments}</span>
            </span>
          )}
          {attachments > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-sm text-fg-subtle">
              <Paperclip aria-hidden="true" className="size-3.5" />
              <span aria-label={`${String(attachments)} attachments`}>{attachments}</span>
            </span>
          )}
        </div>
        <UserAvatar user={assignee} size="sm" className="shrink-0" />
      </div>
    </article>
  )
}

export function ComposedSection() {
  return (
    <Section
      id="composed"
      title="Composed"
      note="The primitives in the shapes they actually ship in. Nothing here is reusable — the board surface belongs to another session — but density only shows up in aggregate, so this is where UI Images/ gets compared."
    >
      <Panel
        label="Filter bar · one baseline across five components"
        className="flex-col items-stretch"
      >
        {/*
          `min-h-subbar`, not `h-subbar`. A fixed height and `flex-wrap` cannot both
          hold: measured at 375px, the box stayed 46px while its children reached
          155px, so the search input and the avatar stack rendered *outside* the bar
          and on top of the next panel. At any width where the row fits it is still
          exactly 48px, so the specimen shows the real height where the real height
          is the point.

          This is the rule `page-header.tsx` already writes down for `min-h-topbar`
          — reused rather than rediscovered. The product's own bars were right; only
          this specimen was wrong, which is the shape worth noticing: the gallery is
          the instrument, and an instrument that overlaps its own panels is telling
          you something about itself.
        */}
        <div className="flex min-h-subbar w-full flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-3">
          <Tabs defaultValue="kanban">
            <TabsList>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
          </Tabs>
          <Separator orientation="vertical" className="h-5" />
          <div className="w-56">
            <Input
              size="sm"
              placeholder="Search this board"
              aria-label="Search this board"
              className="bg-surface-2"
            />
          </div>
          <Select>
            <SelectTrigger size="sm" className="w-36" aria-label="Assignee">
              <SelectValue placeholder="Any assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">Assigned to me</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex -space-x-2">
            {TONE_USERS.slice(0, 4).map((user) => (
              <UserAvatar key={user.id} user={user} size="sm" className="ring-2 ring-surface" />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost">
              Filter
            </Button>
            <Button size="sm" variant="contrast">
              <Plus aria-hidden="true" />
              Create task
            </Button>
          </div>
        </div>
      </Panel>

      {/*
        `flex-nowrap overflow-x-auto` because a board column is 300px and that is not
        negotiable — it is the width the cards were designed against. `Panel`'s
        default `flex-wrap` let each column escape the panel's padding box by 7px at
        375px; shrinking them to fit would have shown a column at a width no board
        ever uses. Scrolling is also what the real board will do.
      */}
      <Panel label="Board column · three cards" className="flex-nowrap items-start overflow-x-auto">
        <div className="flex w-[300px] shrink-0 flex-col gap-2 rounded-panel bg-surface-2 p-2">
          <div className="flex items-center justify-between px-1 py-1">
            <div className="flex items-center gap-2">
              <span className="text-label text-fg-muted uppercase">In progress</span>
              <Badge size="sm" variant="neutral">
                3
              </Badge>
            </div>
            <Button variant="ghost" size="icon-xs" aria-label="Add issue to In progress">
              <Plus aria-hidden="true" />
            </Button>
          </div>

          <BoardCard
            issueKeyValue={ISSUE_KEY}
            summary={LONG_SUMMARY}
            category="in_progress"
            priority="high"
            typeKey="bug"
            labels={['backend', 'needs-design']}
            assignee={ADA}
            comments={18}
            attachments={2}
          />
          <BoardCard
            issueKeyValue={ISSUE_KEY}
            summary={SHORT_SUMMARY}
            category="in_progress"
            priority={null}
            typeKey="task"
            labels={[]}
            assignee={null}
            comments={0}
            attachments={0}
          />
          <BoardCard
            issueKeyValue={ISSUE_KEY}
            summary="Assigned to someone who has left the organization"
            category="todo"
            priority="blocker"
            typeKey="story"
            labels={['regression-from-2024-q4-migration']}
            assignee={INACTIVE}
            comments={3}
            attachments={0}
          />
        </div>

        <div className="flex w-[300px] shrink-0 flex-col gap-2 rounded-panel bg-surface-2 p-2">
          <div className="flex items-center justify-between px-1 py-1">
            <div className="flex items-center gap-2">
              <span className="text-label text-fg-muted uppercase">Done</span>
              <Badge size="sm" variant="neutral">
                0
              </Badge>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-card border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="text-sm text-fg-muted">Nothing done yet</p>
            <p className="text-sm text-fg-subtle">Move a card here to close it.</p>
          </div>
        </div>
      </Panel>

      <Note>
        Compare this column against <code className="font-mono">UI Images/JIRA 3.webp</code>: the
        reference sets its issue key above the title in 10px muted uppercase and puts the assignee
        on its own line with a name beside the face. Both are surface decisions, not primitive ones,
        so they belong to whoever writes <code className="font-mono">docs/specs/web/board.md</code>{' '}
        — what is being judged here is the chip padding, the control heights and the type scale
        underneath.
      </Note>

      <Panel
        label="List row · 32px, the same rung as a table row"
        className="flex-col items-stretch"
      >
        <div className="w-full overflow-hidden rounded-card border border-border bg-surface">
          {[
            { summary: LONG_SUMMARY, category: 'in_progress' as const, user: ADA },
            { summary: SHORT_SUMMARY, category: 'todo' as const, user: null },
            {
              summary: 'Add the audit chain verification endpoint',
              category: 'done' as const,
              user: INACTIVE,
            },
          ].map((row, index) => (
            <div
              key={row.summary}
              className={`flex h-row items-center gap-3 px-3 hover:bg-surface-3 ${
                index === 0 ? '' : 'border-t border-border'
              }`}
            >
              <TypeIcon issueTypeKey="task" />
              <IssueKey issueKey={ISSUE_KEY} />
              <span className="min-w-0 flex-1 truncate text-base text-fg">{row.summary}</span>
              <StatusChip category={row.category} />
              <UserAvatar user={row.user} size="sm" />
            </div>
          ))}
        </div>
      </Panel>
    </Section>
  )
}
