import { bindingId, isTextEntryTarget, matchesChord, type Binding } from '@/keyboard/keys'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The shortcut registry — the one place a shortcut is defined.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §6 builds this first because everything else in the
 * shell depends on it, and §8 makes the `?` sheet *"a projection of registry
 * state"* — so the registry is not a dispatcher with help text bolted on, it is the
 * documentation with a dispatcher attached.
 *
 * ### Why a module-level store rather than a Zustand store or a context
 *
 * The consumers are one document-level listener and one dialog, and both want the
 * whole set rather than a slice. A context would put every registration on a render
 * path — a component registering during render is a component that re-renders every
 * other consumer — and Zustand would be a second state library in a folder whose
 * state is a `Map` with two writers. `useSyncExternalStore` over a plain module is
 * the smaller correct thing, and it is what `components/data/toaster.tsx` already
 * does for the same shape of problem.
 *
 * ### A description is not optional
 *
 * §6: *"A shortcut with no description cannot be registered."* That is enforced by
 * the type — `description` and `group` are required fields of `Shortcut`, so the
 * failure is at the call site and at compile time rather than as a blank row in the
 * sheet. This is the mechanism that makes §8's rule real: if you find yourself
 * typing a shortcut's name into JSX, the registry is missing a field.
 */

/** Where a shortcut appears in the `?` sheet. Ordered as declared here. */
export const SHORTCUT_GROUPS = ['Global', 'Navigation', 'View', 'Project'] as const

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

interface ShortcutBase {
  /** Stable across re-registration. Used for React keys and for diagnostics. */
  id: string
  binding: Binding
  /** Imperative, sentence case, no trailing full stop. Rendered verbatim by `?`. */
  description: string
  group: ShortcutGroup
  /**
   * Fire even while a text input has focus.
   *
   * Almost never correct. §6 names the two that are — `⌘K` and `Escape` — because
   * both mean "get me out of here" and a user typing into a filter still expects
   * them. Anything else set to `true` is the bug §6 describes.
   */
  global?: boolean | undefined
}

/**
 * A shortcut this application handles.
 *
 * `enabled` exists for the case mount/unmount cannot express: a component that is
 * still mounted but must not respond — a nav item whose permission was revoked
 * mid-session, a project shortcut while no project is open. Registering
 * conditionally inside a hook would break the rules of hooks; a flag does not.
 */
export interface HandledShortcut extends ShortcutBase {
  run: (event: KeyboardEvent) => void
  enabled?: boolean | undefined
}

/**
 * A shortcut the user has, implemented by something other than this registry.
 *
 * `Escape` is the whole reason this variant exists. §6 lists it in the baseline set
 * and §7.3 requires it to *"close the topmost layer — palette, drawer, sheet, in
 * that order"* — which is a layer stack, and Radix's `DismissableLayer` already
 * maintains one correctly, including the ordering and including nested layers this
 * registry cannot see.
 *
 * So the honest options were: reimplement a layer stack the dialog primitive
 * already has, or register `Escape` with a handler that does nothing and let the
 * sheet imply we handle it. Both are worse than a third entry kind that says *this
 * shortcut is real, here is where it lives*. `implementedBy` is required, so the
 * variant cannot be used to quietly park a shortcut nobody wrote.
 */
export interface DocumentedShortcut extends ShortcutBase {
  /** Where the behaviour actually is, for whoever goes looking. */
  implementedBy: string
}

/**
 * `'run' in shortcut` rather than a `kind` discriminant or `run?: undefined`.
 *
 * The optional-undefined form is the idiomatic way to discriminate a union like
 * this, and `components/conventions.test.ts` rejects it — correctly, and for a
 * reason that applies here: under `exactOptionalPropertyTypes` an optional property
 * declared without `| undefined` cannot receive an explicitly-passed `undefined`,
 * so the first caller that forwards its own optional `run` fails to compile. A
 * `kind` field would work too and costs a redundant word at every registration,
 * where the presence of a handler already says which kind this is.
 */
export function isHandled(shortcut: Shortcut): shortcut is HandledShortcut {
  return 'run' in shortcut
}

export type Shortcut = HandledShortcut | DocumentedShortcut

/**
 * One live registration.
 *
 * `token` is the registration's identity and is deliberately *not* the shortcut's
 * `id`. Two mounts of the same component share an id — that is what makes a
 * StrictMode remount a re-registration rather than a conflict — so an id cannot
 * also answer "is the entry currently in the map still the one my teardown
 * created?". During a route transition the incoming tree mounts before the
 * outgoing one unmounts, and with id-based teardown the departing component
 * deletes the arriving component's binding. Written after a test caught exactly
 * that.
 */
interface Entry {
  shortcut: Shortcut
  /** The chord string this entry claims, for the conflict scan below. */
  binding: string
  token: symbol
}

