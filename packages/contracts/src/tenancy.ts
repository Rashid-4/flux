import { z } from 'zod'
import { ActorKindSchema, AuditStampSchema, InstantSchema, LocalDateSchema } from './common.js'
import {
  OrganizationIdSchema,
  ProjectIdSchema,
  ProjectKeySchema,
  TeamIdSchema,
  TeamKeySchema,
  UserIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Organizations, users, memberships, teams — and the tenancy contract.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Multi-tenancy is enforced in PostgreSQL by Row-Level Security, not by
 * application WHERE clauses (docs/adr/0003-postgres-rls-multitenancy.md).
 * The application connects as `flux_app`, a role with NOBYPASSRLS, and sets
 * `flux.organization_id` per transaction. A handler that forgets to filter
 * returns nothing rather than everything — the failure mode is a bug report,
 * not a breach.
 *
 * The one deliberate exception is `users`: identity is GLOBAL, because a
 * consultant may legitimately belong to four customer organizations with one
 * login. `users` therefore holds no tenant data beyond name, email and
 * avatar, and everything tenant-specific lives on `org_memberships`, which
 * IS RLS-protected. This is documented in db/migrations/0002 as well,
 * because a future reader will otherwise "fix" it and break cross-org login.
 */

// ── Organization ─────────────────────────────────────────────────────

/**
 * Commercial plans. `trial` is a real plan and not a flag: a trial has an
 * end date, a seat limit, and a set of capabilities, and treating it as
 * "no plan yet" is how trials silently become free forever.
 *
 * Mirrors organizations_plan_valid. scripts/check-enum-drift.mjs fails CI
 * if the two lists diverge.
 */
export const PlanSchema = z.enum(['trial', 'starter', 'team', 'business', 'enterprise'])
export type Plan = z.infer<typeof PlanSchema>

/**
 * Where a tenant's rows physically live. Pooled tenants share tables and
 * are separated by RLS; a tenant that outgrows that gets its own schema or
 * instance. This is an isolation decision, not a geographic one.
 */
export const TenancyModelSchema = z.enum(['pooled', 'dedicated_schema', 'dedicated_instance'])
export type TenancyModel = z.infer<typeof TenancyModelSchema>

/** Data residency region. Geography, unrelated to TenancyModel. */
export const RegionSchema = z.enum(['eu', 'us', 'ap'])
export type Region = z.infer<typeof RegionSchema>

export const OrganizationSchema = AuditStampSchema.extend({
  id: OrganizationIdSchema,
  /** Subdomain-safe slug. Immutable once issued: it appears in URLs that
   *  end up in bookmarks, Slack messages and SSO configurations. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  name: z.string().min(1).max(160),
  plan: PlanSchema,
  /**
   * THE GRANDFATHERING COMMITMENT, ENCODED IN THE SCHEMA.
   *
   * The go-to-market strategy is deliberate under-pricing to win the first
   * cohort of teams, with prices rising for later cohorts once the product
   * has earned it. That promise is worth nothing if it lives only in a blog
   * post: the moment pricing changes, the billing code has to know which
   * customers were promised what.
   *
   * Every organization is stamped with the cohort it joined in. Price
   * resolution reads this column and never reads the current list price for
   * an existing customer. Making it a column rather than a policy means
   * breaking the promise would require a migration someone has to sign off
   * on — which is exactly the friction we want.
   *
   * `intro` is the founding cohort — the one promised the launch price
   * indefinitely. Later cohorts are stamped with the quarter or half they
   * joined in, so a price rise can be scoped to "2027-Q1 onwards" without
   * anyone having to reconstruct who was told what.
   */
  priceCohort: z.string().regex(/^(intro|\d{4}-(Q[1-4]|H[12]))$/),
  /** Isolation model. See TenancyModelSchema — this is not geography. */
  tenancyModel: TenancyModelSchema,
  /** Data residency region. Chosen at creation; changing it is a migration. */
  region: RegionSchema,
  seatLimit: z.number().int().positive().nullable(),
  /** Trials end; they do not silently convert to a paid plan. */
  trialEndsAt: InstantSchema.nullable(),
  suspendedAt: InstantSchema.nullable(),
  suspendedReason: z.string().nullable(),
})
export type Organization = z.infer<typeof OrganizationSchema>

/**
 * Feature flags resolved per organization. Returned with the bootstrap
 * payload so the SPA renders the correct product on first paint instead of
 * flickering features in as capability checks resolve.
 */
export const OrgCapabilitiesSchema = z.object({
  automation: z.boolean(),
  slaPolicies: z.boolean(),
  crossProjectBoards: z.boolean(),
  advancedReporting: z.boolean(),
  aiAssist: z.boolean(),
  auditLogRetentionDays: z.number().int(),
  maxProjects: z.number().int().nullable(),
  maxAutomationRules: z.number().int().nullable(),
  ssoEnforced: z.boolean(),
})
export type OrgCapabilities = z.infer<typeof OrgCapabilitiesSchema>

// ── Users and membership ─────────────────────────────────────────────

export const UserSchema = z.object({
  id: UserIdSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(160),
  avatarUrl: z.string().nullable(),
  /** IANA zone. Drives due-date boundaries and digest send times — a
   *  "due today" badge that uses server time is wrong for most of the org. */
  timezone: z.string().default('UTC'),
  locale: z.string().default('en'),
  /** Global deactivation. Distinct from losing membership of one org. */
  deactivatedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
})
export type User = z.infer<typeof UserSchema>

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member', 'guest'])
export type OrgRole = z.infer<typeof OrgRoleSchema>

/**
 * Deliberately has no surrogate id. The row is identified by
 * (organizationId, userId), which is also its primary key — a synthetic id
 * would make two memberships for the same pair representable, and nothing
 * in the product knows what that would mean.
 */
export const OrgMembershipSchema = z.object({
  organizationId: OrganizationIdSchema,
  userId: UserIdSchema,
  role: OrgRoleSchema,
  /**
   * Whether this membership counts against the seat limit. Guests and
   * bot/service accounts do not. Billing reads this column, so a customer's
   * invoice can always be explained by a query rather than by trust.
   */
  consumesSeat: z.boolean(),
  /** Per-org display override, for consultants who present differently. */
  displayNameOverride: z.string().max(160).nullable(),
  jobTitle: z.string().max(120).nullable(),
  invitedBy: UserIdSchema.nullable(),
  joinedAt: InstantSchema.nullable(),
  /** Membership is revoked, not deleted: authorship history must survive. */
  removedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
})
export type OrgMembership = z.infer<typeof OrgMembershipSchema>

/** A user as the product renders them — the shape embedded in read models. */
export const UserRefSchema = z.object({
  id: UserIdSchema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  /** True for removed/deactivated users, so the UI can grey them out
   *  instead of showing a name that can no longer be assigned work. */
  isInactive: z.boolean().default(false),
})
export type UserRef = z.infer<typeof UserRefSchema>

export const InviteMembersSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(200),
  role: OrgRoleSchema.default('member'),
  teamIds: z.array(TeamIdSchema).default([]),
  /** Add invitees to these projects' default role on acceptance. */
  projectIds: z.array(ProjectIdSchema).default([]),
  message: z.string().max(1000).optional(),
})

