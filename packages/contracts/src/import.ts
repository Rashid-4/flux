import { z } from 'zod'
import { InstantSchema } from './common.js'
import { ImportJobIdSchema, ProjectIdSchema, UserIdSchema } from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Migration & export — Phase 1, not Phase 5.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is the most commercially important module in Phase 1 and it is worth
 * being blunt about why: nobody's problem is "I need an issue tracker."
 * They already have one, with four years of history in it. The barrier to
 * adoption is not missing features — it is the cost and risk of moving.
 * A migration that loses history, mangles custom fields, or half-completes
 * and cannot be resumed is a lost customer, and word of that travels.
 *
 * Four properties make this trustworthy rather than hopeful:
 *
 * 1. DRY RUN IS THE SAME CODE PATH. `mode: 'dry_run'` runs the entire
 *    import and rolls back, producing the identical findings a commit would.
 *    A preview implemented as a separate "estimator" would eventually
 *    disagree with reality, and the one time it does is the time it matters.
 *
 * 2. RESUMABILITY VIA AN IDEMPOTENCY LEDGER. Every source entity that gets
 *    created is recorded in `import_entity_map` (sourceId → targetId) in the
 *    same transaction. A job killed 60% through resumes at 60%; it does not
 *    restart, and it does not duplicate. Long imports WILL be interrupted —
 *    a token expires, a pod is evicted — so this is load-bearing.
 *
 * 3. FINDINGS ARE REVIEWABLE AND BLOCKERS ARE HARD. A commit is refused
 *    while any unresolved `blocker` finding exists. An import that silently
 *    dropped 300 comments because the source had no author for them is
 *    worse than an import that refused to start.
 *
 * 4. EXPORT IS A PEER FEATURE, NOT AN AFTERTHOUGHT. Full-fidelity export is
 *    available from day one on every plan. It is both the honest answer to
 *    "what if we want to leave?" and, commercially, the reason a team feels
 *    safe trying Flux at all. We compete on being better, not on being
 *    hard to leave.
 */

export const ImportSourceSchema = z.enum([
  'jira_cloud',
  'jira_server',
  'linear',
  'asana',
  'monday',
  'clickup',
  'trello',
  'github_issues',
  'gitlab_issues',
  'azure_devops',
  'csv',
  'flux_export',
])
export type ImportSource = z.infer<typeof ImportSourceSchema>

export const ImportModeSchema = z.enum(['dry_run', 'commit'])

export const ImportEntityTypeSchema = z.enum([
  'user',
  'project',
  'issue_type',
  'field_definition',
  'workflow',
  'workflow_state',
  'component',
  'version',
  'issue',
  'comment',
  'attachment',
  'worklog',
  'issue_link',
  'sprint',
  'board',
  'permission_scheme',
  'history_event',
])
export type ImportEntityType = z.infer<typeof ImportEntityTypeSchema>

/**
 * What to bring across. Defaults are generous because a partial import is
 * usually a surprise, not a choice — and `history` in particular is the one
 * people assume they will get and then discover they didn't.
 */
export const ImportScopeSchema = z.object({
  /** Source project keys to import. Empty = everything the token can see. */
  sourceProjectKeys: z.array(z.string()).default([]),
  includeComments: z.boolean().default(true),
  includeAttachments: z.boolean().default(true),
  includeWorklogs: z.boolean().default(true),
  /** Change history. Expensive and slow — and also what makes cycle-time
   *  reporting work on day one instead of in six months. */
  includeHistory: z.boolean().default(true),
  includeSprints: z.boolean().default(true),
  includeBoards: z.boolean().default(true),
  includeArchived: z.boolean().default(false),
  /** Only import issues updated since this date. For incremental top-ups
   *  after an initial bulk import, or for a phased cutover. */
  updatedSince: z.string().datetime().nullable().default(null),
})
export type ImportScope = z.infer<typeof ImportScopeSchema>

/**
 * How source entities map onto Flux ones. Every field here exists because
 * an automatic guess would eventually be wrong in a way the user could not
 * see, and a mapping they approved is a mapping they can defend internally.
 */
export const ImportMappingSchema = z.object({
  /** source user identifier → Flux user. Unmatched users become inactive
   *  placeholder accounts so authorship is preserved rather than erased. */
  users: z.record(z.union([UserIdSchema, z.literal('create_placeholder'), z.literal('skip')])).default({}),
  /** source project key → existing Flux project, or create a new one. */
  projects: z.record(z.union([ProjectIdSchema, z.literal('create')])).default({}),
  /** source field id → Flux field key, or 'create' / 'skip'. */
  fields: z.record(z.union([z.string(), z.literal('create'), z.literal('skip')])).default({}),
  /** source status name → Flux workflow state family id. */
  statuses: z.record(z.string()).default({}),
  /** source issue type name → Flux issue type key. */
  issueTypes: z.record(z.string()).default({}),
  /** source priority name → Flux priority. */
  priorities: z.record(z.enum(['blocker', 'critical', 'high', 'medium', 'low', 'trivial'])).default({}),
  /** source link type name → Flux link type. */
  linkTypes: z.record(z.string()).default({}),
})
export type ImportMapping = z.infer<typeof ImportMappingSchema>

