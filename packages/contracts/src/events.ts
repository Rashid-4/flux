import { z } from 'zod'
import { ActorSchema, InstantSchema } from './common.js'
import {
  BoardIdSchema,
  CommentIdSchema,
  EventIdSchema,
  ImportJobIdSchema,
  IssueIdSchema,
  OrganizationIdSchema,
  ProjectIdSchema,
  SprintIdSchema,
  UserIdSchema,
  WorkflowIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE EVENT CATALOG — the contract between the write path and everything
 * that reacts to it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Why this file is load-bearing:
 *
 * Flux's speed comes from doing almost nothing synchronously on write.
 * Creating an issue writes rows, emits an event, and returns. Search
 * indexing, analytics ingestion, automation rules, notification fanout and
 * webhook delivery all happen downstream. That is what keeps issue create
 * inside the 150ms p95 budget no matter how many rules an org has — the
 * exact thing that makes Jira slower the more you configure it.
 *
 * The cost of that design is that this catalog becomes a real API with
 * real compatibility obligations:
 *
 *   1. AT-LEAST-ONCE DELIVERY. The outbox relay may publish the same
 *      event twice (crash between publish and mark-published). Every
 *      consumer MUST be idempotent on `id`. This is not a nicety — the
 *      alternative is duplicate notifications and double-counted metrics.
 *
 *   2. NO ORDERING ACROSS AGGREGATES. Events for one issue arrive in
 *      order (partitioned by aggregateId); events for different issues do
 *      not. Never write a consumer that assumes global ordering.
 *
 *   3. ADDITIVE EVOLUTION ONLY. Adding an optional field is fine. Removing
 *      or retyping one is a new `version`, and old versions must keep
 *      being handled until every consumer has drained them. A consumer
 *      that throws on an unknown version crash-loops the whole stream and
 *      takes search and analytics down with it.
 *
 *   4. PAYLOADS CARRY WHAT CONSUMERS NEED. A consumer must not have to
 *      call back into the API to do its job — that reintroduces the
 *      synchronous coupling this design exists to remove, and it races
 *      against later writes. Hence the denormalised fields below.
 */

/**
 * The catalog is closed, and `pnpm check:events` fails the build if a spec's
 * "Events" section names a type that is not in it. That check was written after
 * the specs turned out to document 30 types this enum did not have — every
 * module's spec had at least one. An undeclared type is not a compile error at
 * the emit site (`event_outbox.event_type` is deliberately unconstrained so
 * adding a type needs no migration), so the event is written, committed, and
 * then fails `EventEnvelopeSchema` in the relay: silently undeliverable, at the
 * one point where nobody is watching a return value.
 *
 * Two documented names lost to the declared spelling rather than being added,
 * because they were the same event twice: `worklog.created` → `worklog.logged`,
 * and boards' `issue.ranked` is now declared rather than folded into
 * `issue.moved` (which means moved between projects — a different thing).
 */
export const EventTypeSchema = z.enum([
  // issues
  'issue.created',
  'issue.updated',
  'issue.transitioned',
  'issue.assigned',
  'issue.deleted',
  'issue.restored',
  'issue.linked',
  'issue.unlinked',
  /** Moved to another project. Its key changes; consumers must re-resolve it. */
  'issue.moved',
  /** Reordered within a board or backlog. High volume — a consumer that does
   *  real work per event will not keep up with a drag-heavy sprint planning
   *  session, so treat it as a hint and batch. */
  'issue.ranked',
  /** `rank.needsRebalance()` returned true. A background job compacts the
   *  ranks; the ranking endpoint must never do it inline. */
  'issue.rank_rebalance_needed',
  // comments & attachments
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'attachment.added',
  'attachment.removed',
  // worklogs
  'worklog.logged',
  // sprints & boards
  'sprint.created',
  'sprint.started',
  'sprint.closed',
  'sprint.issue_added',
  'sprint.issue_removed',
  'board.created',
  'board.updated',
  // projects & their configuration
  'project.created',
  'project.updated',
  'project.archived',
  'project.restored',
  /** Old and new key both in the payload, so consumers can invalidate caches
   *  and rewrite links. The alias row makes old URLs redirect, but a consumer
   *  holding the key as data does not go through the router. */
  'project.key_renamed',
  'issue_type.created',
  'issue_type.archived',
  'component.created',
  'component.updated',
  'component.archived',
  'version.created',
  'version.released',
  'version.archived',
  // workflows
  'workflow.draft_created',
  'workflow.published',
  'workflow.archived',
  'workflow.preview_completed',
  'workflow.issues_migrated',
  // fields
  'field.created',
  'field.updated',
  'field.archived',
  /** Changes what is searchable, so search reindexes the affected projects. */
  'field_layout.updated',
  'field_option.deactivated',
  // permissions
  'permission_scheme.updated',
  'permission_scheme.promoted',
  'permission.grant_added',
  'permission.grant_removed',
  'role.created',
  'role.member_added',
  'role.member_removed',
  'security_level.applied',
  // organization & membership
  'organization.updated',
  /** Billing or compliance suspension. Every session for the org is refused
   *  from this point, so consumers holding one must drop it. */
  'organization.suspended',
  'organization.reinstated',
  'member.invited',
  'member.joined',
  'member.removed',
  'member.role_changed',
  'team.created',
  'team.updated',
  'team.archived',
  'team.membership_changed',
  /** Someone's availability or absence changed; capacity forecasts are stale. */
  'availability.changed',
  // automation (Phase 2)
  'automation.rule_enabled',
  'automation.rule_disabled',
  'automation.rule_executed',
  'automation.rule_failed',
  // sla (Phase 3)
  'sla.breached',
  'sla.at_risk',
  // import & export (Phase 1)
  'import.started',
  'import.finding_raised',
  'import.completed',
  'import.failed',
  /** The archive is ready. Notifications need this: an export takes long
   *  enough that nobody is still watching the page it was started from. */
  'export.completed',
  'export.failed',
])
export type EventType = z.infer<typeof EventTypeSchema>

/** Envelope shared by every event. */
export const EventEnvelopeSchema = z.object({
  id: EventIdSchema,
  type: EventTypeSchema,
  /** Payload schema version. Consumers must tolerate unknown values. */
  version: z.number().int().positive().default(1),
  organizationId: OrganizationIdSchema,
  /**
   * What the event is *about*, which is not the same as the first segment of
   * `type`. `member.role_changed` is about a `user`; `security_level.applied`
   * is about an `issue`. Pick the thing whose ordering matters, because this is
   * what `aggregateId` partitions on.
   */
  aggregateType: z.enum([
    'issue',
    'project',
    'sprint',
    'board',
    'workflow',
    'field',
    'permission_scheme',
    'role',
    'organization',
    'team',
    'user',
    'component',
    'version',
    'issue_type',
    'automation_rule',
    'import_job',
    'export_job',
  ]),
  /** Partition key. Guarantees per-aggregate ordering. */
  aggregateId: z.string().uuid(),
  actor: ActorSchema,
  occurredAt: InstantSchema,
  /** Links this event to the request that caused it, end to end. */
  traceId: z.string().nullable(),
})
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>

/**
 * A single field change. `from`/`to` are rendered values, not raw ids,
 * because notification templates and audit views need to display them
 * without resolving foreign keys — see obligation (4) above.
 */
export const FieldChangeSchema = z.object({
  field: z.string(),
  from: z.unknown().nullable(),
  to: z.unknown().nullable(),
  fromDisplay: z.string().nullable().optional(),
  toDisplay: z.string().nullable().optional(),
})
export type FieldChange = z.infer<typeof FieldChangeSchema>

/**
 * Issue snapshot embedded in every issue event.
 *
 * Denormalised on purpose. The notification service needs the summary and
 * assignee to render an email; the analytics ingester needs project, type
 * and status category to build its fact row; the search indexer needs
 * enough to update a document. If each fetched the issue itself we would
 * have (a) N callbacks into the API per write, and (b) a race where a
 * consumer reads a LATER state than the event describes and produces
 * metrics that disagree with history.
 */
export const IssueSnapshotSchema = z.object({
  id: IssueIdSchema,
  key: z.string(),
  projectId: ProjectIdSchema,
  projectKey: z.string(),
  issueTypeKey: z.string(),
  hierarchyLevel: z.number().int(),
  summary: z.string(),
  statusId: z.string().uuid(),
  statusName: z.string(),
  statusCategory: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
  priority: z.string().nullable(),
  assigneeId: UserIdSchema.nullable(),
  reporterId: UserIdSchema,
  storyPoints: z.number().nullable(),
  labels: z.array(z.string()),
  parentId: IssueIdSchema.nullable(),
  sprintId: SprintIdSchema.nullable(),
  teamId: z.string().uuid().nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  version: z.number().int(),
})
export type IssueSnapshot = z.infer<typeof IssueSnapshotSchema>

// ── Payloads ─────────────────────────────────────────────────────────

export const IssueCreatedPayloadSchema = z.object({
  issue: IssueSnapshotSchema,
  /** Set when created by an import, so consumers can suppress notifications. */
  importJobId: ImportJobIdSchema.nullable().optional(),
})

export const IssueUpdatedPayloadSchema = z.object({
  issue: IssueSnapshotSchema,
  changes: z.array(FieldChangeSchema).min(1),
})

export const IssueTransitionedPayloadSchema = z.object({
  issue: IssueSnapshotSchema,
  fromStatusId: z.string().uuid(),
  fromStatusName: z.string(),
  fromStatusCategory: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
  transitionId: z.string().uuid().nullable(),
  /**
   * How long the issue sat in the state it just left. Computed once here
   * rather than derived by each consumer from the history log — cycle-time
   * and SLA reporting must agree, and the only way to guarantee that is
   * for them to read the same number.
   */
  secondsInPreviousState: z.number().int().nonnegative(),
})

export const IssueAssignedPayloadSchema = z.object({
  issue: IssueSnapshotSchema,
  previousAssigneeId: UserIdSchema.nullable(),
})

export const IssueLinkedPayloadSchema = z.object({
  sourceIssue: IssueSnapshotSchema,
  targetIssue: IssueSnapshotSchema,
  linkType: z.enum(['blocks', 'relates_to', 'duplicates', 'causes', 'clones']),
})

export const CommentCreatedPayloadSchema = z.object({
  commentId: CommentIdSchema,
  issue: IssueSnapshotSchema,
  authorId: UserIdSchema,
  /** Extracted on write so notification fanout needs no document parsing. */
  mentionedUserIds: z.array(UserIdSchema),
  isInternal: z.boolean(),
  /** Plain-text excerpt for previews. Never the full document. */
  excerpt: z.string().max(280),
})

export const SprintStartedPayloadSchema = z.object({
  sprintId: SprintIdSchema,
  boardId: BoardIdSchema,
  name: z.string(),
  startDate: InstantSchema,
  endDate: InstantSchema,
  committedIssueIds: z.array(IssueIdSchema),
  committedPoints: z.number(),
  plannedCapacityPoints: z.number().nullable(),
  /** True when commitment exceeded computed capacity — the Phase 2 warning. */
  overCommitted: z.boolean(),
})

export const SprintClosedPayloadSchema = z.object({
  sprintId: SprintIdSchema,
  boardId: BoardIdSchema,
  completedIssueIds: z.array(IssueIdSchema),
  carriedOverIssueIds: z.array(IssueIdSchema),
  committedPoints: z.number(),
  completedPoints: z.number(),
  addedPoints: z.number(),
})

export const WorkflowPublishedPayloadSchema = z.object({
  workflowId: WorkflowIdSchema,
  familyId: z.string().uuid(),
  versionNumber: z.number().int(),
  previousWorkflowId: WorkflowIdSchema.nullable(),
  affectedProjectIds: z.array(ProjectIdSchema),
  /** state family id → new state id, for issue remapping. */
  stateRemapping: z.record(z.string()),
  migratedIssueCount: z.number().int(),
})

export const AutomationRuleExecutedPayloadSchema = z.object({
  ruleId: z.string().uuid(),
  ruleName: z.string(),
  triggerEventId: EventIdSchema,
  affectedIssueIds: z.array(IssueIdSchema),
  actionsRun: z.number().int(),
  durationMs: z.number().int(),
  /** True for dry runs: nothing was actually mutated. */
  simulated: z.boolean(),
})

export const SlaBreachedPayloadSchema = z.object({
  policyId: z.string().uuid(),
  policyName: z.string(),
  issue: IssueSnapshotSchema,
  targetSeconds: z.number().int(),
  elapsedSeconds: z.number().int(),
  escalationLevel: z.number().int(),
})

export const ImportFindingRaisedPayloadSchema = z.object({
  importJobId: ImportJobIdSchema,
  severity: z.enum(['info', 'warning', 'blocker']),
  code: z.string(),
  entityType: z.string().nullable(),
  sourceId: z.string().nullable(),
  message: z.string(),
})

/**
 * Type→payload map. The API's emit helper is typed against this, so
 * emitting `issue.transitioned` without `secondsInPreviousState` is a
 * compile error rather than a runtime surprise discovered in analytics
 * three weeks later.
 *
 * **It is deliberately partial.** A type absent from this map carries the
 * envelope and whatever the emitter put in `payload`, unvalidated. That is the
 * right default for the config-change events (`component.updated`,
 * `team.archived`, …), whose consumers only need to know *that* something
 * changed and then re-read it. Pinning a schema is what you do when consumers
 * must act on the contents without a callback — and adding one later is
 * additive, so start without it rather than inventing fields no consumer reads.
 */
export const EVENT_PAYLOAD_SCHEMAS = {
  'issue.created': IssueCreatedPayloadSchema,
  'issue.updated': IssueUpdatedPayloadSchema,
  'issue.transitioned': IssueTransitionedPayloadSchema,
  'issue.assigned': IssueAssignedPayloadSchema,
  'issue.linked': IssueLinkedPayloadSchema,
  'comment.created': CommentCreatedPayloadSchema,
  'sprint.started': SprintStartedPayloadSchema,
  'sprint.closed': SprintClosedPayloadSchema,
  'workflow.published': WorkflowPublishedPayloadSchema,
  'automation.rule_executed': AutomationRuleExecutedPayloadSchema,
  'sla.breached': SlaBreachedPayloadSchema,
  'import.finding_raised': ImportFindingRaisedPayloadSchema,
} as const

export type EventPayloadMap = {
  [K in keyof typeof EVENT_PAYLOAD_SCHEMAS]: z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[K]>
}

export type FluxEvent<K extends keyof EventPayloadMap = keyof EventPayloadMap> = EventEnvelope & {
  type: K
  payload: EventPayloadMap[K]
}

/**
 * Subject naming for NATS / Kafka topics: `flux.<namespace>.<action>`, where
 * the namespace is the first segment of the event type — **not**
 * `aggregateType`, which can differ (`member.role_changed` is about a `user`).
 * Subjects follow the type because that is what subscriptions are written
 * against: a consumer binds `flux.sprint.*` rather than enumerating types, so
 * adding a type does not require touching every subscriber.
 *
 * Every declared type has exactly one dot, which is what makes the wildcard
 * bind exactly one level deep. `events.test.ts` asserts it for the whole enum;
 * a two-dot type would silently fall outside `flux.<namespace>.*` on NATS.
 */
export function eventSubject(type: EventType): string {
  return `flux.${type}`
}

/**
 * Consumers that must never process the same event twice call this to
 * build their dedupe key. Scoped per consumer group so one consumer
 * having seen an event does not cause another to skip it.
 */
export function dedupeKey(consumerGroup: string, eventId: string): string {
  return `flux:consumed:${consumerGroup}:${eventId}`
}
