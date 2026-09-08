import type { Bootstrap } from '@flux/contracts'
import { Building2, EllipsisVertical, FolderKanban, Link2, Plus, Star } from 'lucide-react'
import { useCallback } from 'react'
import { Link, useMatch } from 'react-router'
import { toast } from '@/components/data/toaster'
import { PaletteAction } from '@/components/palette-action'
import { ProjectGlyph } from '@/components/project-glyph'
import {
  SurfaceHeader,
  SurfaceHeaderCrumbs,
  type SurfaceHeaderCrumb,
  type SurfaceHeaderTab,
} from '@/components/surface-header'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProjectSummary } from '@/lib/bootstrap'
import { paths, ROUTE_PATTERNS } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The header every project surface shares: board, backlog, settings.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `./surface-header.tsx` owns the geometry — the six derived vertical steps, the
 * type scale, the optical alignment of the two right-hand clusters. This file owns
 * what goes in it for a project, and it exists so the three project surfaces cannot
 * drift: a tab row that is one item longer on Settings than on Board, or a
 * breadcrumb that changes shape between them, is the kind of inconsistency nobody
 * reports and everybody feels.
 *
 * ### Every control here is real, or says why it is not
 *
 * `docs/product-quality-bar.md` §13: *"a control that silently does nothing is worse
 * than one that says why it cannot."* Four controls, and each is one of those two:
 *
 * | Control | State |
 * | --- | --- |
 * | Magnifier | **Real** — opens the command palette, and carries the chord |
 * | Star | **Shows real state, cannot change it.** `isFavourite` is in the contract; no mutation is |
 * | Kebab | **Real** — copies the board's link, and links to project settings |
 * | `＋` beside the avatars | **Disabled with a reason** — `Bootstrap` carries no member list |
 *
 * The star is the interesting one. It is not decoration and it is not dead: the
 * filled/outlined state is `project.isFavourite`, which is the same value the
 * sidebar groups by, so it tells the truth about something the user has already set
 * elsewhere. What it cannot do is *change* it, and it says so rather than being
 * omitted — a favourite marker missing from the surface you spend the day on reads
 * as a product that forgot, where a dimmed one with an explanation reads as a
 * product that is honest about its edges.
 *
 * ### Three tabs, not the references' five
 *
 * `UI Images/` draws Discussion / Tasks / Timeline / Files / Overview. Four of those
 * are surfaces flux does not have, and a tab is the worst possible place to put a
 * dead control — it *looks* like navigation in a way a dimmed button does not. So
 * the row carries the three project routes that exist, and the divergence is
 * recorded here rather than papered over with inert tabs.
 *
 * ### The avatar stack is teams, not people
 *
 * `BootstrapSchema` carries `teams` and the signed-in `user`, and no member list —
 * so the stack shows the organization's teams by key. Inventing three faces to match
 * the reference's three would be the same lie as an inert tab, one layer quieter.
 * A change request covers the members endpoint; when it lands, this becomes people
 * and the `＋` becomes an invite.
 */

export interface ProjectHeaderProps {
  bootstrap: Bootstrap
  project: ProjectSummary
}

export function ProjectHeader({ bootstrap, project }: ProjectHeaderProps) {
  /**
   * `useMatch` per tab rather than `isWithin`, and the difference is not cosmetic.
   * `isWithin` compares literal strings, and `ROUTE_PATTERNS.board` is
   * `/projects/:projectKey/board` — a pattern, which no real pathname is ever a
   * prefix of, so every tab would have read as inactive. `useMatch` runs the router's
   * own matcher, which also makes the comparison case-insensitive: `/projects/log/board`
   * resolves in the router and would have missed a `===` against the canonical key.
   */
  const onBoard = useMatch(ROUTE_PATTERNS.board) !== null
  const onBacklog = useMatch(ROUTE_PATTERNS.backlog) !== null
  const onSettings = useMatch(ROUTE_PATTERNS.projectSettings) !== null

  const crumbs: readonly SurfaceHeaderCrumb[] = [
    /**
     * The organization is context, not a destination — flux has no organization
     * surface — so it is text with no `to`. A crumb that is not a link is not a dead
     * control; it is the same thing the row's first segment has always been.
     */
    {
      label: bootstrap.organization.name,
      icon: <Building2 aria-hidden="true" className="size-3.25 text-fg-subtle" />,
    },
    {
      label: 'Projects',
      to: paths.projects(),
      icon: <FolderKanban aria-hidden="true" className="size-3.25 text-fg-subtle" />,
    },
    /**
     * The **key**, not the name, and not a repeat of the `h1`. It is what the user
     * types into the palette and what they will see on every issue in the project,
     * and it is the one identifier the title above deliberately does not show.
     *
     * `size="xs" tone="muted"`: the references draw every crumb's mark as a 13px
     * outline in the trail's own grey, not in the project's hue — a trail is a path,
     * and the hue belongs to the title glyph above it, where the project is the
     * subject rather than a step.
     */
    { label: project.key, icon: <ProjectGlyph project={project} size="xs" tone="muted" /> },
  ]

  const tabs: readonly SurfaceHeaderTab[] = [
    { to: paths.board(project.key), label: 'Board', active: onBoard },
    { to: paths.backlog(project.key), label: 'Backlog', active: onBacklog },
    { to: paths.projectSettings(project.key), label: 'Settings', active: onSettings },
  ]

  return (
    <SurfaceHeader
      lead={<ProjectGlyph project={project} size="md" />}
      title={project.name}
      breadcrumb={<SurfaceHeaderCrumbs items={crumbs} />}
      actions={
        <>
          <PaletteAction />
          <FavouriteAction project={project} />
          <ProjectMenu project={project} />
        </>
      }
      tabs={tabs}
      tabsLabel={`${project.name} views`}
      tabsAside={<TeamCluster bootstrap={bootstrap} />}
    />
  )
}

