import type { Bootstrap } from '@flux/contracts'
import { Search } from 'lucide-react'
import { Dialog } from 'radix-ui'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router'
import {
  compareRanked,
  compareUnqueried,
  foldText,
  highlight,
  scoreMatch,
  type MatchSpan,
} from '@/command-palette/match'
import {
  DEFAULT_PROVIDERS,
  type PaletteItem,
  type PaletteProvider,
  type PaletteSection,
} from '@/command-palette/providers'
import { useRecents } from '@/command-palette/recents'
import { useShortcuts } from '@/keyboard/use-shortcuts'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The command palette. Local-first, provider-driven, and a real combobox.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/README.md` §9: *"the primary navigation for anyone who has used
 * the app twice. It is specified in `shell.md`, not optional."*
 *
 * `docs/specs/web/shell.md` §7.1 is the design: **no network request on keystroke.**
 * The corpus is built from bootstrap, the route table, the shortcut registry and the
 * recents store — all in memory — so a keystroke costs a filter over a few hundred
 * strings and nothing else. §12 budgets that at under one frame and says where the
 * cost must not be: *"Memoize the corpus, not the query."* Which is exactly what
 * `corpus` below does — it depends on the data, not on the query, so typing never
 * rebuilds it.
 *
 * ### There is no Radix combobox, so the ARIA is ours
 *
 * §9 of the foundation spec: *"Where there is no primitive, the ARIA is yours, to
 * the same standard."* What Radix *does* supply is the dialog underneath — focus
 * trap, restore, scroll lock, portal, dismiss — and §7.3 says to use it for exactly
 * that and to *"style it, do not reimplement it."* So the modal behaviour is
 * borrowed and the combobox pattern is hand-built:
 * `combobox` → `aria-controls` → `listbox` → `option`, with
 * `aria-activedescendant` naming a real id, sections as `group`s with
 * `aria-labelledby`, and focus staying in the input the whole time.
 */

/**
 * Open state as a module store, following `components/data/toaster.tsx`.
 *
 * One subscriber (the palette, mounted once by the shell) and several writers (the
 * `⌘K` shortcut, the top bar's button, and any surface that wants to offer one).
 * A context would put every writer inside the provider and re-render the tree on
 * open; passing a setter down from the shell would thread a prop through the top
 * bar for no reason. Nine lines, and it is the pattern already in the codebase.
 */
let paletteOpen = false
const openListeners = new Set<() => void>()

function emitOpen(): void {
  for (const listener of openListeners) listener()
}

/**
 * Whatever had focus when the palette opened, so it can be given back.
 *
 * Radix's `FocusScope` restores focus to the element that *triggered* the dialog,
 * and this dialog frequently has no trigger: `⌘K` opens it from wherever the user
 * was. Measured in jsdom, that case restored focus to `<body>` — which for a
 * keyboard user means the next Tab starts from the top of the document, and
 * `docs/specs/web/README.md` §9 names losing focus to `<body>` as the failure to
 * avoid. §7.3 asks for restoration *"to the element that had it"*, which is this
 * rather than a trigger.
 */
let restoreFocusTo: HTMLElement | null = null

export function openPalette(): void {
  if (paletteOpen) return
  restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  paletteOpen = true
  emitOpen()
}

export function closePalette(): void {
  if (!paletteOpen) return
  paletteOpen = false
  emitOpen()
}

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

function getOpen(): boolean {
  return paletteOpen
}

/** Test-only: drop the open state so one file cannot leak into the next. */
export function resetPalette(): void {
  paletteOpen = false
  restoreFocusTo = null
  emitOpen()
}

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, getOpen, getOpen)
}

interface RankedItem {
  item: PaletteItem
  spans: MatchSpan[]
  /**
   * Kept beside the item rather than on it. `PaletteItem` is what a provider
   * returns and is memoized in the corpus; a score is a property of *this query*,
   * so writing it onto the item would mean copying every item on every keystroke —
   * the allocation §12 says to keep out of the hot path.
   */
  score: number
}

interface RankedSection {
  id: string
  title: string
  pending: boolean
  items: RankedItem[]
}

export interface CommandPaletteProps {
  bootstrap: Bootstrap
  /** Overridable so a test can drive one provider rather than all seven. */
  providers?: readonly PaletteProvider[] | undefined
}

export function CommandPalette({ bootstrap, providers = DEFAULT_PROVIDERS }: CommandPaletteProps) {
  const open = usePaletteOpen()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const navigate = useNavigate()
  const recents = useRecents()
  const shortcuts = useShortcuts()
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * The corpus, rebuilt only when its *data* changes — never on a keystroke.
   *
   * `query` is deliberately not a dependency even though providers receive it: the
   * only provider that reads it is the issue-key one, whose output is a single item
   * derived by a regex, and it is recomputed in `sections` below. Folding a few
   * hundred strings on every key is the cost §12 forbids.
   */
  const corpus: readonly PaletteSection[] = useMemo(
    () => providers.map((provider) => provider.build({ bootstrap, recents, shortcuts, query: '' })),
    [providers, bootstrap, recents, shortcuts],
  )

  const issueKeySection: PaletteSection | null = useMemo(() => {
    const provider = providers.find((candidate) => candidate.id === 'issue-key')
    if (provider === undefined) return null
    return provider.build({ bootstrap, recents, shortcuts, query })
  }, [providers, bootstrap, recents, shortcuts, query])

  /**
   * Filter and rank. Synchronous, and deliberately not debounced.
   *
   * §7.2: *"**Never reorder under the cursor.** Results settle before the selection
   * can move."* Debouncing the *filter* is what breaks that — the list would change
   * a beat after the keystroke, so a user who pressed `↓` in the gap activates
   * something other than what they saw. Only the announcement is debounced, below,
   * and for the opposite reason.
   */
  const sections: RankedSection[] = useMemo(() => {
    const folded = foldText(query.trim())

    const source =
      issueKeySection === null
        ? corpus
        : corpus.map((section) => (section.id === 'issue-key' ? issueKeySection : section))

    return source
      .map((section) => {
        const ranked: RankedItem[] = []
        for (const candidate of section.items) {
          /**
           * The issue-key item is never filtered. Its label is "Go to PAY-1423" and
           * the query is "PAY-1423", which is not a subsequence of it — so scoring
           * it would drop the one result the user most certainly wants.
           */
          if (section.id === 'issue-key') {
            ranked.push({ item: candidate, spans: [], score: 0 })
            continue
          }
          const match = scoreMatch(candidate.haystack, folded)
          if (match === null) continue
          ranked.push({ item: candidate, spans: match.spans, score: match.score })
        }

        const compare = folded === '' ? compareUnqueried : compareRanked
        ranked.sort((a, b) =>
          compare(
            {
              tier: a.item.tier,
              score: a.score,
              recencyIndex: a.item.recencyIndex,
              sortKey: a.item.haystack,
            },
            {
              tier: b.item.tier,
              score: b.score,
              recencyIndex: b.item.recencyIndex,
              sortKey: b.item.haystack,
            },
          ),
        )

        return { id: section.id, title: section.title, pending: section.pending, items: ranked }
      })
      .filter((section) => section.items.length > 0 || section.pending)
  }, [corpus, issueKeySection, query])

  /** The flat order the arrow keys walk, and the source of every option's id. */
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const optionId = useCallback((index: number) => `${baseId}-option-${String(index)}`, [baseId])

  /**
   * Reset the selection whenever the result set changes.
   *
   * Keyed on the identity of the first item rather than on `query`, because those
   * differ in the case that matters: typing a character that filters nothing out
   * leaves the same list, and moving the cursor back to the top there would fight
   * the user. `flat.length` catches the rest.
   */
  const firstId = flat[0]?.item.id ?? ''
  useEffect(() => {
    setActiveIndex(0)
  }, [firstId, flat.length])

  /** Clear on close, not on open — clearing on open flickers the previous query. */
  const onOpenChange = useCallback((next: boolean) => {
    if (next) openPalette()
    else {
      closePalette()
      setQuery('')
      setActiveIndex(0)
    }
  }, [])

  const activate = useCallback(
    (index: number) => {
      const chosen = flat[index]
      if (chosen === undefined) return
      const { item } = chosen

      /** Close first, so focus restoration happens before the route changes. */
      onOpenChange(false)

      if (item.to !== undefined) void navigate(item.to)
      else item.run?.()
    },
    [flat, navigate, onOpenChange],
  )

  /**
   * `↑` `↓` wrap, `Home` `End` jump, `Enter` activates, `Tab` closes.
   *
   * §7.3 specifies each, and `Tab` is the one worth reading twice: *"`Tab` closes —
   * it does not move between results."* In a combobox the options are not tab
   * stops; focus never leaves the input, which is why `aria-activedescendant`
   * exists at all. A Tab that walked the list would take focus out of the field the
   * user is typing into.
   *
   * `Escape` is deliberately absent — Radix's `DismissableLayer` owns it, which is
   * what makes the layer ordering in §7.3 correct without a stack of our own.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0 && event.key !== 'Tab') return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % flat.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + flat.length) % flat.length)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(flat.length - 1)
        break
      case 'Enter':
        event.preventDefault()
        activate(activeIndex)
        break
      case 'Tab':
        event.preventDefault()
        onOpenChange(false)
        break
      default:
        break
    }
  }

  /**
   * Scroll the active option into view *within the list*, never the page.
   *
   * `block: 'nearest'` rather than `'center'`: centring scrolls on every arrow press
   * even when the option is already visible, which reads as the list jittering under
   * the cursor. `nearest` moves only when it has to.
   */
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (list === null) return
    const active = list.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, optionId])

  const announcement = useDebouncedCount(flat.length, open)

  let runningIndex = -1

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          /**
           * Restore focus ourselves. `preventDefault` stops Radix aiming at a
           * trigger that may not exist, and the element captured at open time is
           * where the user actually was. `isConnected` because the thing that had
           * focus may have unmounted while the palette was open — a board card
           * behind a navigation, for instance — and focusing a detached node
           * silently does nothing.
           */
          onCloseAutoFocus={(event) => {
            const target = restoreFocusTo
            restoreFocusTo = null
            if (target === null || !target.isConnected) return
            event.preventDefault()
            target.focus()
          }}
          data-slot="command-palette"
          /**
           * Anchored high rather than centred. A palette that opens in the vertical
           * middle moves its own input to wherever the result count puts it; pinned
           * near the top, the field is in the same place every time, which is what
           * lets someone type through the open animation without looking.
           */
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[min(28rem,70dvh)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-pop-in"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search projects, commands and issue keys. Use the arrow keys to choose a result.
          </Dialog.Description>

          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
            <input
              autoFocus
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={`${baseId}-listbox`}
              aria-activedescendant={flat.length > 0 ? optionId(activeIndex) : undefined}
              aria-label="Search projects, commands and issue keys"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              onKeyDown={onKeyDown}
              placeholder="Jump to a project, run a command, or type an issue key"
              /**
               * No `focus-visible:outline-none`, which a search input inside a panel
               * invites. ../design/palette.test.ts rejects it across `src/` and is
               * right to: utilities sit in a later cascade layer than the
               * `:focus-visible` rule in `@layer base`, so it beats that rule rather
               * than losing to it. This input holds focus for the palette's entire
               * lifetime — clicking a result `preventDefault`s precisely to keep it
               * here — so it is the one element a keyboard user most needs to see.
               */
              className="h-11 w-full min-w-0 rounded-control bg-transparent text-md text-fg placeholder:text-fg-subtle"
            />
          </div>

          {/**
           * §7.3: *"Result count announced on a debounced `aria-live="polite"`
           * region. Debounced, or a screen reader reads every intermediate count
           * while the user types."*
           */}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <p className="px-3 py-8 text-center text-base text-fg-muted">
                {query.trim() === ''
                  ? 'Start typing to search projects, commands and issues.'
                  : `Nothing matches “${query.trim()}”.`}
              </p>
            ) : (
              <div id={`${baseId}-listbox`} role="listbox" aria-label="Results">
                {sections.map((section) => (
                  <div
                    key={section.id}
                    role="group"
                    aria-labelledby={`${baseId}-group-${section.id}`}
                    className="pb-1 last:pb-0"
                  >
                    <p
                      id={`${baseId}-group-${section.id}`}
                      className="px-2 pt-2 pb-1 text-2xs text-fg-subtle uppercase"
                    >
                      {section.title}
                    </p>
                    {section.items.map((ranked) => {
                      runningIndex += 1
                      const index = runningIndex
                      return (
                        <Option
                          key={ranked.item.id}
                          id={optionId(index)}
                          ranked={ranked}
                          active={index === activeIndex}
                          onHover={() => {
                            setActiveIndex(index)
                          }}
                          onSelect={() => {
                            activate(index)
                          }}
                        />
                      )
                    })}
                    {/**
                     * §7.5's affordance, in the section rather than over the list.
                     * No provider sets `pending` today; the branch exists so
                     * `search.md` has somewhere to put it.
                     */}
                    {section.pending && (
                      <p className="px-2 py-1.5 text-sm text-fg-subtle">Searching…</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface OptionProps {
  id: string
  ranked: RankedItem
  active: boolean
  onHover: () => void
  onSelect: () => void
}

/**
 * A `<button>` carrying `role="option"`.
 *
 * The role is what assistive technology reads — this is an option inside the
 * listbox the input's `aria-activedescendant` points into — and the element is a
 * button because that is what supplies pointer and key activation natively. The
 * alternative, a `<div role="option" onClick>`, is the shape `jsx-a11y`'s
 * `click-events-have-key-events` rejects, and it is right to: on a plain div the
 * click handler genuinely is the only way in.
 *
 * It reasons per element, though, and in this pattern the keyboard handling
 * legitimately lives somewhere else — on the combobox input, because focus never
 * leaves it. Using a real button satisfies the rule *and* the pattern rather than
 * silencing one for the other, which is why there is no inline disable here.
 *
 * `tabIndex={-1}` is the part that keeps it a combobox: an option must not be a tab
 * stop, or Tab would walk the results instead of closing the palette (§7.3).
 * `onMouseDown` with `preventDefault` keeps the input focused when a row is
 * clicked, so a mouse user does not blur the field and lose the caret.
 */
function Option({ id, ranked, active, onHover, onSelect }: OptionProps) {
  const Icon = ranked.item.icon
  const runs = highlight(ranked.item.label, ranked.spans)

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      /**
       * Programmatically focusable, never a tab stop, and never actually focused.
       *
       * The combobox pattern keeps focus in the input and points at the current row
       * with `aria-activedescendant`, so an option must not be tabbable. `-1` is
       * the form that says exactly that, and it is what lets `jsx-a11y` see the row
       * as the interactive element it is — the rule reasons per element and cannot
       * see that this row's keyboard handling lives on the input.
       */
      tabIndex={-1}
      onMouseMove={onHover}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full cursor-default items-center gap-2 rounded-control px-2 text-left text-base',
        active ? 'bg-surface-3 text-fg' : 'text-fg-muted',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1 truncate">
        {runs.map((run, index) =>
          run.matched ? (
            /**
             * The matched characters, in the brand accent and heavier. §7.2: *"A
             * fuzzy match the user cannot see the logic of reads as a random result
             * list."*
             */
            <span key={`${id}-run-${String(index)}`} className="font-semibold text-primary-accent">
              {run.text}
            </span>
          ) : (
            <span key={`${id}-run-${String(index)}`}>{run.text}</span>
          ),
        )}
      </span>
      {ranked.item.detail !== undefined && (
        <span className="shrink-0 font-mono text-2xs text-fg-subtle">{ranked.item.detail}</span>
      )}
    </button>
  )
}

/**
 * The result count, settled.
 *
 * 250ms after the last keystroke. A live region that updates per character makes a
 * screen reader read "forty results, twelve results, three results" over the top of
 * the user's own typing, which is worse than silence — and §7.3 calls for exactly
 * this debounce.
 */
function useDebouncedCount(count: number, open: boolean): string {
  const [settled, setSettled] = useState('')

  useEffect(() => {
    if (!open) {
      setSettled('')
      return
    }
    const timer = setTimeout(() => {
      setSettled(count === 1 ? '1 result' : `${String(count)} results`)
    }, 250)
    return () => {
      clearTimeout(timer)
    }
  }, [count, open])

  return settled
}
