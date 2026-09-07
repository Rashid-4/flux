import { SEQUENCE_TIMEOUT_MS } from '@/keyboard/registry'
import { usePendingSequence } from '@/keyboard/use-shortcuts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `g` … — the half-typed shortcut, made visible.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §6: *"an invisible modal state is how a keyboard user
 * ends up typing `b` into a text field."*
 *
 * The registry has always tracked the partial sequence — it has to, or `g` `b` could
 * not work — and it has always exposed it through `usePendingSequence()`. Nothing
 * rendered it, which is the failure mode §6 describes rather than a missing nicety:
 * pressing `g` puts the application into a modal state that lasts a second, changes
 * the meaning of the next keystroke, and said nothing at all. A user who pressed `g`
 * by accident had no way to know why their next letter navigated, and a user who
 * meant it had no confirmation that the first half registered.
 *
 * ### It is a hint, not a status bar
 *
 * Bottom-centre, one row, gone within `SEQUENCE_TIMEOUT_MS`. Not near the top, where
 * it would sit under the two warning strips and read as a third; not in the corner
 * over the rail, where it would cover the rail's own bottom icons at the moment the
 * user is trying to navigate.
 *
 * `pointer-events-none` because there is nothing to click and the pill floats over
 * whatever the user was working in — a transient overlay that swallows a click on the
 * card underneath it is a worse bug than the one this fixes.
 *
 * ### What a screen reader hears
 *
 * The chips are decorative and marked so; the sentence beside them is the content.
 * *"Pressed G. Waiting for the rest of a keyboard shortcut."* is a sentence, where
 * announcing the chips directly would say "G" — indistinguishable from any other
 * stray letter, and no explanation at all. `role="status"` keeps it polite: it
 * arrives after whatever the user was already being told, which for a one-second hint
 * is correct.
 */
export function PendingSequence() {
  const pending = usePendingSequence()

  /**
   * Nothing armed, nothing mounted — and mounting only while armed is what makes the
   * live region announce. A `role="status"` present from the start is a region some
   * screen readers re-read on unrelated updates; one that appears when the state does
   * announces exactly once, when it becomes true. Same reasoning as
   * ../components/shell/connection-status.tsx.
   */
  if (pending.length === 0) return null

  return (
    <div
      data-slot="pending-sequence"
      role="status"
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 animate-fade-in items-center gap-1.5 rounded-control border border-border-strong bg-surface-2 px-2 py-1 shadow-overlay"
    >
      <span aria-hidden="true" className="flex items-center gap-1">
        {pending.map((chord, index) => (
          <span key={`${String(index)}-${chord}`} className="flex items-center gap-1">
            {/**
             * "then", not `+`, for the reason `shortcut-sheet.tsx` gives: `g` `+` `b`
             * instructs the user to press them together, which is a different and
             * wrong instruction. Consistency with the sheet matters more than usual
             * here — the sheet is where they learned the chord.
             */}
            {index > 0 && <span className="text-2xs text-fg-subtle">then</span>}
            <kbd className="flex h-5 min-w-5 items-center justify-center rounded-control border border-border-strong bg-surface-3 px-1.5 font-sans text-2xs text-fg">
              {chord}
            </kbd>
          </span>
        ))}
        {/**
         * The ellipsis is the whole message in one glyph: something is expected next.
         * Without it the pill reads as a label for a key that was pressed, rather than
         * as a prompt for one that has not been.
         */}
        <span className="text-2xs text-fg-subtle">…</span>
      </span>
      <span className="sr-only">
        Pressed {pending.join(', then ')}. Waiting for the rest of a keyboard shortcut.
      </span>
      {/**
       * The timeout is read from the registry rather than described, so this sentence
       * cannot drift from the constant the way a hard-coded "one second" would. It is
       * `sr-only` and last: a sighted user watches the pill disappear, which says it
       * better than a sentence could, but a screen-reader user gets no such signal and
       * would otherwise wait for a second half that has already expired.
       *
       * *"or on any other key"* is exact, not a simplification. `dispatchShortcut`
       * clears the buffer on any keystroke that continues no sequence, which is what
       * stops `g` `q` from leaving `g` armed for the next `b`.
       */}
      <span className="sr-only">
        Cancels after {(SEQUENCE_TIMEOUT_MS / 1000).toString()} second
        {SEQUENCE_TIMEOUT_MS === 1_000 ? '' : 's'}, or on any other key.
      </span>
    </div>
  )
}
