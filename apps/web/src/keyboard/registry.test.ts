import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindingId, formatBinding, formatChord, isTextEntryTarget, matchesChord } from './keys'
import {
  dispatchShortcut,
  getPendingSequence,
  installShortcutListener,
  registerShortcut,
  resetShortcuts,
  SEQUENCE_TIMEOUT_MS,
  type Shortcut,
} from './registry'

/**
 * `docs/specs/web/shell.md` §13 names what this file must cover:
 * *"registration, unregistration on unmount, scoping, sequence timeout, the
 * suppression-in-text-input rule, and **that a duplicate binding throws in dev.**"*
 *
 * The dispatcher is driven directly rather than through a rendered component. A
 * keydown routed through Testing Library would exercise jsdom's event plumbing as
 * much as the matching rules, and the cases worth pinning here — a sequence that
 * times out half way, `Shift+/` producing `?`, `Ctrl+K` on a Mac — are all about
 * the rules.
 */

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

/** A keydown as if it happened inside `target`, which is what the suppression reads. */
function keyEventFrom(target: Element, key: string): KeyboardEvent {
  const event = keyEvent({ key })
  Object.defineProperty(event, 'target', { value: target, configurable: true })
  return event
}

function shortcut(overrides: Partial<Shortcut> & Pick<Shortcut, 'id' | 'binding'>): Shortcut {
  return {
    description: 'Do the thing',
    group: 'Global',
    run: () => {},
    ...overrides,
  } as Shortcut
}

beforeEach(() => {
  resetShortcuts()
})

afterEach(() => {
  resetShortcuts()
  vi.useRealTimers()
})

describe('chord matching', () => {
  it('matches a plain key regardless of the case the event reports', () => {
    /** Caps lock reports `'G'`; a binding written as `'g'` still has to fire. */
    expect(matchesChord({ ...noModifiers, key: 'G' }, { key: 'g' })).toBe(true)
  })

  /**
   * `?` is produced *by* Shift on a US layout and by no modifier at all on some
   * others. A binding that asserted `shift: false` would be unreachable on the
   * first and a binding that asserted `shift: true` unreachable on the second, so
   * Shift is only consulted when the binding mentions it.
   */
  it('ignores shift unless the binding declares it', () => {
    expect(matchesChord({ ...noModifiers, key: '?', shiftKey: true }, { key: '?' })).toBe(true)
    expect(matchesChord({ ...noModifiers, key: '?', shiftKey: false }, { key: '?' })).toBe(true)
    expect(
      matchesChord({ ...noModifiers, key: 'k', shiftKey: false }, { key: 'k', shift: true }),
    ).toBe(false)
  })

  it('requires the modifier when the binding asks for one, and rejects the other platform key', () => {
    const withMeta = { ...noModifiers, key: 'k', metaKey: true }
    const withCtrl = { ...noModifiers, key: 'k', ctrlKey: true }
    const bare = { ...noModifiers, key: 'k' }

    /** Exactly one of the two is the platform's `mod`; the other must never match. */
    const results = [
      matchesChord(withMeta, { key: 'k', mod: true }),
      matchesChord(withCtrl, { key: 'k', mod: true }),
    ]
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(matchesChord(bare, { key: 'k', mod: true })).toBe(false)
  })

  it('rejects a bare binding when alt is held', () => {
    expect(matchesChord({ ...noModifiers, key: 'g', altKey: true }, { key: 'g' })).toBe(false)
  })

  /**
   * The id is what the duplicate check compares, so it has to be derived from the
   * resolved chord. If `'K'` and `'k'` produced different ids the check would pass
   * on a casing difference and one of the two shortcuts would silently never run —
   * exactly the failure §6 requires a throw for.
   */
  it('gives the same id to bindings that are the same keystrokes', () => {
    expect(bindingId([{ key: 'K', mod: true }])).toBe(bindingId([{ key: 'k', mod: true }]))
    expect(bindingId([{ key: 'g' }, { key: 'b' }])).toBe('g b')
    expect(bindingId([{ key: 'k', mod: true }])).not.toBe(bindingId([{ key: 'k' }]))
  })
})

describe('platform-correct rendering', () => {
  it('never prints a modifier as a word on Apple, and always does elsewhere', () => {
    const rendered = formatChord({ key: 'k', mod: true })
    expect(rendered === '⌘K' || rendered === 'Ctrl+K').toBe(true)
    /** §6: "Do not print `Cmd` as a word." */
    expect(rendered).not.toContain('Cmd')
    expect(rendered).not.toContain('Command')
  })

  it('names keys whose event value is invisible or a word', () => {
    expect(formatChord({ key: ' ' })).toBe('Space')
    expect(formatChord({ key: 'Escape' })).toBe('Esc')
    expect(formatChord({ key: 'ArrowUp' })).toBe('↑')
  })

  /** A sequence renders as separate caps with "then" between them, so it is an array. */
  it('returns one label per chord in a sequence', () => {
    expect(formatBinding([{ key: 'g' }, { key: 'b' }])).toEqual(['G', 'B'])
  })
})

