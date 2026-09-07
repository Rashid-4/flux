import { Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatBinding } from '@/keyboard/keys'
import { isHandled, type Shortcut } from '@/keyboard/registry'
import { useShortcutSections } from '@/keyboard/use-shortcuts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The `?` sheet — a projection of the registry, never a second list.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §8: *"Its content is a projection of registry state —
 * **if you find yourself typing a shortcut's name into JSX, the registry is missing
 * a field.**"* There is no array of shortcuts in this file. Every string on screen
 * comes from `useShortcutSections()`, which reads the live registry, so a shortcut
 * that exists is listed and a shortcut that is listed exists.
 *
 * §9 of the foundation spec is what makes that non-negotiable: *"a hand-maintained
 * help dialog is wrong within a month."* The failure is not that the dialog is
 * incomplete — it is that it is confidently incorrect, telling a user to press a key
 * that does nothing.
 *
 * ### It is searchable, and the search is over descriptions and keys both
 *
 * Someone who knows what they want types "board"; someone who half-remembers a
 * chord types "g". Matching only descriptions would fail the second, and a help
 * dialog you cannot search is a list of forty rows that people close.
 */

export interface ShortcutSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutSheet({ open, onOpenChange }: ShortcutSheetProps) {
  const [query, setQuery] = useState('')
  const sections = useShortcutSections()
  const filterId = useId()

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return sections
    return sections
      .map((section) => ({
        group: section.group,
        shortcuts: section.shortcuts.filter((shortcut) => matches(shortcut, needle)),
      }))
      .filter((section) => section.shortcuts.length > 0)
  }, [sections, query])

  const total = filtered.reduce((sum, section) => sum + section.shortcuts.length, 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        /**
         * Clear the filter on close rather than on open. Clearing on open would
         * happen while the dialog is animating in, which is a visible flicker of the
         * previous query; clearing on close means the sheet always opens showing
         * everything, which is what someone pressing `?` expects.
         */
        if (!next) setQuery('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[min(40rem,calc(100dvh-4rem))] w-[calc(100%-2rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are suppressed while you are typing, except the command palette and Escape.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <label htmlFor={filterId} className="sr-only">
            Filter shortcuts
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            id={filterId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Filter shortcuts"
            autoComplete="off"
            spellCheck={false}
            className="bg-surface-2 pl-7.5"
          />
        </div>

        {/**
         * `aria-live="polite"` on the count, so a screen-reader user filtering the
         * list is told how many rows remain rather than having to explore for it.
         * Not debounced here, unlike the palette's: this list is at most a few dozen
         * rows and the filter is not the primary interaction, so the announcement
         * settles with the typing.
         */}
        <p aria-live="polite" className="sr-only">
          {total === 1 ? '1 shortcut' : `${String(total)} shortcuts`}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-1 py-6 text-center text-base text-fg-muted">
              No shortcuts match “{query.trim()}”.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {filtered.map((section) => (
                <section key={section.group} aria-labelledby={`${filterId}-${section.group}`}>
                  <h3
                    id={`${filterId}-${section.group}`}
                    className="mb-1 px-1 text-label text-fg-subtle uppercase"
                  >
                    {section.group}
                  </h3>
                  {/**
                   * A description list, because that is what this is: a term (the
                   * keys) and its description. `<dl>` gives a screen reader the
                   * pairing for free, where a table of two columns would need
                   * headers to say the same thing.
                   */}
                  <dl className="flex flex-col">
                    {section.shortcuts.map((shortcut) => (
                      <ShortcutRow key={shortcut.id} shortcut={shortcut} />
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function matches(shortcut: Shortcut, needle: string): boolean {
  if (shortcut.description.toLocaleLowerCase().includes(needle)) return true
  if (shortcut.group.toLocaleLowerCase().includes(needle)) return true
  return formatBinding(shortcut.binding).join(' ').toLocaleLowerCase().includes(needle)
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  const chords = formatBinding(shortcut.binding)

  return (
    <div className="flex h-row items-center justify-between gap-4 rounded-control px-1 hover:bg-surface-3">
      <dt className="min-w-0 truncate text-base text-fg">{shortcut.description}</dt>
      <dd className="flex shrink-0 items-center gap-1">
        {chords.map((chord, index) => (
          <span key={`${shortcut.id}-${chord}`} className="flex items-center gap-1">
            {/**
             * "then" between the chords of a sequence, spelled out rather than shown
             * as a `+`. `g` `+` `b` says press them together, which is a different
             * and wrong instruction — and the whole reason the registry models
             * sequences separately from chords.
             */}
            {index > 0 && <span className="text-2xs text-fg-subtle">then</span>}
            <kbd className="flex h-5 min-w-5 items-center justify-center rounded-control border border-border-strong bg-surface-2 px-1.5 font-sans text-2xs text-fg-muted">
              {chord}
            </kbd>
          </span>
        ))}
        {/**
         * A documented-only shortcut is real — `Escape` is implemented by Radix's
         * layer stack — so it is listed without qualification. The distinction is
         * recorded in the registry for whoever goes looking, and is not something a
         * user needs to see; a "handled elsewhere" badge here would be the codebase
         * talking to itself in the product's UI.
         */}
        {!isHandled(shortcut) && <span className="sr-only">Built in</span>}
      </dd>
    </div>
  )
}