// ── Teams ────────────────────────────────────────────────────────────

/**
 * Teams are the unit that keeps permissions and capacity from decaying.
 * Grants target teams; capacity is computed per team; boards belong to
 * teams. Someone joining the platform team therefore gets the right access
 * and appears in the right forecast without an admin editing twelve
 * projects — the maintenance burden that makes long-lived Jira instances
 * unmanageable.
 */
export const TeamSchema = AuditStampSchema.extend({
  id: TeamIdSchema,
  key: TeamKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable(),
  leadUserId: UserIdSchema.nullable(),
  /** Parent in the team hierarchy. What makes a group-level roll-up a query
   *  rather than a hand-maintained list in a dashboard config. */
  parentTeamId: TeamIdSchema.nullable(),
  /** ISO weekday numbers, 1 = Monday. Drives working-day capacity maths and
   *  SLA clocks, so a team working Sun–Thu is a configuration, not a bug. */
  workingDays: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
  /** IANA zone used for the team's SLA calendar and sprint boundaries. */
  timezone: z.string().default('UTC'),
  /** Nominal hours per person per working day. */
  hoursPerDay: z.number().min(0).max(24).default(8),
  archivedAt: InstantSchema.nullable(),
})
export type Team = z.infer<typeof TeamSchema>

export const TeamRoleSchema = z.enum(['lead', 'member'])
export type TeamRole = z.infer<typeof TeamRoleSchema>

/** No surrogate id, for the same reason as OrgMembershipSchema. */
export const TeamMembershipSchema = z.object({
  teamId: TeamIdSchema,
  userId: UserIdSchema,
  /**
   * Fraction of this person's time on this team, 0–1. Someone split across
   * two teams is 0.5 in each, and capacity planning uses the number instead
   * of counting heads. Counting heads is why so many sprint plans are
   * quietly 40% over capacity from the first day.
   *
   * Strictly greater than zero: a 0% allocation is not a membership, it is
   * an absence, and it belongs in user_availability where the capacity
   * maths already handles it.
   */
  allocation: z.number().gt(0).max(1).default(1),
  role: TeamRoleSchema.default('member'),
  createdAt: InstantSchema,
  /** Set instead of deleting the row: capacity and velocity for a closed
   *  sprint are computed from who was on the team then. */
  leftAt: InstantSchema.nullable(),
})
export type TeamMembership = z.infer<typeof TeamMembershipSchema>

// ── Bootstrap payload ────────────────────────────────────────────────

