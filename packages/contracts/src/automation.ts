import { z } from 'zod'
import { AuditStampSchema, InstantSchema } from './common.js'
import { FilterNodeSchema, RelativeDateSchema } from './query.js'
import { EventTypeSchema } from './events.js'
import {
  AutomationRuleIdSchema,
  IssueIdSchema,
  IssueKeySchema,
  ProjectIdSchema,
  UserIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Automation (Phase 2) — event-driven, simulatable, and observable.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three things Jira's automation gets wrong, and what this contract does
 * about each:
 *
 * 1. NO DRY RUN. In Jira you enable a rule and find out what it does by
 *    watching it happen to real tickets. Here every rule can be simulated
 *    against historical events (`SimulateRuleSchema`), producing the exact
 *    list of issues it WOULD have touched and the changes it WOULD have
 *    made — with nothing written. Simulation runs the same executor as the
 *    real path with a no-op sink, so a simulation that passes is meaningful.
 *
 * 2. OPAQUE FAILURES AND SILENT THROTTLING. Rules hit undocumented
 *    execution limits and quietly stop. Every run here is recorded in
 *    `AutomationRunSchema` with per-action outcomes, duration, and the
 *    triggering event id, and a rule that starts failing raises
 *    `automation.rule_failed` — which can itself notify someone.
 *
 * 3. INFINITE LOOPS. Rule A edits an issue, which triggers rule B, which
 *    triggers rule A. Flux carries a causation chain on every event and
 *    refuses to execute past `MAX_CAUSATION_DEPTH`, recording a
 *    `loop_detected` outcome instead of thrashing the database.
 *
 * Rules run OFF the event stream in Temporal, never on the write path. An
 * org with 300 rules must not have slower issue creation than an org with
 * none — that coupling is exactly why heavily-configured Jira instances
 * crawl.
 */

/** Hard stop on rule-triggers-rule chains. */
export const MAX_CAUSATION_DEPTH = 10

// ── Triggers ─────────────────────────────────────────────────────────

export const AutomationTriggerSchema = z.discriminatedUnion('kind', [
  /** Fires on a domain event. The common case. */
  z.object({
    kind: z.literal('event'),
    eventTypes: z.array(EventTypeSchema).min(1),
  }),
  /** Cron-like. Runs against a filter, not an event. */
  z.object({
    kind: z.literal('schedule'),
    /** Standard 5-field cron, interpreted in `timezone`. */
    cron: z.string().min(9).max(100),
    timezone: z.string().default('UTC'),
    /** Which issues the scheduled run operates on. */
    filter: FilterNodeSchema,
    /** Guard rail: refuse to run if the filter matches more than this. */
    maxIssuesPerRun: z.number().int().positive().max(5000).default(500),
  }),
  /**
   * Fires when an issue has been in its current state longer than a
   * threshold. Implemented with Temporal timers rather than a polling scan,
   * so a 90-day SLA does not mean a nightly full-table sweep.
   */
  z.object({
    kind: z.literal('field_unchanged_for'),
    field: z.string(),
    duration: RelativeDateSchema,
    filter: FilterNodeSchema.nullable(),
  }),
  /** Explicit human trigger — a button on the issue view. */
  z.object({
    kind: z.literal('manual'),
    buttonLabel: z.string().min(1).max(40),
    requiresConfirmation: z.boolean().default(false),
  }),
  /** Inbound webhook with a shared secret. */
  z.object({
    kind: z.literal('incoming_webhook'),
    /** Vault reference. The secret itself is never stored on this row. */
    secretRef: z.string().min(1),
  }),
])
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>

// ── Actions ──────────────────────────────────────────────────────────

/**
 * Template strings may reference `{{issue.key}}`, `{{issue.summary}}`,
 * `{{actor.displayName}}` and similar. Rendering is a closed, sandboxed
 * substitution over a known context object — NOT an expression language.
 * A rule author must not be able to reach the database or the network
 * through a template.
 */
export const TemplateStringSchema = z.string().max(10_000)

export const AutomationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transition_issue'), toStateFamilyId: z.string().uuid() }),
  z.object({
    kind: z.literal('assign_issue'),
    target: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('user'), userId: UserIdSchema }),
      z.object({ mode: z.literal('reporter') }),
      z.object({ mode: z.literal('project_lead') }),
      z.object({ mode: z.literal('component_lead') }),
      z.object({ mode: z.literal('unassign') }),
      /**
       * Round-robin / least-busy across a role or team. State is kept per
       * rule so distribution is genuinely balanced rather than random.
       */
      z.object({
        mode: z.literal('balanced'),
        pool: z.discriminatedUnion('from', [
          z.object({ from: z.literal('project_role'), roleKey: z.string() }),
          z.object({ from: z.literal('team'), teamId: z.string().uuid() }),
        ]),
        strategy: z.enum(['round_robin', 'least_open_issues', 'least_points']),
        /** Skip people who are on PTO — availability data made useful. */
        respectAvailability: z.boolean().default(true),
      }),
    ]),
  }),
  z.object({ kind: z.literal('set_field'), fieldKey: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal('clear_field'), fieldKey: z.string() }),
  z.object({ kind: z.literal('add_labels'), labels: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('remove_labels'), labels: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('add_comment'), body: TemplateStringSchema, isInternal: z.boolean().default(false) }),
  z.object({
    kind: z.literal('create_issue'),
    projectId: ProjectIdSchema,
    issueTypeKey: z.string(),
    summary: TemplateStringSchema,
    description: TemplateStringSchema.optional(),
    /** Link the new issue back to the trigger issue. */
    linkToTrigger: z.enum(['none', 'blocks', 'relates_to', 'child_of']).default('relates_to'),
    inheritFields: z.array(z.string()).default([]),
  }),
  z.object({ kind: z.literal('link_issues'), targetFilter: FilterNodeSchema, linkType: z.string() }),
  z.object({
    kind: z.literal('notify'),
    recipients: z.array(
      z.discriminatedUnion('to', [
        z.object({ to: z.literal('user'), userId: UserIdSchema }),
        z.object({ to: z.literal('assignee') }),
        z.object({ to: z.literal('reporter') }),
        z.object({ to: z.literal('watchers') }),
        z.object({ to: z.literal('project_role'), roleKey: z.string() }),
        z.object({ to: z.literal('team'), teamId: z.string().uuid() }),
      ]),
    ).min(1),
    subject: TemplateStringSchema,
    body: TemplateStringSchema,
    channels: z.array(z.enum(['email', 'in_app', 'slack', 'webhook'])).min(1),
  }),
  z.object({
    kind: z.literal('call_webhook'),
    /**
     * Destination must resolve to a public address. The API rejects
     * private/link-local/loopback ranges at save time AND re-resolves at
     * call time, because a hostname that resolved publicly yesterday can be
     * repointed at an internal service today — that is the SSRF path.
     */
    url: z.string().url(),
    method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
    /** Vault reference for auth headers; secrets never live on this row. */
    credentialRef: z.string().nullable().default(null),
    bodyTemplate: TemplateStringSchema.optional(),
    timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  }),
  /**
   * Sub-rule branch: run these actions against a RELATED set of issues
   * (subtasks, parent, linked). Bounded to one level of nesting so a rule's
   * cost stays predictable.
   */
  z.object({
    kind: z.literal('for_each_related'),
    relation: z.enum(['subtasks', 'parent', 'children', 'blocks', 'blocked_by', 'linked']),
    filter: FilterNodeSchema.nullable(),
    maxIssues: z.number().int().positive().max(200).default(50),
    actions: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('transition_issue'), toStateFamilyId: z.string().uuid() }),
        z.object({ kind: z.literal('set_field'), fieldKey: z.string(), value: z.unknown() }),
        z.object({ kind: z.literal('add_comment'), body: TemplateStringSchema, isInternal: z.boolean().default(false) }),
        z.object({ kind: z.literal('add_labels'), labels: z.array(z.string()).min(1) }),
      ]),
    ).min(1),
  }),
])
export type AutomationAction = z.infer<typeof AutomationActionSchema>

