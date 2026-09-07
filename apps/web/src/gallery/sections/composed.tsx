import { aBoardView } from '@flux/mocks'
import { Plus } from 'lucide-react'
import { BoardColumn } from '@/components/board/board-column'
import { IssueKey } from '@/components/data/issue-key'
import { StatusChip } from '@/components/data/status-chip'
import { TypeIcon } from '@/components/data/type-icon'
import { UserAvatar } from '@/components/data/user-avatar'
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
 * Built once at module scope, not per render.
 *
 * `aBoardView()` `.parse()`s the whole view through `BoardViewSchema` — that is the
 * point of the builder — and doing it inside the component body would re-parse a
 * ~30-card payload on every theme toggle. It is also what makes the identity
 * stable, so React's reconciler is not handed a new `cards` array each time.
 */
const BOARD_VIEW = aBoardView()

/**
 * Two columns drawn with their cards, and a third drawn without any.
 *
 * The empty one is a **real fixture column** rather than an object built here.
 * Spreading one to change its name was the first attempt and it does not even
 * typecheck — a spread widens the required members of an inferred object type back
 * to optional — but the reason to write it this way is not the compiler. A column
 * assembled in the gallery is a second definition of a contract type, and the whole
 * point of this panel is that it renders nothing of its own.
 *
 * Asserted rather than defaulted: a silent fallback would draw an invented column,
 * and the page's claim is that it shows the real thing. The assertion is inside a
 * function rather than beside the constants because `noUncheckedIndexedAccess`
 * narrowing does not survive into a component body — a module-scope `if` would
 * typecheck here and fail at the JSX.
 */
function columnAt(index: number) {
  const column = BOARD_VIEW.board.columns[index]
  if (column === undefined) {
    throw new Error(
      `gallery: aBoardView() has no column ${String(index)}; the board panel draws two filled and one empty`,
    )
  }
  return column
}

const FILLED_COLUMNS = [columnAt(0), columnAt(1)]
const EMPTY_COLUMN = columnAt(2)

/**
 * The primitives assembled into the shapes they actually appear in.
 *
 * ### It renders shipped components now, and it used to render specimens
 *
 * The paragraph that stood here said this section *"builds nothing reusable and
 * exports no component"*, because a shared issue card belonged to the board surface
 * and to the session that owned `routes/`. That boundary is gone: `components/board/`
 * exists and one agent owns it, this file, and the measurement they are both built
 * from. So the board panel below renders `BoardColumn` on `@flux/mocks` fixtures
 * rather than a look-alike, and the look-alike is deleted rather than kept in step.
 *
 * The remaining panels are still assemblies rather than components, and deliberately:
 * a filter bar and a list row are shapes the product composes from primitives at
 * three different surfaces, so there is nothing single to import.
 *
 * What the section is for has not changed: the thing a specimen grid cannot show,
 * **density in aggregate.** A chip judged on its own always looks fine. Two of them
 * on a 308px card, six times down a column, is where one extra pixel of padding
 * becomes a card that fits five rows instead of six.
 */

export function ComposedSection() {
  return (
    <Section
      id="composed"
      title="Composed"
      note="The primitives in the shapes they actually ship in. The board panel is the shipped BoardColumn on @flux/mocks fixtures, so it cannot drift from the board; the filter bar and the list row are assemblies with nothing single to import. Density only shows up in aggregate, which is what this section is for."
    >
      <Panel
        label="Filter bar · one baseline across five components"
        className="flex-col items-stretch"
      >
        {/*
          `min-h-12`, and it used to be `min-h-subbar`. That token is no longer a
          plausible height for a row of primitives: `--spacing-subbar` is the board
          toolbar's measured 101px band — 38px of clear space above a 40px chip and
          22px below — which `components/board/board-toolbar.tsx` derives from the
          references. Borrowing it here would have drawn a 101px specimen to make a
          point about 48px density.

          `min-h-`, not `h-`, for the reason that outlived the token: a fixed height
          and `flex-wrap` cannot both hold. Measured at 375px, the box stayed 46px
          while its children reached 155px, so the search input and the avatar stack
          rendered *outside* the bar and on top of the next panel. At any width where
          the row fits it is still exactly 48px, which is where the baseline the panel
          is about actually lives.
        */}
        <div className="flex min-h-12 w-full flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-3">
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
        The **real** `BoardColumn`, on the **real** fixtures — not a specimen.

        This panel used to hold a hand-rolled `BoardCard` and a hand-rolled column
        header, and its own comment explained why: a shared card belonged to the board
        surface and to the session that owned `routes/`, so building one here would have
        been a second definition for that session to collide with. Both halves of that
        are now false. `components/board/` exists, and one agent owns it and this file.

        A second definition would now be strictly worse than none: the specimen's column
        was `w-[300px]` on a `bg-surface-2` fill with a `rounded-panel`, and the
        measurement says 308px with **no fill at all** — so the gallery would have gone
        on showing the geometry the board just stopped using, which is precisely the
        regression this page exists to catch. Rendering the shipped component against
        `@flux/mocks` means it cannot drift from the board by construction.

        `flex-nowrap overflow-x-auto` because a column is 308px and that is not
        negotiable — it is the width the cards are measured against. `Panel`'s default
        `flex-wrap` let each column escape the padding box at 375px; shrinking them to
        fit would show a column at a width no board ever uses.
      */}
      <Panel
        label="Board columns · the shipped component on mock fixtures"
        className="flex-nowrap items-start overflow-x-auto bg-canvas"
      >
        {FILLED_COLUMNS.map((column) => {
          const slice = BOARD_VIEW.columns.find((entry) => entry.columnId === column.id)
          return (
            <BoardColumn
              key={column.id}
              column={column}
              cards={slice?.cards ?? []}
              totalCount={slice?.totalCount ?? 0}
            />
          )
        })}
        {/*
          The empty column, and it is a real fixture column drawn with no cards rather
          than a hand-built one. `anEmptyBoardView()` empties every column at once, and
          an empty column *beside* a full one is the comparison worth having — §11: an
          empty state is designed, not defaulted.
        */}
        <BoardColumn column={EMPTY_COLUMN} cards={[]} totalCount={0} />
      </Panel>

      <Note>
        The two columns above are{' '}
        <code className="font-mono">components/board/board-column.tsx</code> rendering{' '}
        <code className="font-mono">aBoardView()</code>, so what is on this page is what is on the
        board. The card is measured against <code className="font-mono">UI Images/JIRA 1.webp</code>{' '}
        at 308×255 with a 20px pad; its own header carries the boundary-by-boundary arithmetic. Two
        things here are deliberately <em>not</em> the reference: the label pill&rsquo;s dark-theme
        fill stays saturated where the reference goes pastel, and the type, key, priority, estimate
        and blocked count have no equivalent in it at all — they live in the two bands the reference
        leaves empty, beside the kebab and beside the avatar, so they cost the card no height. Both
        are noted at their call sites with the reason.
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