describe('registration', () => {
  it('registers, fires, and stops firing once unregistered', () => {
    const run = vi.fn()
    const off = registerShortcut(shortcut({ id: 'toggle', binding: [{ key: '[' }], run }))

    expect(dispatchShortcut(keyEvent({ key: '[' }))).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)

    off()
    expect(dispatchShortcut(keyEvent({ key: '[' }))).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
  })

  /**
   * §6: *"Two handlers claiming `g b` in the same scope is a bug that is invisible
   * in production and infuriating to diagnose — one of them silently never runs.
   * Throw in dev."* Vitest runs with `import.meta.env.DEV` true, which is the
   * branch under test; production warns instead, and that path is not reachable
   * from here because the flag is replaced at build time.
   */
  it('throws on a duplicate binding', () => {
    registerShortcut(shortcut({ id: 'first', binding: [{ key: 'g' }, { key: 'b' }] }))

    expect(() => {
      registerShortcut(shortcut({ id: 'second', binding: [{ key: 'g' }, { key: 'b' }] }))
    }).toThrow(/Duplicate keyboard shortcut "g b"/)
  })

  it('names both claimants in the error, because one id is not enough to find it', () => {
    registerShortcut(
      shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }], description: 'Go to board' }),
    )

    expect(() => {
      registerShortcut(
        shortcut({
          id: 'backlog',
          binding: [{ key: 'g' }, { key: 'b' }],
          description: 'Go to backlog',
        }),
      )
    }).toThrow(/board.*Go to board.*backlog.*Go to backlog/s)
  })

  /**
   * StrictMode mounts, unmounts and remounts every component in development. If a
   * re-registration of the *same* shortcut threw, StrictMode would be unusable —
   * and StrictMode is the tool that finds the missing cleanups this registry
   * depends on.
   */
  it('allows the same shortcut to re-register, for StrictMode', () => {
    registerShortcut(shortcut({ id: 'palette', binding: [{ key: 'k', mod: true }] }))
    expect(() => {
      registerShortcut(shortcut({ id: 'palette', binding: [{ key: 'k', mod: true }] }))
    }).not.toThrow()
  })

  /**
   * Two components with the same id mounting and unmounting out of order — which is
   * what a route transition does — must not have the outgoing one delete the
   * incoming one's binding.
   */
  it('does not let a stale teardown remove a live binding', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = registerShortcut(shortcut({ id: 'same', binding: [{ key: '[' }], run: first }))
    registerShortcut(shortcut({ id: 'same', binding: [{ key: '[' }], run: second }))

    offFirst()

    dispatchShortcut(keyEvent({ key: '[' }))
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('does not fire a shortcut that is registered but disabled', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'gated', binding: [{ key: '[' }], run, enabled: false }))

    expect(dispatchShortcut(keyEvent({ key: '[' }))).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  /**
   * A documented shortcut has no handler on purpose — `Escape` is implemented by
   * Radix's dismissable-layer stack. It must appear in the sheet and must not
   * swallow the keystroke, or it would break the very dismissal it documents.
   */
  it('never consumes a keystroke for a documented-only shortcut', () => {
    registerShortcut({
      id: 'escape',
      binding: [{ key: 'Escape' }],
      description: 'Close the topmost layer',
      group: 'Global',
      global: true,
      implementedBy: 'Radix DismissableLayer',
    })

    expect(dispatchShortcut(keyEvent({ key: 'Escape' }))).toBe(false)
  })
})

describe('sequences', () => {
  it('fires only after the whole sequence', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }], run }))

    expect(dispatchShortcut(keyEvent({ key: 'g' }))).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(getPendingSequence()).toEqual(['G'])

    expect(dispatchShortcut(keyEvent({ key: 'b' }))).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(getPendingSequence()).toEqual([])
  })

  it('discards a partial sequence after the timeout', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }], run }))

    dispatchShortcut(keyEvent({ key: 'g' }))
    expect(getPendingSequence()).toEqual(['G'])

    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS + 1)
    expect(getPendingSequence()).toEqual([])

    dispatchShortcut(keyEvent({ key: 'b' }))
    expect(run).not.toHaveBeenCalled()
  })

  /**
   * `g` then `q` must not leave `g` armed. If it did, the next `b` — typed a second
   * later for an unrelated reason — would navigate, which is the invisible modal
   * state §6 warns about.
   */
  it('a keystroke that continues nothing ends the sequence', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }], run }))

    dispatchShortcut(keyEvent({ key: 'g' }))
    dispatchShortcut(keyEvent({ key: 'q' }))
    expect(getPendingSequence()).toEqual([])

    dispatchShortcut(keyEvent({ key: 'b' }))
    expect(run).not.toHaveBeenCalled()
  })

  /**
   * A modifier keypress reports `key: 'Meta'` on its own. Without the guard,
   * reaching for `⌘K` while `g` is armed clears the sequence — so `g` then `⌘`
   * then `b` would fail for a reason invisible to the person typing.
   */
  it('ignores a modifier keypress rather than treating it as a chord', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }], run }))

    dispatchShortcut(keyEvent({ key: 'g' }))
    expect(dispatchShortcut(keyEvent({ key: 'Shift' }))).toBe(false)
    expect(getPendingSequence()).toEqual(['G'])

    dispatchShortcut(keyEvent({ key: 'b' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  /** A single-chord binding on the sequence's second letter must not pre-empt it. */
  it('prefers continuing a sequence over starting a new chord', () => {
    const sequence = vi.fn()
    const single = vi.fn()
    registerShortcut(
      shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }], run: sequence }),
    )
    registerShortcut(shortcut({ id: 'bold', binding: [{ key: 'b' }], run: single }))

    dispatchShortcut(keyEvent({ key: 'g' }))
    dispatchShortcut(keyEvent({ key: 'b' }))

    expect(sequence).toHaveBeenCalledTimes(1)
    expect(single).not.toHaveBeenCalled()
  })
})