/**
 * The map is keyed by **binding *and* id**, not by binding alone.
 *
 * It was keyed by binding for as long as one binding could only mean one thing, and
 * `Escape` broke that — legitimately. `shell.escape` is a `DocumentedShortcut`: it
 * exists so the `?` sheet lists the key, and its behaviour is Radix's layer stack.
 * `issue.peek.close` is a `HandledShortcut` on the same key, because the peek panel
 * is not a Radix layer and there is no stack for it to be topmost in.
 *
 * Under a binding-keyed map those two were mutually destructive in a way nothing
 * pointed at: registering the panel's entry *overwrote* the shell's, and unregistering
 * it deleted the key outright — so closing one peek removed `Escape` from the help
 * sheet for the rest of the session, and the throw in `reportConflict` fired on a pair
 * that has no conflict to report. A documented entry never runs, so it cannot be the
 * one that "silently never runs".
 *
 * The separator is `\u0000` because a composite key needs a character that cannot occur
 * in either half, and every printable candidate can: `.` is in every id, and `+` and a
 * space are both in bindings — `mod+k`, `g then b`. Two different pairs colliding on one
 * key is the bug this function exists to prevent, so the separator has to be outside both
 * alphabets rather than merely unlikely to appear in them.
 *
 * **The escape, and not the character.** Typing the raw byte here works perfectly at
 * runtime and costs the file its text-ness: git classifies any blob containing a NUL as
 * binary, so `git diff`, `git blame` and every review tool report
 * `Bin 14293 -> 16354 bytes` in place of the change. This file spent one commit in that
 * state — it compiled, it typechecked, its tests passed, and the only symptom was a source
 * file that could no longer be reviewed. `\u0000` is the identical key, in text.
 */
function entryKey(binding: string, id: string): string {
  return `${binding}\u0000${id}`
}

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

/**
 * The snapshot handed to React.
 *
 * Rebuilt on write, never on read. `useSyncExternalStore` compares snapshots with
 * `Object.is` and calls `getSnapshot` during render — returning a fresh array from
 * the getter is an infinite render loop, and it is the single commonest way to
 * misuse this hook.
 */
let snapshot: readonly Shortcut[] = []

function publish(): void {
  snapshot = [...entries.values()].map((entry) => entry.shortcut)
  for (const listener of listeners) listener()
}

/**
 * Development only, and it throws.
 *
 * §6: *"Two **handlers** claiming `g b` in the same scope is a bug that is invisible
 * in production and infuriating to diagnose — one of them silently never runs. Throw
 * in dev."* The emphasis is load-bearing and is why `registerShortcut` only calls this
 * for a pair of `HandledShortcut`s — see `entryKey`.
 *
 * In production it warns instead. A shortcut collision is a real defect but it is
 * not worth taking a user's board down over: they lose one keystroke, and the
 * console line is what tells us it happened. `import.meta.env.DEV` is replaced with
 * a literal at build time, so the throw is not in the shipped bundle at all.
 */
function reportConflict(binding: string, existing: Shortcut, incoming: Shortcut): void {
  const message =
    `Duplicate keyboard shortcut "${binding}": ` +
    `"${existing.id}" (${existing.description}) and "${incoming.id}" (${incoming.description}) ` +
    `both claim it. One of them would silently never run.`

  if (import.meta.env.DEV) throw new Error(message)
  console.error(`flux: ${message}`)
}

/**
 * Register a shortcut. Returns its unregister function.
 *
 * Imperative rather than a hook, so it can be called from a test without rendering
 * and from `useShortcut` with the lifecycle React already provides.
 */
export function registerShortcut(shortcut: Shortcut): () => void {
  const binding = bindingId(shortcut.binding)
  const key = entryKey(binding, shortcut.id)

  /**
   * Re-registering *the same* shortcut is not a conflict, and under a composite key it
   * cannot become one: the id is part of the key, so a remount overwrites its own entry
   * rather than colliding with it. React's StrictMode mounts, unmounts and remounts
   * every component in development, and an effect that re-runs must not be a
   * duplicate-binding error — that would make StrictMode unusable, which is exactly the
   * tool that finds missing cleanups.
   *
   * What is left to check is the thing §6 is actually about: two *handlers* on one
   * chord, where `dispatchShortcut` takes the first match and registration order — an
   * accident of the mount tree — decides which one the user gets. A documented entry
   * cannot lose that race because it never runs, so it counts on neither side of the
   * comparison.
   */
  if (isHandled(shortcut)) {
    for (const existing of entries.values()) {
      if (existing.binding !== binding) continue
      if (existing.shortcut.id === shortcut.id) continue
      if (!isHandled(existing.shortcut)) continue
      reportConflict(binding, existing.shortcut, shortcut)
      /** One line per collision, not one per entry that shares the chord. */
      break
    }
  }

  const token = Symbol(shortcut.id)
  entries.set(key, { shortcut, binding, token })
  publish()

  return () => {
    /** Only if this registration is still the live one — see `Entry.token`. */
    const current = entries.get(key)
    if (current !== undefined && current.token === token) {
      entries.delete(key)
      publish()
    }
  }
}

export function subscribeToShortcuts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getShortcutSnapshot(): readonly Shortcut[] {
  return snapshot
}

