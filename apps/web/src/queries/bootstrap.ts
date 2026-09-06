import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Bootstrap } from '@flux/contracts'
import { getBootstrap } from '../api/bootstrap'
import { keys } from './keys'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The bootstrap query, and the clock the whole app renders against.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/specs/web/README.md §4: one request, and the shell renders after it. Not
 * six, and not progressively-with-skeletons for things bootstrap already
 * returned. Everything the shell needs to draw itself — user, organization,
 * membership, capabilities, the org list, permission-filtered projects, teams,
 * org permission booleans and `serverTime` — arrives together.
 *
 * Two rules from §4 are enforced by what this file does *not* export. There is no
 * `useCanManageMembers()` that reads `membership.role`, because *"permission
 * booleans come from bootstrap, never from a local guess"* — read
 * `orgPermissions.canManageMembers` off the query. And there is no helper that
 * returns "the current organization" from anywhere other than this response,
 * because that is the only place it is authoritative.
 */

/**
 * How long bootstrap is served without a background refetch.
 *
 * Five minutes, against the shell's thirty-second default, because of what is in
 * here: the org list, the project list and the permission booleans. Those change
 * when an admin changes them — rarely, and never as a side effect of the user's
 * own work — so refetching them every thirty seconds spends a request per tab per
 * half-minute to observe nothing.
 *
 * The staleness this accepts is bounded by something better than a timer:
 * §4 says *"hiding a control is not authorization"*, and the server is the check.
 * A permission revoked four minutes ago leaves a menu item visible that answers
 * `permission_denied` when pressed — which §7 renders as a real explanation naming
 * the permission, and which the shell must handle whatever this number is.
 */
export const BOOTSTRAP_STALE_TIME_MS = 5 * 60_000

/**
 * `queryOptions` rather than a bare `useQuery` call, so the same definition can be
 * handed to `useQuery`, `prefetchQuery` and `ensureQueryData` and stay one
 * definition. A route that wants the shell's data before it renders needs the
 * last of those, and the alternative — a second copy of the key and the fetcher
 * inside a loader — is exactly the drift ./keys.ts exists to prevent.
 */
export function bootstrapQueryOptions() {
  return queryOptions({
    queryKey: keys.bootstrap(),
    /**
     * The signal is forwarded, not ignored. TanStack aborts a query it has
     * abandoned, and `request.ts` turns that into the caller's own abort reason
     * rather than an error — so a remount during a slow bootstrap cancels the
     * first request instead of racing it.
     */
    queryFn: ({ signal }) => getBootstrap(signal),
    staleTime: BOOTSTRAP_STALE_TIME_MS,
  })
}

export function useBootstrap(): UseQueryResult<Bootstrap> {
  return useQuery(bootstrapQueryOptions())
}

/**
 * Milliseconds to add to this machine's clock to get the server's.
 *
 * §4: *"All time rendering is relative to `serverTime`. Compute the offset once at
 * bootstrap and apply it everywhere. A laptop with a bad clock otherwise renders
 * 'due in -3 hours', which reads as a bug in the product."*
 *
 * `receivedAtMs` is when this client received the response. It is deliberately a
 * parameter rather than a `Date.now()` inside the function: called later, that
 * would fold every millisecond since the response into the offset and grow
 * without bound as the tab stays open.
 *
 * The round trip is **not** corrected for. A one-timestamp offset attributes the
 * whole inbound latency to clock skew, so the server appears some tens of
 * milliseconds in the past. Correcting it needs a second timestamp and an
 * assumption that the two legs are symmetric, and the thing being rendered is
 * "3 days ago" and "due in 4 hours" — human-scale durations where a hundred
 * milliseconds is not observable. The failure this exists to prevent is a clock
 * that is wrong by hours, not by a network hop.
 */
export function serverTimeOffsetMs(serverTime: string, receivedAtMs: number): number {
  const parsed = Date.parse(serverTime)
  /**
   * `InstantSchema` is `z.string().datetime({ offset: true })` and the response
   * has already been through it, so this cannot fire today. It is here because of
   * what happens if it ever does: `NaN` would propagate through every date in the
   * app and render "Invalid Date" everywhere, turning one bad field into a UI that
   * looks entirely broken. Falling back to no correction degrades to the local
   * clock, which is right for the overwhelming majority of users.
   */
  if (Number.isNaN(parsed)) return 0
  return parsed - receivedAtMs
}

/**
 * The offset for the current session, or `null` before bootstrap has resolved.
 *
 * `null` rather than `0`. Zero is a meaningful offset — it means the clocks agree
 * — so returning it for "not known yet" would make a component silently render
 * against the local clock and be right almost always, which is how a skew bug
 * survives testing. Under §4 the shell does not render before bootstrap resolves,
 * so a component asking for this inside the shell never sees `null`; anything that
 * does see it is outside the shell and has to say what it wants to do about it.
 *
 * `dataUpdatedAt` is TanStack's own record of when the data was written into the
 * cache, which is the receipt time this needs — so the offset is derived from the
 * query result on each render and no second copy of it exists anywhere. §5's rule
 * about server state not being duplicated into a store applies to a
 * module-level `let offset` just as much as it applies to Zustand.
 */
export function useServerTimeOffsetMs(): number | null {
  const { data, dataUpdatedAt } = useBootstrap()
  if (data === undefined) return null
  return serverTimeOffsetMs(data.serverTime, dataUpdatedAt)
}

/** The server's current time, as a timestamp, given an offset from above. */
export function serverNowMs(offsetMs: number, localNowMs: number = Date.now()): number {
  return localNowMs + offsetMs
}