/**
 * The single call the SPA makes on load. One round trip instead of six
 * (me → org → capabilities → projects → teams → preferences), because
 * six sequential requests on a cold connection is most of the difference
 * between an app that feels instant and one that doesn't.
 */
export const BootstrapSchema = z.object({
  user: UserSchema,
  organization: OrganizationSchema,
  membership: OrgMembershipSchema,
  capabilities: OrgCapabilitiesSchema,
  /** Every org this identity can switch into, for the org switcher. */
  organizations: z.array(
    z.object({ id: OrganizationIdSchema, slug: z.string(), name: z.string(), role: OrgRoleSchema }),
  ),
  /** Projects the caller can see, already permission-filtered. */
  projects: z.array(
    z.object({
      id: ProjectIdSchema,
      key: ProjectKeySchema,
      name: z.string(),
      avatarUrl: z.string().nullable(),
      isFavourite: z.boolean(),
    }),
  ),
  teams: z.array(z.object({ id: TeamIdSchema, key: TeamKeySchema, name: z.string() })),
  /** Org-level permissions only. Project-level ones come with the project. */
  orgPermissions: z.object({
    canManageOrganization: z.boolean(),
    canManageMembers: z.boolean(),
    canManageFields: z.boolean(),
    canCreateProject: z.boolean(),
    canViewAuditLog: z.boolean(),
    canRunImport: z.boolean(),
    canRunExport: z.boolean(),
  }),
  /** Server time, so the client can detect and correct for clock skew
   *  rather than rendering "due in -3 hours" on a laptop with a bad clock. */
  serverTime: InstantSchema,
})
export type Bootstrap = z.infer<typeof BootstrapSchema>

// ── Audit log ────────────────────────────────────────────────────────

/**
 * Tamper-evident audit trail. Each entry hashes the previous entry's hash,
 * so removing or editing history breaks the chain verifiably
 * (`flux_verify_audit_chain` in db/migrations/0009).
 *
 * `before`/`after` hold full entity state rather than a diff. That is more
 * storage, and it buys two things a diff cannot: an accidental
 * misconfiguration can be reverted mechanically (`revertsSeq`), and an
 * auditor can see what a record actually looked like at a point in time
 * without replaying every prior entry.
 */
/**
 * `login` and `export` are audited actions even though they modify no
 * entity: "who looked at this and who took a copy" is the first question in
 * every access review, and it is unanswerable from create/update/delete
 * alone.
 */
export const AuditActionSchema = z.enum([
  'create',
  'update',
  'delete',
  'archive',
  'restore',
  'publish',
  'promote',
  'revert',
  'login',
  'export',
])
export type AuditAction = z.infer<typeof AuditActionSchema>

export const AuditEntrySchema = z.object({
  seq: z.number().int().positive(),
  organizationId: OrganizationIdSchema,
  entityType: z.string(),
  entityId: z.string().uuid(),
  entityLabel: z.string().nullable(),
  action: AuditActionSchema,
  actorUserId: UserIdSchema.nullable(),
  actorKind: ActorKindSchema,
  actorLabel: z.string().nullable(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  /** Set when this entry undoes an earlier one — makes "undo that change"
   *  a first-class, audited operation rather than a manual reconstruction. */
  revertsSeq: z.number().int().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  traceId: z.string().nullable(),
  entryHash: z.string(),
  previousHash: z.string().nullable(),
  createdAt: InstantSchema,
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

export const AuditChainVerificationSchema = z.object({
  organizationId: OrganizationIdSchema,
  entriesChecked: z.number().int(),
  /** Non-empty means the log was altered outside the append path. Treated
   *  as a security incident, not a data-quality issue. */
  brokenAt: z.array(z.object({ seq: z.number().int(), reason: z.string() })),
  verifiedAt: InstantSchema,
})

// ── Availability (org-level, consumed by capacity planning) ──────────

/**
 * Absence kinds. `other` exists on purpose: an absence that fits no
 * category still has to be recordable, and without an escape hatch it gets
 * filed as the nearest wrong one, which quietly corrupts capacity.
 */
export const AvailabilityKindSchema = z.enum([
  'time_off',
  'holiday',
  'reduced',
  'onboarding',
  'other',
])
export type AvailabilityKind = z.infer<typeof AvailabilityKindSchema>

export const CreateAvailabilitySchema = z
  .object({
    userId: UserIdSchema,
    startsOn: LocalDateSchema,
    endsOn: LocalDateSchema,
    kind: AvailabilityKindSchema,
    /**
     * Fraction of capacity *lost*. 1 is a full absence, 0.5 is a half day.
     * Strictly greater than zero because a reduction of nothing is not a
     * record worth keeping, and the column's CHECK agrees.
     */
    reduction: z.number().gt(0).max(1).default(1),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.startsOn <= v.endsOn, { message: 'startsOn must not be after endsOn' })
