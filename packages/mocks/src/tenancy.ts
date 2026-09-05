import {
  BootstrapSchema,
  OrgMembershipSchema,
  OrganizationSchema,
  UserSchema,
  type Bootstrap,
  type OrgMembership,
  type Organization,
  type User,
} from '@flux/contracts'
import { builder } from './builder.js'
import { DAY, NOW, id, instant } from './determinism.js'

/**
 * Identity and tenancy fixtures.
 *
 * The cast of characters is fixed and reused everywhere, because a scenario
 * where every builder invents its own user makes "is this the assignee?"
 * unanswerable at a glance:
 *
 *   Ada   — org owner, the caller in almost every fixture
 *   Grace — admin, the other active person on the board
 *   Linus — member, deactivated, so "assigned to someone who left" has a
 *           subject (the case that renders a greyed-out avatar)
 */
export const USER_ADA = id<'UserId'>('user', 'ada')
export const USER_GRACE = id<'UserId'>('user', 'grace')
export const USER_LINUS = id<'UserId'>('user', 'linus')
export const ORG = id<'OrganizationId'>('org', 'northwind')

export const aUser = builder(UserSchema, () => ({
  id: USER_ADA,
  email: 'ada@northwind.example',
  displayName: 'Ada Okafor',
  avatarUrl: null,
  timezone: 'Europe/London',
  locale: 'en',
  deactivatedAt: null,
  createdAt: instant(-365 * DAY),
}))

export const anOrganization = builder(OrganizationSchema, () => ({
  id: ORG,
  slug: 'northwind',
  name: 'Northwind Logistics',
  plan: 'team',
  /**
   * `intro` deliberately. The founding-cohort price commitment is a column
   * rather than a policy (see OrganizationSchema), so the fixture that
   * every billing-adjacent screen is built against should be a customer who
   * holds that promise — it is the case most likely to be got wrong.
   */
  priceCohort: 'intro',
  tenancyModel: 'pooled',
  region: 'eu',
  seatLimit: 25,
  trialEndsAt: null,
  suspendedAt: null,
  suspendedReason: null,
  createdAt: instant(-365 * DAY),
  updatedAt: instant(-30 * DAY),
  version: 4,
}))

export const anOrgMembership = builder(OrgMembershipSchema, () => ({
  organizationId: ORG,
  userId: USER_ADA,
  role: 'owner',
  consumesSeat: true,
  displayNameOverride: null,
  jobTitle: 'Head of Engineering',
  invitedBy: null,
  joinedAt: instant(-365 * DAY),
  removedAt: null,
  createdAt: instant(-365 * DAY),
}))

export const PROJECT_LOG = id<'ProjectId'>('project', 'log')
export const PROJECT_WEB = id<'ProjectId'>('project', 'web')
export const TEAM_PLATFORM = id<'TeamId'>('team', 'platform')

export const aBootstrap = builder(BootstrapSchema, () => ({
  user: aUser(),
  organization: anOrganization(),
  membership: anOrgMembership(),
  capabilities: {
    automation: true,
    slaPolicies: true,
    crossProjectBoards: true,
    advancedReporting: false,
    aiAssist: false,
    auditLogRetentionDays: 365,
    maxProjects: null,
    maxAutomationRules: 50,
    ssoEnforced: false,
  },
  /**
   * Two organizations, so the org switcher has something to switch to. A
   * one-org fixture hides every bug in the switcher — including the common
   * one where the current org is not marked as current.
   */
  organizations: [
    { id: ORG, slug: 'northwind', name: 'Northwind Logistics', role: 'owner' },
    {
      id: id<'OrganizationId'>('org', 'contoso'),
      slug: 'contoso',
      name: 'Contoso Freight',
      role: 'guest',
    },
  ],
  projects: [
    { id: PROJECT_LOG, key: 'LOG', name: 'Logistics Platform', avatarUrl: null, isFavourite: true },
    { id: PROJECT_WEB, key: 'WEB', name: 'Customer Web', avatarUrl: null, isFavourite: false },
  ],
  teams: [{ id: TEAM_PLATFORM, key: 'platform', name: 'Platform' }],
  orgPermissions: {
    canManageOrganization: true,
    canManageMembers: true,
    canManageFields: true,
    canCreateProject: true,
    canViewAuditLog: true,
    canRunImport: true,
    canRunExport: true,
  },
  serverTime: NOW,
}))

/**
 * The caller as a member rather than an owner, which is the permission set
 * most screens will actually be used under.
 *
 * Provided as a named fixture rather than left to each test's overrides
 * because "every boolean false" is not the interesting case — a member can
 * create projects here and cannot manage members, and getting that mix right
 * once is worth more than eleven tests each guessing at it.
 */
export function aMemberBootstrap(): Bootstrap {
  return aBootstrap({
    membership: { role: 'member', jobTitle: 'Engineer' },
    orgPermissions: {
      canManageOrganization: false,
      canManageMembers: false,
      canManageFields: false,
      canCreateProject: true,
      canViewAuditLog: false,
      canRunImport: false,
      canRunExport: true,
    },
  })
}

export type { Bootstrap, OrgMembership, Organization, User }
