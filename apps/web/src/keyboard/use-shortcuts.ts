import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  getPendingSequence,
  getShortcutSnapshot,
  installShortcutListener,
  isHandled,
  registerShortcut,
  subscribeToPendingSequence,
  subscribeToShortcuts,
  SHORTCUT_GROUPS,
  type Shortcut,
  type ShortcutGroup,
} from '@/keyboard/registry'

/**
 * React's view of the registry.
 *
 * Three hooks, and the split matters: a component that *binds* a shortcut must not
 * re-render when an unrelated one is registered, and the `?` sheet — which does
 * want every change — must not be the reason every other consumer re-renders.
 */

/**
 * Register a shortcut for as long as the component is mounted.
 *
 * §6: *"A component registers while mounted and unregisters on unmount. A shortcut
 * bound by the board must not fire on the admin page."* Mount scoping *is* the
 * scoping: the board's component is gone once you navigate away, so its binding
 * goes with it, and there is no second scope concept to keep in sync with the
 * router.
 *
 * ### The handler is read through a ref, and the registration does not depend on it
 *
 * The obvious version puts `shortcut` in the effect's dependency array, which
 * re-registers on every render — because `run` is a new closure each time, and so
 * is the `binding` array literal at the call site. Re-registering on every render
 * means the registry publishes on every render, which re-renders the sheet, which
 * is a loop that only shows up once something is listening.
 *
 * So the effect depends on the *identity* of the binding and the flags, and the
 * handler is read from a ref at fire time. The ref is updated on every render
 * without an effect, which is safe here because nothing reads it during render —
 * only a keydown does, and that is always after commit.
 */
export function useShortcut(shortcut: Shortcut): void {
  const latest = useRef(shortcut)
  latest.current = shortcut

  const { id, description, group } = shortcut
  const bindingKey = shortcut.binding.map((chord) => JSON.stringify(chord)).join('|')
  const isGlobal = shortcut.global === true
  const enabled = isHandled(shortcut) ? shortcut.enabled !== false : undefined
  const implementedBy = isHandled(shortcut) ? undefined : shortcut.implementedBy

  useEffect(() => {
    const current = latest.current

    /**
     * A stable wrapper, so the function the registry holds never changes identity
     * while the component that owns it stays mounted — and so the *current* handler
     * runs rather than the one from the render that happened to register.
     */
    const registered: Shortcut =
      implementedBy === undefined
        ? {
            id,
            binding: current.binding,
            description,
            group,
            global: isGlobal,
            enabled,
            run: (event) => {
              const live = latest.current
              if (isHandled(live)) live.run(event)
            },
          }
        : { id, binding: current.binding, description, group, global: isGlobal, implementedBy }

    return registerShortcut(registered)
    // `bindingKey` stands in for the binding's value; see the header.
  }, [id, description, group, bindingKey, isGlobal, enabled, implementedBy])
}

/**
 * Every registered shortcut, grouped and ordered for the `?` sheet.
 *
 * Sorted by `SHORTCUT_GROUPS` order and then by description, so the sheet does not
 * reorder itself as components mount — a help dialog whose rows move between two
 * openings is one people stop trusting.
 */
export interface ShortcutSection {
  group: ShortcutGroup
  shortcuts: readonly Shortcut[]
}

export function useShortcutSections(): readonly ShortcutSection[] {
  const shortcuts = useSyncExternalStore(
    subscribeToShortcuts,
    getShortcutSnapshot,
    getShortcutSnapshot,
  )

  return SHORTCUT_GROUPS.map((group) => ({
    group,
    shortcuts: shortcuts
      .filter((shortcut) => shortcut.group === group)
      .sort((a, b) => a.description.localeCompare(b.description)),
  })).filter((section) => section.shortcuts.length > 0)
}

/** The flat set, for the palette's command provider. */
export function useShortcuts(): readonly Shortcut[] {
  return useSyncExternalStore(subscribeToShortcuts, getShortcutSnapshot, getShortcutSnapshot)
}

/**
 * The chords typed so far in an incomplete sequence.
 *
 * §6 requires the partial state to be visible: *"an invisible modal state is how a
 * keyboard user ends up typing `b` into a text field."* Empty array means nothing
 * is armed.
 */
export function usePendingSequence(): readonly string[] {
  return useSyncExternalStore(subscribeToPendingSequence, getPendingSequence, getPendingSequence)
}

/**
 * Attach the document listener for the lifetime of the app.
 *
 * Called once, by the shell. Not by each consumer — a second listener would
 * dispatch every shortcut twice, and the symptom (a sidebar that toggles and
 * un-toggles on one keypress) reads as a state bug rather than as a duplicate
 * listener.
 */
export function useShortcutListener(): void {
  useEffect(() => installShortcutListener(), [])
}
