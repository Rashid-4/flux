/**
 * ══════════════════════════════════════════════════════════════════════
 * Chords, sequences, and how a key event becomes one.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Pure. No React, no DOM beyond the `KeyboardEvent` shape, no registry — so the
 * matching rules can be driven directly by a test rather than through a rendered
 * component, which is the only way the awkward cases (dead keys, `Shift+/`
 * producing `?`, a sequence that times out mid-way) get exercised at all.
 *
 * ### The vocabulary
 *
 * A **chord** is one keypress with its modifiers: `⌘K`, `?`, `[`. A **sequence**
 * is chords pressed one after another: `g` then `b`. `docs/specs/web/shell.md` §6
 * requires both — *"the Jira/GitHub idiom power users already have in their
 * fingers"* — and a registry that only models chords cannot express `g b` without
 * each surface hand-rolling its own timer, which is how two surfaces end up with
 * different timeouts.
 *
 * ### `mod`, not `meta` or `ctrl`
 *
 * A binding declares `mod: true` and this file decides which physical key that is:
 * Command on macOS, Control everywhere else. Declaring the platform key at the
 * call site means every shortcut carries a conditional, and the one that gets it
 * wrong is invisible on the author's own machine.
 */

/** One keypress. `key` is compared against `KeyboardEvent.key`, case-insensitively. */
export interface Chord {
  key: string
  /** Command on macOS, Control elsewhere. Resolved by `matchesChord`. */
  mod?: boolean | undefined
  shift?: boolean | undefined
  alt?: boolean | undefined
}

/**
 * A binding is one or more chords. One chord is `⌘K`; two is `g` then `b`.
 *
 * `readonly [Chord, ...Chord[]]` rather than `Chord[]`, so an empty binding — which
 * would match every keystroke or none depending on the loop that reads it — cannot
 * be constructed at all.
 */
export type Binding = readonly [Chord, ...Chord[]]

/**
 * The subset of `KeyboardEvent` matching needs.
 *
 * Structural rather than the DOM type, so a test can drive this with an object
 * literal instead of constructing a real event and dispatching it. The four
 * modifier flags plus `key` is genuinely all of it.
 */
export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Whether this is an Apple platform, decided once at module load.
 *
 * `navigator.platform` is deprecated but is still the only synchronously-readable
 * answer: `navigator.userAgentData` is not in Safari or Firefox, and its
 * `getHighEntropyValues` is a promise, which is the wrong shape for a function
 * that runs inside a keydown handler. So the modern field is preferred when it
 * exists and the deprecated one is the fallback.
 *
 * Evaluated once rather than per keystroke, per §6: *"detected once"*. It cannot
 * change during a session, and reading it in the hot path is work on every key.
 */
function detectApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false

  const withData = navigator as Navigator & { userAgentData?: { platform?: string } }
  const modern = withData.userAgentData?.platform
  if (typeof modern === 'string' && modern !== '') return /mac/i.test(modern)

  /** Deprecated, and still the only synchronous answer Safari and Firefox give. */
  const legacy: unknown = navigator.platform
  if (typeof legacy === 'string' && legacy !== '') return /mac|iphone|ipad|ipod/i.test(legacy)

  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
}

export const IS_APPLE_PLATFORM = detectApplePlatform()

/**
 * Whether `event` is the chord `chord`, on this platform.
 *
 * Three details that are each a bug if left out:
 *
 * **Case folding on `key`.** `KeyboardEvent.key` for Shift+G is `'G'`, so a binding
 * declared as `{ key: 'g' }` would not match a user with caps lock on. Compared
 * case-insensitively, and `shift` is matched separately when the binding cares.
 *
 * **`shift` is only asserted when the binding declares it.** `?` is produced *by*
 * Shift on most layouts, so requiring `shift: false` for a `?` binding makes it
 * unreachable — and on a French AZERTY layout `?` needs no Shift at all. The rule
 * is therefore: if the binding says nothing about Shift, Shift is not consulted.
 * `mod` and `alt` are asserted in both directions, because those genuinely change
 * which command was meant.
 *
 * **`mod` resolves per platform.** `metaKey` on Apple, `ctrlKey` elsewhere — and
 * the *other* one must be absent, so `Ctrl+K` on a Mac does not fire the Command
 * binding.
 */
export function matchesChord(event: KeyLike, chord: Chord): boolean {
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false

  const wantsMod = chord.mod === true
  const modPressed = IS_APPLE_PLATFORM ? event.metaKey : event.ctrlKey
  const otherModPressed = IS_APPLE_PLATFORM ? event.ctrlKey : event.metaKey
  if (modPressed !== wantsMod) return false
  if (otherModPressed) return false

  if (chord.alt !== undefined && event.altKey !== chord.alt) return false
  if (chord.alt === undefined && event.altKey) return false

  if (chord.shift !== undefined && event.shiftKey !== chord.shift) return false

  return true
}