export const StartImportSchema = z.object({
  source: ImportSourceSchema,
  mode: ImportModeSchema,
  /**
   * A Vault/secret-manager reference — NEVER the credential itself. An API
   * token with read access to a company's entire Jira instance is exactly
   * the kind of secret that must not sit in an application table, a log
   * line, or an error report.
   */
  credentialRef: z.string().min(1),
  /** Source base URL, for self-hosted instances. */
  sourceBaseUrl: z.string().url().optional(),
  scope: ImportScopeSchema,
  mapping: ImportMappingSchema,
  /** Resume an interrupted job instead of starting over. */
  resumeJobId: ImportJobIdSchema.optional(),
})
export type StartImport = z.infer<typeof StartImportSchema>

/**
 * `pending` rather than `queued`, and `running` rather than `importing`, so
 * import and export jobs share one status vocabulary — an operations
 * dashboard that has to special-case each job type is a dashboard nobody
 * keeps accurate.
 */
export const ImportJobStatusSchema = z.enum([
  'pending',
  'discovering',
  'mapping_required',
  'awaiting_review',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
])
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>

/**
 * Per-entity-type progress. Deliberately granular: "importing… 43%" on a
 * six-hour job tells a migration owner nothing they can act on. "18,204 of
 * 42,110 issues; 3 blockers on comments" tells them whether to intervene.
 */
export const ImportProgressSchema = z.object({
  entityType: ImportEntityTypeSchema,
  discovered: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  /** Matched to something that already existed — the resumability signal. */
  skippedExisting: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
})
export type ImportProgress = z.infer<typeof ImportProgressSchema>

export const ImportJobSchema = z.object({
  id: ImportJobIdSchema,
  source: ImportSourceSchema,
  mode: ImportModeSchema,
  status: ImportJobStatusSchema,
  scope: ImportScopeSchema,
  mapping: ImportMappingSchema,
  progress: z.array(ImportProgressSchema),
  /** Overall 0–1, weighted by entity cost rather than raw counts: 40,000
   *  history events are not 40,000 issues' worth of work. */
  overallProgress: z.number().min(0).max(1),
  /** Present once enough throughput data exists to be honest about it. */
  estimatedCompletionAt: InstantSchema.nullable(),
  findingCounts: z.object({
    info: z.number().int(),
    warning: z.number().int(),
    blocker: z.number().int(),
    unresolvedBlocker: z.number().int(),
  }),
  /** The dry run this commit was authorised by, if any. */
  dryRunJobId: ImportJobIdSchema.nullable(),
  startedBy: UserIdSchema.nullable(),
  createdAt: InstantSchema,
  startedAt: InstantSchema.nullable(),
  completedAt: InstantSchema.nullable(),
  failureReason: z.string().nullable(),
  /** Temporal workflow id — the handle used to pause, resume, or cancel. */
  workflowId: z.string().nullable(),
})
export type ImportJob = z.infer<typeof ImportJobSchema>

/**
 * Findings are the product here. Codes are a closed enum so the UI can
 * render a specific explanation and a specific remedy for each — a free-text
 * warning log is something users scroll past.
 */
/**
 * `blocker` is the one that matters: a commit is refused while any
 * unresolved blocker remains. Warnings are imported with a recorded
 * default, never silently dropped.
 */
export const ImportFindingSeveritySchema = z.enum(['info', 'warning', 'blocker'])
export type ImportFindingSeverity = z.infer<typeof ImportFindingSeveritySchema>

export const ImportFindingCodeSchema = z.enum([
  'unmapped_user',
  'unmapped_field',
  'unmapped_status',
  'unmapped_issue_type',
  'unsupported_field_type',
  'attachment_too_large',
  'attachment_fetch_failed',
  'attachment_virus_detected',
  'circular_parent_link',
  /** Source hierarchy that cannot be expressed one-level-per-parent. */
  'hierarchy_depth_exceeded',
  'duplicate_project_key',
  'duplicate_issue_key',
  'missing_required_field',
  'invalid_date_value',
  'rich_text_conversion_lossy',
  'macro_not_supported',
  'permission_scheme_not_translatable',
  'workflow_not_translatable',
  'automation_rule_not_translatable',
  'rate_limited_by_source',
  'source_entity_deleted_mid_import',
])
export type ImportFindingCode = z.infer<typeof ImportFindingCodeSchema>

export const ImportFindingSchema = z.object({
  id: z.string().uuid(),
  importJobId: ImportJobIdSchema,
  severity: ImportFindingSeveritySchema,
  code: ImportFindingCodeSchema,
  entityType: ImportEntityTypeSchema.nullable(),
  sourceId: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  message: z.string(),
  /** What the user can do about it, machine-readable so the UI can offer
   *  the fix inline rather than describing it in prose. */
  suggestedResolution: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('map_to_existing'), candidates: z.array(z.object({ id: z.string(), label: z.string() })) }),
      z.object({ kind: z.literal('create_new') }),
      z.object({ kind: z.literal('skip_entity') }),
      z.object({ kind: z.literal('retry') }),
      z.object({ kind: z.literal('manual_only'), explanation: z.string() }),
    ])
    .nullable(),
  resolvedAt: InstantSchema.nullable(),
  resolvedBy: UserIdSchema.nullable(),
  resolution: z.string().nullable(),
  occurrenceCount: z.number().int().positive(),
  createdAt: InstantSchema,
})
export type ImportFinding = z.infer<typeof ImportFindingSchema>