/** Test-only: drop every registration so one file cannot leak into the next. */
export function resetShortcuts(): void {
  entries.clear()
  publish()
}

/**
 * How long a partial sequence waits for its next chord.
 *
 * One second. Long enough that `g` then `b` is comfortable for someone who is not
 * a touch typist, short enough that a `g` typed by accident does not leave the app
 * in a modal state long enough to swallow the next real keystroke. §6 requires both
 * the timeout and that the partial state be *visible*, which is what
 * `getPendingSequence` is for.
 */
export const SEQUENCE_TIMEOUT_MS = 1_000

let pending: Chordish[] = []
let pendingTimer: ReturnType<typeof setTimeout> | undefined
const pendingListeners = new Set<() => void>()
let pendingSnapshot: readonly string[] = []

type Chordish = { key: string; label: string }

function publishPending(): void {
  pendingSnapshot = pending.map((chord) => chord.label)
  for (const listener of pendingListeners) listener()
}

function clearPending(): void {
  if (pendingTimer !== undefined) clearTimeout(pendingTimer)
  pendingTimer = undefined
  if (pending.length === 0) return
  pending = []
  publishPending()
}

export function subscribeToPendingSequence(listener: () => void): () => void {
  pendingListeners.add(listener)
  return () => {
    pendingListeners.delete(listener)
  }
}

export function getPendingSequence(): readonly string[] {
  return pendingSnapshot
}

function isEnabled(shortcut: Shortcut): boolean {
  if (!isHandled(shortcut)) return false
  return shortcut.enabled !== false
}

/**
 * The dispatcher. One document listener drives it; a test drives it directly.
 *
 * Returns whether the event was consumed, so the caller can decide about
 * `preventDefault` — the dispatcher does not reach into the event beyond reading
 * it, because a function that both matches and mutates is one that cannot be tested
 * for matching alone.
 *
 * ### Order of the guards, which is the whole correctness of this function
 *
 * 1. **A modifier-only keypress is ignored outright.** Holding Command lights up
 *    `key === 'Meta'`, and without this the pending sequence is cleared by the act
 *    of reaching for a chord.
 * 2. **Text-entry suppression happens before matching**, so a non-global shortcut
 *    cannot fire from an input even if it would have matched. Doing it after would
 *    still be correct for firing, but the *sequence buffer* would fill with the
 *    letters someone is typing, and then a `b` two words later completes `g b`.
 * 3. **A pending sequence is tried before a fresh chord.** Otherwise a binding on
 *    plain `b` would beat the second half of `g b`, and whichever was registered
 *    first would win by accident.
 */
export function dispatchShortcut(event: KeyboardEvent): boolean {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return false

  const inTextEntry = isTextEntryTarget(event.target)

  const candidates = [...entries.values()]
    .map((entry) => entry.shortcut)
    .filter(isEnabled)
    .filter((shortcut) => !inTextEntry || shortcut.global === true)

  if (inTextEntry) clearPending()

  /** Continue a sequence in progress. */
  if (pending.length > 0) {
    const depth = pending.length
    for (const shortcut of candidates) {
      if (shortcut.binding.length <= depth) continue
      const matchedSoFar = pending.every((chord, index) => {
        const expected = shortcut.binding[index]
        return expected !== undefined && chord.key === bindingId([expected])
      })
      if (!matchedSoFar) continue

      const next = shortcut.binding[depth]
      if (next === undefined || !matchesChord(event, next)) continue

      if (depth + 1 === shortcut.binding.length) {
        clearPending()
        if (isHandled(shortcut)) shortcut.run(event)
        return true
      }
    }

    /**
     * A keystroke that continues no sequence ends the sequence rather than being
     * ignored. `g` then `q` must not leave `g` armed — the next `b` would then
     * navigate, which is the invisible-modal-state failure §6 warns about.
     */
    clearPending()
    return false
  }

  /** Start fresh: complete single-chord bindings, or arm a sequence. */
  let armed = false
  for (const shortcut of candidates) {
    const first = shortcut.binding[0]
    if (!matchesChord(event, first)) continue

    if (shortcut.binding.length === 1) {
      clearPending()
      if (isHandled(shortcut)) shortcut.run(event)
      return true
    }
    armed = true
  }

  if (armed) {
    pending = [{ key: bindingId([{ key: event.key }]), label: event.key.toUpperCase() }]
    publishPending()
    pendingTimer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS)
    return true
  }

  return false
}

/**
 * Attach the one document listener. Returns its teardown.
 *
 * `keydown` on `document` in the bubble phase, not capture. Capture would fire
 * before a Radix dialog's own handlers and before an input's default behaviour,
 * which means a shortcut could pre-empt a dismissal the user actually pressed.
 * Bubbling lets the layer nearest the user answer first, and anything that reaches
 * the document was genuinely unhandled.
 */
export function installShortcutListener(target: Document = document): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (dispatchShortcut(event)) event.preventDefault()
  }

  target.addEventListener('keydown', onKeyDown)
  return () => {
    target.removeEventListener('keydown', onKeyDown)
    clearPending()
  }
}
