import { CloudOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { StatusStrip } from '@/components/shell/status-strip'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Offline, and back again.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §11:
 *
 * | State | Requirement |
 * | --- | --- |
 * | Offline | a persistent, non-blocking indicator; queued mutations named, not silently dropped |
 * | Reconnect | the indicator clears itself; no manual reload |
 *
 * **Persistent and non-blocking** is the whole design. A toast would expire while
 * the condition it reports is still true, which is the worst of both — the user
 * loses the explanation and keeps the broken network. A modal would block a UI that
 * is entirely readable offline, since everything the shell renders came from a
 * bootstrap that has already resolved.
 *
 * ### What it deliberately does not claim
 *
 * §11 also asks for *"queued mutations named"*. There is no mutation queue and no
 * mutation in this surface — the shell reads bootstrap and navigates. Rendering
 * "0 changes waiting to sync" would be inventing a mechanism, and a reassurance the
 * product cannot honour is worse than silence. The copy says what is true: you are
 * offline, and what you can see is what already loaded. When the first mutation
 * lands, the count goes here.
 *
 * ### `navigator.onLine` is a floor, not a truth
 *
 * It reports whether the machine has *a* network interface, not whether the API is
 * reachable — a captive portal reads as online. So this indicator is deliberately
 * one-directional in what it asserts: `false` reliably means offline, `true` means
 * "not obviously offline". It is worth having anyway, because the case it catches
 * — a laptop lid closed on a train — is the common one, and the alternative signal
 * (a failed request) is what `ErrorState` already reports per request.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function getSnapshot(): boolean {
  return navigator.onLine
}

/**
 * `true` on the server snapshot. There is no server render here, but
 * `useSyncExternalStore` requires the third argument under React 19's types, and
 * assuming online is the assumption that renders nothing rather than a false alarm.
 */
function getServerSnapshot(): boolean {
  return true
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function ConnectionStatus() {
  const online = useIsOnline()

  /**
   * Nothing is mounted while online, which is what makes the announcement work.
   *
   * A `role="status"` present from mount is a live region that some screen readers
   * re-announce on every route change; a region that *appears* when the condition
   * does announces exactly once, when it becomes true. So the early return is the
   * accessibility behaviour, not just an optimisation.
   */
  if (online) return null

  return (
    <StatusStrip data-slot="connection-status" role="status" icon={CloudOff}>
      You are offline. Everything on screen already loaded; changes will not save.
    </StatusStrip>
  )
}
