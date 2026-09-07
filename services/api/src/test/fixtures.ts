import { uuidv7 } from '@flux/contracts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Two tenants, minted fresh per run.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `@flux/db-tests` seeds *fixed* ids, deliberately, so a failure message can name
 * the tenant that leaked rather than printing two random UUIDs. This suite does the
 * opposite, and the reason is that both suites run against **one database**.
 *
 * Two suites with fixed ids sharing a container is a teardown race: whichever
 * finishes first deletes rows the other is still asserting on, and it surfaces as
 * an intermittent failure in whichever file happened to be running. A flaky
 * integration suite gets skipped, and a skipped integration suite returns this
 * repository to having none — so the ids are minted instead, and the *diagnosability*
 * that fixed ids buy is recovered a different way: `describeTenants()` prints the
 * mapping once, and every assertion here names the tenant in its message.
 *
 * UUIDv7 rather than v4 because that is what the product mints (`ids.ts`), and a
 * fixture whose id sorts differently from a real one is a fixture that can hide an
 * ordering bug.
 *
 * ### Two organizations, not one
 *
 * `ORG_B` exists solely to be invisible. Every isolation assertion in this suite is
 * "A cannot see B", and a suite with one tenant cannot make that assertion at all —
 * it can only prove that a query returned rows, which is also what a completely
 * broken RLS policy does.
 */

/** One tenant's seeded graph. Every id the integration tests need to address. */
export interface Tenant {
  readonly label: 'A' | 'B'
  readonly org: string
  readonly slug: string
  readonly user: string
  readonly email: string
  readonly project: string
  readonly projectKey: string
  readonly workflow: string
  readonly todoState: string
  readonly issueType: string
  readonly issue: string
  readonly issueKey: string
  readonly issueSummary: string
}

/**
 * A slug/key suffix unique to this run, so a container holding leftovers from an
 * interrupted run does not collide on `organizations.slug` or `projects.key`.
 *
 * Derived from the org id rather than from a counter or a timestamp: the id is
 * already unique per run, and deriving means there is one source of uniqueness to
 * reason about instead of two that could disagree.
 */
function suffix(id: string): string {
  return id.replaceAll('-', '').slice(-6)
}

function mintTenant(label: 'A' | 'B'): Tenant {
  const org = uuidv7()
  const short = suffix(org)
  const lower = label.toLowerCase()
  return {
    label,
    org,
    slug: `api-${lower}-${short}`,
    user: uuidv7(),
    email: `api-${lower}-${short}@flux.test`,
    project: uuidv7(),
    // `ProjectKeySchema` is uppercase letters and digits, and the column has a
    // unique constraint per organization — but the *slug* collision above is
    // cross-org, so the suffix goes here too rather than only where it must.
    projectKey: `AP${label}${short.slice(-3).toUpperCase()}`,
    workflow: uuidv7(),
    todoState: uuidv7(),
    issueType: uuidv7(),
    issue: uuidv7(),
    issueKey: `AP${label}${short.slice(-3).toUpperCase()}-1`,
    issueSummary: `tenant ${label} issue — must never be visible to the other tenant`,
  }
}

/**
 * The seeded tenants for this run.
 *
 * Built at module load. `global-setup.ts` runs in a **different process** from the
 * tests, so these two values would be different in each — which is why the setup
 * provides its own copy through vitest's `provide`/`inject` channel and the tests
 * read it from there. This export exists for the setup process alone; a test file
 * importing it directly would get ids that were never seeded, and
 * `tenantsFromContext()` is what makes that mistake impossible to make quietly.
 */
export const TENANTS: readonly Tenant[] = [mintTenant('A'), mintTenant('B')]

export const ALL_ORGS: readonly string[] = TENANTS.map((t) => t.org)
export const ALL_USERS: readonly string[] = TENANTS.map((t) => t.user)

/** One line naming what was seeded, printed once by the setup. */
export function describeTenants(tenants: readonly Tenant[]): string {
  return tenants.map((t) => `${t.label}=${t.org} (${t.slug}, ${t.projectKey})`).join('  ')
}