// ── Rule ─────────────────────────────────────────────────────────────

export const AutomationRuleSchema = AuditStampSchema.extend({
  id: AutomationRuleIdSchema,
  /** Null = org-wide rule; requires an explicit org-admin permission. */
  projectIds: z.array(ProjectIdSchema),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable(),
  enabled: z.boolean(),
  trigger: AutomationTriggerSchema,
  /** Additional guard on the triggering issue. Evaluated before actions. */
  condition: FilterNodeSchema.nullable(),
  actions: z.array(AutomationActionSchema).min(1).max(20),
  /**
   * Who the rule acts as. Actions are attributed to this user in history so
   * "who changed this?" always has an answer — but the rule is also
   * permission-checked as this user, so a rule cannot be used to escalate
   * beyond what its owner may do.
   */
  runAsUserId: UserIdSchema,
  /**
   * When false, changes made by this rule do not trigger other rules.
   * Default false: chained automation is powerful and also the single
   * easiest way to build an accidental loop, so it is opt-in.
   */
  allowTriggeringOtherRules: z.boolean().default(false),
  /** Per-hour cap. Exceeding it disables the rule and notifies its owner
   *  rather than silently dropping executions. */
  maxExecutionsPerHour: z.number().int().positive().max(10_000).default(1_000),
  /** Health, maintained from run records. */
  lastRunAt: InstantSchema.nullable(),
  lastFailureAt: InstantSchema.nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  disabledReason: z
    .enum(['manual', 'rate_limit_exceeded', 'repeated_failures', 'loop_detected', 'invalid_configuration'])
    .nullable(),
})
export type AutomationRule = z.infer<typeof AutomationRuleSchema>

