import { BootstrapSchema, type Bootstrap } from '@flux/contracts'
import { request } from './request'

/**
 * `GET /bootstrap` — the one call the app makes on load.
 *
 * docs/specs/api/identity.md §3: one call, and it must stay one call. It returns
 * the user, the organization, the membership, capabilities, the org list for the
 * switcher, permission-filtered projects, teams, org-level permission booleans
 * and `serverTime`. The alternative is six sequential requests, each waiting on
 * the last, which on a cold connection is most of the difference between an app
 * that feels instant and one that visibly assembles itself.
 *
 * Two consequences for anything that consumes this, both from
 * docs/specs/web/README.md §4:
 *
 * - **The shell renders after this one request.** Not after six, and not
 *   progressively-with-skeletons for things this payload already returned.
 * - **Permission booleans are read, never inferred.** Use
 *   `orgPermissions.canManageMembers`; do not derive it from `membership.role`.
 *   `evaluatePermission()` lives in the contracts and the server calls it — the
 *   client's job is to render the answer, not to compute a second one that
 *   eventually disagrees and shows a button that 403s.
 *
 * `serverTime` is why the payload is worth reaching for even when a screen only
 * needs one field from it: every relative time in the product is computed against
 * it rather than against the browser clock, so a laptop an hour fast does not
 * render "due in −3 hours" and read as a bug in the product.
 */
export async function getBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  return BootstrapSchema.parse(await request('GET', '/bootstrap', { signal }))
}