/**
 * A binding's identity, for conflict detection and for React keys.
 *
 * Two bindings collide when they are the same keystrokes, so the string has to be
 * derived from the resolved chord and not from however the author wrote it.
 * `{ key: 'K', mod: true }` and `{ key: 'k', mod: true }` are the same shortcut and
 * must produce the same id, or the duplicate check in `registry.ts` — which §6
 * requires to *throw* — silently passes on a casing difference.
 */
export function bindingId(binding: Binding): string {
  return binding
    .map((chord) => {
      const parts: string[] = []
      if (chord.mod === true) parts.push('mod')
      if (chord.alt === true) parts.push('alt')
      if (chord.shift === true) parts.push('shift')
      parts.push(chord.key.toLowerCase())
      return parts.join('+')
    })
    .join(' ')
}

/** Modifier glyphs, Apple first. `⌥` and `⇧` are the same on both, `⌘`/`Ctrl` is not. */
const MOD_LABEL = IS_APPLE_PLATFORM ? '⌘' : 'Ctrl'
const ALT_LABEL = IS_APPLE_PLATFORM ? '⌥' : 'Alt'
const SHIFT_LABEL = IS_APPLE_PLATFORM ? '⇧' : 'Shift'

/**
 * Names for keys whose `KeyboardEvent.key` is a word or an invisible character.
 *
 * `' '` is the one that matters: a space bar binding rendered from the raw key is a
 * blank chip. The arrows and `Escape` are here because `↑` reads faster than the
 * word and because `Esc` is the near-universal printed form.
 */
const KEY_LABEL: Record<string, string> = {
  ' ': 'Space',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: '↵',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
}

/**
 * One chord as a user would read it. `⌘K` on macOS, `Ctrl+K` elsewhere.
 *
 * §6: *"Do not print `Cmd` as a word."* The Apple form is glyphs with no separator,
 * because that is how every macOS menu prints it; the Windows and Linux form uses
 * `+` between words, because that is how those platforms print it. One function so
 * the two conventions cannot be mixed within a sheet.
 *
 * Shift is only shown when the binding *declares* it, matching `matchesChord`: `?`
 * is reached with Shift on most layouts and printing it as `⇧?` would be telling
 * the user to press a third key that is already part of the second.
 */
export function formatChord(chord: Chord): string {
  const label = KEY_LABEL[chord.key.toLowerCase()] ?? upperFirst(chord.key)
  const modifiers: string[] = []
  if (chord.mod === true) modifiers.push(MOD_LABEL)
  if (chord.alt === true) modifiers.push(ALT_LABEL)
  if (chord.shift === true) modifiers.push(SHIFT_LABEL)

  if (modifiers.length === 0) return label
  return IS_APPLE_PLATFORM ? `${modifiers.join('')}${label}` : `${modifiers.join('+')}+${label}`
}

/**
 * The chords of a binding, each formatted, for rendering as separate keycaps.
 *
 * An array rather than a joined string because a sequence renders as two chips with
 * the word "then" between them — `g` `then` `b` — and a caller handed `"g b"` would
 * have to split it back apart to do that. §8's sheet is the only consumer that
 * matters and it wants the parts.
 */
export function formatBinding(binding: Binding): string[] {
  return binding.map(formatChord)
}

function upperFirst(value: string): string {
  if (value.length === 1) return value.toUpperCase()
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

/**
 * Whether the event landed in something the user is typing into.
 *
 * §6 calls the absence of this *"the single most common keyboard-shortcut bug in
 * web apps"*, and it is: without it, typing "background" into a filter navigates to
 * the board on the `b`.
 *
 * `closest()` rather than checking the target itself, because the focused node
 * inside a contenteditable is frequently a text node's parent `<span>` rather than
 * the editable host — and the issue description is a ProseMirror document, which is
 * exactly that shape.
 *
 * `[role="textbox"]` catches custom editors that are not `<input>`, and
 * `[role="combobox"]` catches the command palette's own input so a shortcut cannot
 * fire from inside the thing that lists shortcuts.
 */
const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]'

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  /**
   * A checkbox or a button is an `<input>` that nobody types into, and suppressing
   * shortcuts on them would break `[` while the sidebar toggle has focus — which is
   * precisely the control a keyboard user just used.
   */
  if (target instanceof HTMLInputElement) {
    const typed = ['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file']
    if (typed.includes(target.type)) return false
    return true
  }

  return target.closest(TEXT_ENTRY_SELECTOR) !== null
}