/**
 * The star: real state, no mutation, and it says which.
 *
 * `aria-disabled` rather than `disabled`, for the reason `./new-project-button.tsx`
 * sets out at length — a genuinely `disabled` button receives no pointer events, so
 * the tooltip explaining why it cannot be used would never open for the one control
 * that needs the explanation. `aria-disabled` keeps the button focusable and hoverable
 * and announced as unavailable, and axe's `color-contrast` rule skips
 * `aria-disabled="true"` nodes, so the dimming is exempt under SC 1.4.3 exactly as a
 * native `disabled` would be.
 *
 * `aria-pressed` carries the state, so the fill is not the only signal — a filled star
 * and an outlined one at 24px is a shape difference someone may well miss, and colour
 * alone would be worse.
 *
 * It is **not dimmed**, and it was. The references draw all three header glyphs in
 * the brightest ink on the screen, and a star at 50% beside a magnifier and a kebab
 * at full strength read as a broken control rather than an honest one. The same trade
 * `board/board-toolbar.tsx` makes: the unavailability is carried by `aria-disabled`,
 * by `cursor-not-allowed` at the moment of reaching for it, and by the tooltip that
 * says why — three signals that cost no pixels — rather than by a fourth that costs
 * the one landmark this cluster is measured by.
 */
function FavouriteAction({ project }: { project: ProjectSummary }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-disabled="true"
          aria-pressed={project.isFavourite}
          aria-label={project.isFavourite ? 'In your favourites' : 'Not in your favourites'}
          onClick={(event) => {
            event.preventDefault()
          }}
          className="text-fg aria-disabled:cursor-not-allowed [&_svg]:size-6"
        >
          <Star
            aria-hidden="true"
            strokeWidth={1.5}
            /**
             * `fill-current` inherits the stroke colour rather than naming a second
             * one, so a favourite reads as a solid star in whichever state the button
             * is in — including the 50% opacity this one is always in.
             */
            className={project.isFavourite ? 'fill-current' : undefined}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {project.isFavourite
          ? 'This project is one of your favourites. Changing that is not available yet.'
          : 'Adding a project to your favourites is not available yet.'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The kebab: two real actions.
 *
 * No tooltip on the trigger, matching `./shell/theme-menu.tsx` — Radix's tooltip and
 * its dropdown both own the trigger's hover and focus, and composing them leaves the
 * tooltip open behind the menu it describes. The `aria-label` is the accessible name
 * either way, since a tooltip is a description and never a name.
 */
function ProjectMenu({ project }: { project: ProjectSummary }) {
  const copyLink = useCopyBoardLink(project.key)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${project.name}`}
          className="text-fg [&_svg]:size-6"
        >
          <EllipsisVertical aria-hidden="true" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={copyLink}>
          <Link2 aria-hidden="true" />
          Copy link to board
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={paths.projectSettings(project.key)}>Project settings</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Copy the board's absolute URL, and report every way that can fail.
 *
 * Three outcomes, three messages. `navigator.clipboard` is **absent** outside a
 * secure context — which is not hypothetical, it is what happens the first time
 * someone opens a dev build over plain `http://` on another machine on the LAN — and
 * `writeText` **rejects** when a browser withholds the permission. The DOM types
 * declare `clipboard` as always present, so the widening below is deliberate rather
 * than defensive noise: the type is wrong about the platform, and the branch it
 * enables is the difference between a menu item that explains itself and one that
 * appears to work and does not.
 *
 * §13 again: never *"Something went wrong"* when the cause is known. The failure copy
 * names the cause and gives the fallback, which is the address bar.
 */
function useCopyBoardLink(projectKey: string) {
  return useCallback(() => {
    const url = new URL(paths.board(projectKey), window.location.origin).toString()
    const clipboard: Clipboard | undefined = navigator.clipboard

    if (clipboard === undefined) {
      toast({
        tone: 'danger',
        title: 'Could not copy the link',
        description:
          'This browser only allows copying on a secure connection. The link is in the address bar.',
      })
      return
    }

    void clipboard.writeText(url).then(
      () => {
        toast({ tone: 'success', title: 'Link copied', description: url })
      },
      () => {
        toast({
          tone: 'danger',
          title: 'Could not copy the link',
          description:
            'The browser refused access to the clipboard. The link is in the address bar.',
        })
      },
    )
  }, [projectKey])
}

/**
 * The stack, the hairline and the `＋` — the references' tabs-row right cluster.
 *
 * The arithmetic is exact rather than approximate, which is worth writing down
 * because two of the three numbers come from primitives that ship different
 * defaults. `Avatar size="lg"` is 40px and `AvatarGroup` adds `ring-2`, so the outer
 * box is 44px — the references' measured 44. `AvatarGroup`'s own `-space-x-2` is an
 * 8px overlap and the references' step is 28px, so this passes `-space-x-3`:
 * 40 + 3 × 28 = 124, plus a ring at each end = **128**, against a measured 128.
 *
 * The ring is `ring-panel` and not the primitive's `ring-surface`. The ring is a
 * cut-out that has to match what is behind the stack, and `--panel` and `--surface`
 * are different colours in dark — leaving the default would draw a 2px card-coloured
 * halo around every face.
 *
 * `AvatarGroupCount` is `bg-fg text-panel`, which is measured and *inverts*: the
 * references' counter is a near-black disc with white type in light and a near-white
 * disc with dark type in dark. `--fg` over `--panel` is exactly that pair, in both
 * themes, at the maximum contrast the palette has.
 */
function TeamCluster({ bootstrap }: { bootstrap: Bootstrap }) {
  const { teams } = bootstrap
  const shown = teams.slice(0, 3)
  const hidden = teams.length - shown.length

  return (
    <>
      {shown.length > 0 && (
        <AvatarGroup
          /**
           * A stack of keys standing in for a list of teams is unreadable to a screen
           * reader, so the group is labelled with the count and the primitive
           * deliberately sets no `role` of its own.
           */
          aria-label={`${String(teams.length)} ${teams.length === 1 ? 'team' : 'teams'} in this organization`}
          className="-space-x-3 *:data-[slot=avatar]:ring-panel"
        >
          {shown.map((team) => (
            <Avatar key={team.id} size="lg" title={team.name}>
              <AvatarFallback>{team.key.slice(0, 2).toLocaleUpperCase()}</AvatarFallback>
            </Avatar>
          ))}
          {hidden > 0 && (
            <AvatarGroupCount className="bg-fg text-panel ring-panel">+{hidden}</AvatarGroupCount>
          )}
        </AvatarGroup>
      )}

      {/**
       * The hairline: 1px wide, 43px tall, `--border`. Measured at x 1314..1315,
       * y 142..184, and it is `aria-hidden` because it separates two clusters
       * visually and says nothing.
       */}
      <span aria-hidden="true" className="h-10.75 w-px shrink-0 bg-border" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-disabled="true"
            aria-label="Add someone to this project"
            onClick={(event) => {
              event.preventDefault()
            }}
            /**
             * 42px and circular with a 1px `--border` outline — measured at x
             * 1327..1368, y 143..183. `size-10.5` overrides `size="icon"`'s 36px
             * because this is the one control in the header the references draw with a
             * visible boundary, and the boundary is what makes its box the optical
             * edge the cluster aligns to.
             *
             * Full strength, not `opacity-50`, for the reason `FavouriteAction` gives:
             * the reference's `+` is its brightest ink, and a dimmed disc beside a
             * full-strength avatar stack reads as broken rather than as unavailable.
             */
            className="size-10.5 rounded-chip border border-border text-fg aria-disabled:cursor-not-allowed [&_svg]:size-5"
          >
            <Plus aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Inviting people is not available yet — flux cannot list a project&rsquo;s members.
        </TooltipContent>
      </Tooltip>
    </>
  )
}
