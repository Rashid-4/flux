import type { Bootstrap } from '@flux/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { CommandPalette, openPalette } from '@/command-palette/command-palette'
import { scopeRecents, useRecentsStore } from '@/command-palette/recents'
import { ShortcutSheet } from '@/keyboard/shortcut-sheet'
import { useShortcut, useShortcutListener } from '@/keyboard/use-shortcuts'
import { paths, ROUTE_PATTERNS } from '@/lib/paths'
import { useToggleSidebar } from '@/stores/chrome'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The shell's own shortcuts, and the layers they open.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §6 lists the baseline set for this surface. Every one
 * of them is registered here, in one component, for the reason §6 gives about
 * scoping: a shortcut lives as long as the component that registers it, and these
 * are the ones that must work everywhere, so they belong to the shell rather than
 * to any surface inside it.
 *
 * Surface-specific shortcuts are *not* here. The board registers its own when it
 * mounts and they leave with it — that is the whole scoping model, and adding a
 * board shortcut to this file would make it fire on the admin page.
 *
 * ### Why this is a component and not a hook called from `routes/shell.tsx`
 *
 * It renders the layers. `?` has to open something, and the thing it opens has to
 * be mounted somewhere; putting the sheet's state next to the shortcut that opens
 * it means neither can exist without the other. A hook would return `open` and
 * `setOpen` for the shell to thread into JSX, which is the same code with an extra
 * hop and one more place to forget.
 */

export interface ShellKeyboardProps {
  bootstrap: Bootstrap
}

export function ShellKeyboard({ bootstrap }: ShellKeyboardProps) {
  const navigate = useNavigate()
  const toggleSidebar = useToggleSidebar()
  const [sheetOpen, setSheetOpen] = useState(false)

  /**
   * The project the user is inside, from the route.
   *
   * `g b` and `g l` are the only shortcuts in the baseline set that need context,
   * and §6 scopes them: *"board / backlog of the current project, **when in one**"*.
   * Outside a project they are registered but disabled, which is deliberate — they
   * stay in the `?` sheet so the user learns they exist, and pressing them does
   * nothing rather than guessing a project.
   */
  const boardMatch = useMatch(ROUTE_PATTERNS.board)
  const backlogMatch = useMatch(ROUTE_PATTERNS.backlog)
  const settingsMatch = useMatch(ROUTE_PATTERNS.projectSettings)
  const projectKey =
    boardMatch?.params['projectKey'] ??
    backlogMatch?.params['projectKey'] ??
    settingsMatch?.params['projectKey'] ??
    null

  useShortcutListener()

  /**
   * Scope the recents list to this person in this organization.
   *
   * §7.4: *"Recents are **per user and per org**. Someone who switches org must not
   * see the previous org's issue keys — that is a small information leak and it
   * looks like a bug even when nothing leaked."* Set here because this is the first
   * component inside the bootstrap gate that has both ids, and re-set on change so
   * an org switch replaces the list rather than merging it.
   */
  const setRecentsScope = useRecentsStore((state) => state.setScope)
  const scope = scopeRecents(bootstrap.user.id, bootstrap.organization.id)
  useEffect(() => {
    setRecentsScope(scope)
  }, [setRecentsScope, scope])

  /**
   * On an organization switch, drop every cached server query.
   *
   * §11: *"Org switch | every server-state query invalidated. Cached data from the
   * previous org must be unreachable, not **merely unrendered**."* The emphasis is
   * the requirement: an invalidated query still holds its previous data and serves
   * it while refetching, so a board from the old organization would paint for a
   * frame in the new one. `removeQueries` deletes the entries instead, which is why
   * it is that call and not `invalidateQueries`.
   *
   * `bootstrap` itself is excluded — it is the query that just told us the org
   * changed, and removing it would restart the gate and loop.
   *
   * There is no way to switch organizations yet
   * (`docs/change-requests/003-organization-selection-mechanism.md`), so this cannot
   * fire today. It is here because the alternative is remembering to add it at the
   * moment the switcher is wired, which is the moment least likely to be thinking
   * about a stale cache.
   */
  const queryClient = useQueryClient()
  const organizationId = bootstrap.organization.id
  const previousOrganization = useRef(organizationId)
  useEffect(() => {
    if (previousOrganization.current === organizationId) return
    previousOrganization.current = organizationId
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'bootstrap',
    })
  }, [organizationId, queryClient])

  useShortcut({
    id: 'shell.palette',
    binding: [{ key: 'k', mod: true }],
    description: 'Open the command palette',
    group: 'Global',
    /**
     * One of the two chords §6 permits inside a text field. Someone filtering the
     * sidebar who reaches for the palette means the palette, not the letter k.
     */
    global: true,
    run: openPalette,
  })

  useShortcut({
    id: 'shell.help',
    binding: [{ key: '?' }],
    description: 'Show keyboard shortcuts',
    group: 'Global',
    run: () => {
      setSheetOpen(true)
    },
  })

  /**
   * `Escape` is documented, not handled. §7.3 wants it to close the topmost layer in
   * a defined order, and Radix's `DismissableLayer` already maintains that stack —
   * including nesting, and including layers this registry never sees. Registering a
   * handler here would either duplicate that stack or fight it.
   */
  useShortcut({
    id: 'shell.escape',
    binding: [{ key: 'Escape' }],
    description: 'Close the topmost dialog, drawer or menu',
    group: 'Global',
    global: true,
    implementedBy: 'Radix DismissableLayer, which owns the layer stack',
  })

  useShortcut({
    id: 'shell.toggle-sidebar',
    binding: [{ key: '[' }],
    description: 'Toggle the project sidebar',
    group: 'View',
    run: toggleSidebar,
  })

  useShortcut({
    id: 'shell.goto-projects',
    binding: [{ key: 'g' }, { key: 'p' }],
    description: 'Go to projects',
    group: 'Navigation',
    run: () => {
      void navigate(paths.projects())
    },
  })

  useShortcut({
    id: 'shell.goto-search',
    binding: [{ key: 'g' }, { key: 's' }],
    description: 'Go to search',
    group: 'Navigation',
    run: () => {
      void navigate(paths.search())
    },
  })

  useShortcut({
    id: 'shell.goto-reports',
    binding: [{ key: 'g' }, { key: 'r' }],
    description: 'Go to reports',
    group: 'Navigation',
    /**
     * Reports is not permission-gated in `orgPermissions`, unlike Import and
     * Administration — the rail shows it to everyone, so the shortcut matches the
     * rail rather than inventing a rule the navigation does not have.
     */
    run: () => {
      void navigate(paths.reports())
    },
  })

  useShortcut({
    id: 'shell.goto-board',
    binding: [{ key: 'g' }, { key: 'b' }],
    description: 'Go to the current project’s board',
    group: 'Project',
    enabled: projectKey !== null,
    run: () => {
      if (projectKey !== null) void navigate(paths.board(projectKey))
    },
  })

  useShortcut({
    id: 'shell.goto-backlog',
    binding: [{ key: 'g' }, { key: 'l' }],
    description: 'Go to the current project’s backlog',
    group: 'Project',
    enabled: projectKey !== null,
    run: () => {
      if (projectKey !== null) void navigate(paths.backlog(projectKey))
    },
  })

  return (
    <>
      <CommandPalette bootstrap={bootstrap} />
      <ShortcutSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  )
}