describe('text-entry suppression', () => {
  it('does not fire a non-global shortcut from an input', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'board', binding: [{ key: 'b' }], run }))

    expect(dispatchShortcut(keyEventFrom(input, 'b'))).toBe(false)
    expect(run).not.toHaveBeenCalled()
    input.remove()
  })

  it('still fires a global shortcut from an input', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const run = vi.fn()
    registerShortcut(
      shortcut({ id: 'palette', binding: [{ key: 'k', mod: true }], run, global: true }),
    )

    const event = keyEventFrom(input, 'k')
    Object.defineProperty(event, 'metaKey', { value: true })
    Object.defineProperty(event, 'ctrlKey', { value: true })
    /** One of the two is this platform's `mod`; the other is rejected by design. */
    const platformEvent = keyEvent({ key: 'k', metaKey: true })
    Object.defineProperty(platformEvent, 'target', { value: input })
    const ctrlEvent = keyEvent({ key: 'k', ctrlKey: true })
    Object.defineProperty(ctrlEvent, 'target', { value: input })

    dispatchShortcut(platformEvent)
    dispatchShortcut(ctrlEvent)
    expect(run).toHaveBeenCalledTimes(1)
    input.remove()
  })

  /**
   * A checkbox is an `<input>` nobody types into. Suppressing there would break `[`
   * while the sidebar toggle has focus — the control a keyboard user just pressed.
   */
  it('treats a checkbox as not-text, so shortcuts still work from one', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isTextEntryTarget(checkbox)).toBe(false)

    const text = document.createElement('input')
    expect(isTextEntryTarget(text)).toBe(true)
  })

  /**
   * The focused node inside a rich-text editor is usually a descendant of the
   * editable host, not the host itself — the issue description is a ProseMirror
   * document, which is exactly that shape.
   */
  it('suppresses inside a contenteditable descendant, not only on the host', () => {
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    host.append(inner)
    document.body.append(host)

    expect(isTextEntryTarget(inner)).toBe(true)
    host.remove()
  })

  it('clears a pending sequence when focus is in a text field', () => {
    const input = document.createElement('input')
    document.body.append(input)
    registerShortcut(shortcut({ id: 'board', binding: [{ key: 'g' }, { key: 'b' }] }))

    dispatchShortcut(keyEvent({ key: 'g' }))
    expect(getPendingSequence()).toEqual(['G'])

    dispatchShortcut(keyEventFrom(input, 'x'))
    expect(getPendingSequence()).toEqual([])
    input.remove()
  })
})

describe('the document listener', () => {
  it('consumes a handled key and leaves an unhandled one alone', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'toggle', binding: [{ key: '[' }], run }))
    const teardown = installShortcutListener()

    const handled = keyEvent({ key: '[' })
    document.dispatchEvent(handled)
    expect(run).toHaveBeenCalledTimes(1)
    expect(handled.defaultPrevented).toBe(true)

    const ignored = keyEvent({ key: 'z' })
    document.dispatchEvent(ignored)
    expect(ignored.defaultPrevented).toBe(false)

    teardown()
  })

  it('stops listening after teardown', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'toggle', binding: [{ key: '[' }], run }))
    installShortcutListener()()

    document.dispatchEvent(keyEvent({ key: '[' }))
    expect(run).not.toHaveBeenCalled()
  })

  /** Something nearer the user already answered; the registry must not answer again. */
  it('ignores an event another layer already handled', () => {
    const run = vi.fn()
    registerShortcut(shortcut({ id: 'toggle', binding: [{ key: '[' }], run }))
    const teardown = installShortcutListener()

    const event = keyEvent({ key: '[' })
    event.preventDefault()
    document.dispatchEvent(event)

    expect(run).not.toHaveBeenCalled()
    teardown()
  })
})

const noModifiers = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