export const ResolveFindingSchema = z.object({
  resolution: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('map_to_existing'), targetId: z.string() }),
    z.object({ kind: z.literal('create_new') }),
    z.object({ kind: z.literal('skip_entity') }),
    z.object({ kind: z.literal('accept_as_is'), note: z.string().max(500).optional() }),
  ]),
  /** Apply this same resolution to every finding sharing the code+sourceId
   *  pattern. Resolving 1,400 unmapped users one at a time is not a
   *  migration tool, it is a punishment. */
  applyToAllMatching: z.boolean().default(false),
})

/**
 * Post-import verification. Run automatically after a commit and shown
 * before the job is marked complete, because "did everything come across?"
 * is the only question the migration owner actually cares about, and
 * answering it with a spreadsheet reconciliation is not acceptable.
 */
export const ImportReconciliationSchema = z.object({
  importJobId: ImportJobIdSchema,
  checks: z.array(
    z.object({
      entityType: ImportEntityTypeSchema,
      sourceCount: z.number().int(),
      fluxCount: z.number().int(),
      /** sourceCount - fluxCount - intentionally skipped. Should be 0. */
      unexplainedDelta: z.number().int(),
      status: z.enum(['match', 'explained_delta', 'mismatch']),
      explanation: z.string().nullable(),
    }),
  ),
  /** Random sample of source→Flux pairs with a field-level diff, so a human
   *  can spot-check fidelity rather than trusting counts alone. */
  spotChecks: z.array(
    z.object({
      sourceId: z.string(),
      fluxIssueKey: z.string(),
      matchedFields: z.number().int(),
      mismatchedFields: z.array(z.object({ field: z.string(), source: z.string(), flux: z.string() })),
    }),
  ),
  overallStatus: z.enum(['verified', 'discrepancies_found', 'failed']),
})
export type ImportReconciliation = z.infer<typeof ImportReconciliationSchema>

// ── Export ───────────────────────────────────────────────────────────

/** `expired` is a real state, not a deletion: the archive is purged on
 *  expiry but the record that an export happened is audit evidence. */
export const ExportJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'expired'])
export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>

export const ExportScopeSchema = z.enum(['organization', 'projects'])
export type ExportScope = z.infer<typeof ExportScopeSchema>

export const ExportFormatSchema = z.enum([
  /** Complete, re-importable archive. The anti-lock-in guarantee. */
  'flux_archive',
  'csv',
  'json',
  'ndjson',
])

export const StartExportSchema = z.object({
  format: ExportFormatSchema,
  /** Empty = the whole organization. */
  projectIds: z.array(ProjectIdSchema).default([]),
  includeComments: z.boolean().default(true),
  includeAttachments: z.boolean().default(true),
  includeHistory: z.boolean().default(true),
  includeAuditLog: z.boolean().default(false),
  /**
   * Optional passphrase for archive encryption. An export archive contains
   * everything the organization has ever written down; a plain download link
   * for it is a data-loss incident waiting for one forwarded email.
   */
  encryptWithPassphrase: z.boolean().default(false),
})

export const ExportJobSchema = z.object({
  id: z.string().uuid(),
  format: ExportFormatSchema,
  /** Derived at creation from whether projectIds was empty, then stored, so
   *  "was this a whole-org export?" stays answerable after the fact. */
  scope: ExportScopeSchema,
  projectIds: z.array(ProjectIdSchema),
  status: ExportJobStatusSchema,
  progress: z.number().min(0).max(1),
  /** Presigned, short-lived, single-tenant-scoped. Null until complete. */
  downloadUrl: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  /** Archives are deleted after this. Keeping them forever means keeping a
   *  complete copy of a customer's data outside the RLS boundary. */
  expiresAt: InstantSchema.nullable(),
  requestedBy: UserIdSchema.nullable(),
  createdAt: InstantSchema,
  completedAt: InstantSchema.nullable(),
})
export type ExportJob = z.infer<typeof ExportJobSchema>

/**
 * Relative cost weights used for honest progress reporting. History events
 * are numerous but cheap; attachments are few but dominated by transfer
 * time. Weighting by count alone produces a progress bar that sits at 90%
 * for an hour, which teaches users to distrust it.
 */
export const IMPORT_ENTITY_COST_WEIGHTS: Record<ImportEntityType, number> = {
  user: 1,
  project: 5,
  issue_type: 1,
  field_definition: 1,
  workflow: 5,
  workflow_state: 1,
  component: 1,
  version: 1,
  issue: 10,
  comment: 3,
  attachment: 50,
  worklog: 2,
  issue_link: 2,
  sprint: 3,
  board: 5,
  permission_scheme: 5,
  history_event: 1,
}