export const CreateAutomationRuleSchema = AutomationRuleSchema.pick({
  name: true,
  description: true,
  projectIds: true,
  trigger: true,
  condition: true,
  actions: true,
  runAsUserId: true,
  allowTriggeringOtherRules: true,
  maxExecutionsPerHour: true,
}).extend({
  /**
   * New rules start disabled. The intended flow is create → simulate →
   * review → enable. Defaulting to enabled means the first thing a new
   * rule does is run against production before anyone has seen its output.
   */
  enabled: z.boolean().default(false),
})

// ── Runs and observability ───────────────────────────────────────────

export const ActionOutcomeSchema = z.object({
  actionIndex: z.number().int().nonnegative(),
  actionKind: z.string(),
  status: z.enum(['succeeded', 'skipped', 'failed']),
  /** Present for skips: 'condition_not_met', 'no_permission', 'no_targets'. */
  reason: z.string().nullable(),
  /** Issues actually affected by this action. */
  affectedIssueIds: z.array(IssueIdSchema),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
})
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>

export const AutomationRunSchema = z.object({
  id: z.string().uuid(),
  ruleId: AutomationRuleIdSchema,
  ruleName: z.string(),
  /** The event that caused this run; null for scheduled/manual triggers. */
  triggerEventId: z.string().uuid().nullable(),
  triggerIssueId: IssueIdSchema.nullable(),
  status: z.enum(['succeeded', 'partial', 'failed', 'skipped', 'loop_blocked']),
  /** Depth in the rule-triggers-rule chain. Refused past MAX_CAUSATION_DEPTH. */
  causationDepth: z.number().int().nonnegative(),
  simulated: z.boolean(),
  outcomes: z.array(ActionOutcomeSchema),
  startedAt: InstantSchema,
  durationMs: z.number().int().nonnegative(),
  /** Ties the run to the originating request in traces and logs. */
  traceId: z.string().nullable(),
})
export type AutomationRun = z.infer<typeof AutomationRunSchema>

/**
 * Simulation request. `against` decides what the rule is replayed over:
 * historical events give an honest answer about a busy rule ("this would
 * have touched 412 issues last month"), while an explicit issue list is
 * better for checking one specific case.
 */
export const SimulateRuleSchema = z.object({
  rule: CreateAutomationRuleSchema,
  against: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('historical_events'),
      since: RelativeDateSchema,
      maxEvents: z.number().int().positive().max(10_000).default(1_000),
    }),
    z.object({ mode: z.literal('issues'), issueIds: z.array(IssueIdSchema).min(1).max(500) }),
    z.object({ mode: z.literal('filter'), filter: FilterNodeSchema, maxIssues: z.number().int().max(500).default(100) }),
  ]),
})

export const SimulationReportSchema = z.object({
  ruleName: z.string(),
  matchedCount: z.number().int(),
  evaluatedCount: z.number().int(),
  /** Per-issue preview of the exact changes the rule would have made. */
  wouldAffect: z.array(
    z.object({
      issueId: IssueIdSchema,
      issueKey: IssueKeySchema,
      summary: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          fromDisplay: z.string().nullable(),
          toDisplay: z.string().nullable(),
        }),
      ),
      sideEffects: z.array(z.string()),
    }),
  ),
  /** Problems found without running anything: bad field keys, unreachable
   *  transitions, actions the runAs user lacks permission for. */
  problems: z.array(
    z.object({
      severity: z.enum(['error', 'warning']),
      code: z.enum([
        'unknown_field',
        'unreachable_transition',
        'missing_permission',
        'private_webhook_target',
        'possible_loop',
        'no_matching_issues',
        'high_volume',
      ]),
      message: z.string(),
      actionIndex: z.number().int().nullable(),
    }),
  ),
  estimatedRunsPerDay: z.number().nullable(),
})
export type SimulationReport = z.infer<typeof SimulationReportSchema>

/**
 * Loop guard, shared by the executor and the simulator so a chain that the
 * simulation reports as safe is the same chain the executor permits.
 */
export function isLoopBlocked(causationDepth: number, ruleIdsInChain: readonly string[], ruleId: string): boolean {
  if (causationDepth >= MAX_CAUSATION_DEPTH) return true
  // A rule re-entering its own chain is a loop regardless of depth. Two
  // rules ping-ponging would otherwise burn all 10 levels every time.
  return ruleIdsInChain.includes(ruleId)
}
