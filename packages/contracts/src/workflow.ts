import { z } from 'zod'
import { AuditStampSchema, InstantSchema, StatusCategorySchema } from './common.js'
import { FilterNodeSchema } from './query.js'
import {
  IssueIdSchema,
  ProjectIdSchema,
  UserIdSchema,
  WorkflowIdSchema,
  WorkflowStateIdSchema,
  WorkflowTransitionIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Workflows — immutable, versioned, previewable.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The rule that makes everything else possible: a PUBLISHED workflow is
 * never mutated. Editing produces a new draft version; publishing the
 * draft creates a new immutable version and migrates issues onto it.
 *
 * That single constraint buys three things Jira cannot offer:
 *   • Publish preview — diff draft against published and replay real
 *     issues through it to find which would be stranded, BEFORE committing.
 *   • Analytical correctness — an issue's history can be interpreted
 *     against the workflow that was actually in force at the time.
 *   • Safe rollback — the previous version still exists, so reverting is
 *     re-pointing, not reconstruction.
 */

export const WorkflowStatusSchema = z.enum(['draft', 'published', 'archived'])

/**
 * Transition CONDITIONS decide whether a transition is even offered.
 * Evaluated on read (to grey out buttons) and again on write (authority).
 * Declarative, so both evaluations come from one definition.
 */
export const TransitionConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('has_permission'), permission: z.string() }),
  z.object({ kind: z.literal('in_project_role'), roleKey: z.string() }),
  z.object({ kind: z.literal('is_assignee') }),
  z.object({ kind: z.literal('is_reporter') }),
  /** Blocks "Done" while blocking issues are open — the guard rail that
   *  makes the dependency graph actionable rather than decorative. */
  z.object({ kind: z.literal('no_open_blockers') }),
  z.object({ kind: z.literal('all_subtasks_in_category'), category: StatusCategorySchema }),
  /** Arbitrary predicate over the issue, reusing the shared filter AST. */
  z.object({ kind: z.literal('issue_matches'), filter: FilterNodeSchema }),
])
export type TransitionCondition = z.infer<typeof TransitionConditionSchema>

/**
 * VALIDATORS run after the user submits and can reject with a message.
 * Conditions hide the button; validators explain the refusal.
 */
export const TransitionValidatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('required_fields'), fieldKeys: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('required_comment'), minLength: z.number().int().default(1) }),
  z.object({ kind: z.literal('required_resolution') }),
  z.object({ kind: z.literal('estimate_present') }),
  z.object({ kind: z.literal('issue_matches'), filter: FilterNodeSchema, message: z.string() }),
])
export type TransitionValidator = z.infer<typeof TransitionValidatorSchema>

/**
 * POST-FUNCTIONS are side effects applied inside the SAME transaction as
 * the transition. Deliberately a small, closed, non-scriptable set:
 * anything on the synchronous write path must have a bounded, predictable
 * cost, or transitions get slow and the 150ms budget is gone. Open-ended
 * automation belongs in the Phase 2 engine, which runs off the event
 * stream in Temporal and cannot slow a user's click.
 */
export const TransitionPostFunctionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('assign_to'),
    target: z.enum(['actor', 'reporter', 'project_lead', 'component_lead', 'unassigned']),
  }),
  z.object({ kind: z.literal('set_field'), fieldKey: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal('clear_field'), fieldKey: z.string() }),
  z.object({ kind: z.literal('set_resolution'), resolution: z.string() }),
  z.object({ kind: z.literal('add_label'), label: z.string() }),
  z.object({ kind: z.literal('remove_label'), label: z.string() }),
  /** Removes the issue from the active sprint on completion. */
  z.object({ kind: z.literal('remove_from_sprint') }),
])
export type TransitionPostFunction = z.infer<typeof TransitionPostFunctionSchema>

export const WorkflowStateSchema = z.object({
  id: WorkflowStateIdSchema,
  /** Stable across versions — how issues are remapped on republish. */
  familyId: z.string().uuid(),
  name: z.string().min(1).max(60),
  description: z.string().nullable(),
  category: StatusCategorySchema,
  color: z.string().nullable(),
  position: z.number().int(),
  isInitial: z.boolean(),
  /** States like "Waiting on customer" should stop the SLA clock. */
  pausesSla: z.boolean(),
})
export type WorkflowState = z.infer<typeof WorkflowStateSchema>

export const WorkflowTransitionSchema = z.object({
  id: WorkflowTransitionIdSchema,
  familyId: z.string().uuid(),
  name: z.string().min(1).max(60),
  /** Null = global transition, permitted from any state. */
  fromStateId: WorkflowStateIdSchema.nullable(),
  toStateId: WorkflowStateIdSchema,
  conditions: z.array(TransitionConditionSchema),
  validators: z.array(TransitionValidatorSchema),
  postFunctions: z.array(TransitionPostFunctionSchema),
  /** Fields to prompt for in the transition dialog. */
  screenFieldKeys: z.array(z.string()),
  position: z.number().int(),
})
export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>

export const WorkflowSchema = AuditStampSchema.extend({
  id: WorkflowIdSchema,
  familyId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  projectId: ProjectIdSchema.nullable(),
  name: z.string().min(1).max(120),
  description: z.string().nullable(),
  status: WorkflowStatusSchema,
  publishedAt: InstantSchema.nullable(),
  publishedBy: UserIdSchema.nullable(),
  derivedFromId: WorkflowIdSchema.nullable(),
  states: z.array(WorkflowStateSchema),
  transitions: z.array(WorkflowTransitionSchema),
})
export type Workflow = z.infer<typeof WorkflowSchema>

/**
 * A transition as offered to a specific user for a specific issue.
 * `available: false` plus a reason is far better UX than hiding the
 * button — "you can't close this, 2 blockers are open" is actionable;
 * a missing button is a support ticket.
 */
export const AvailableTransitionSchema = z.object({
  id: WorkflowTransitionIdSchema,
  name: z.string(),
  toStateId: WorkflowStateIdSchema,
  toStateName: z.string(),
  toStateCategory: StatusCategorySchema,
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  requiresFieldKeys: z.array(z.string()),
  requiresComment: z.boolean(),
})
export type AvailableTransition = z.infer<typeof AvailableTransitionSchema>

// ── Publish preview ──────────────────────────────────────────────────

/**
 * The report an admin sees BEFORE publishing a draft. Every entry is
 * something Jira would have silently done to them.
 */
export const WorkflowPublishPreviewSchema = z.object({
  id: z.string().uuid(),
  draftWorkflowId: WorkflowIdSchema,
  status: z.enum(['running', 'ready', 'failed']),
  report: z.object({
    affectedProjectIds: z.array(ProjectIdSchema),
    affectedIssueCount: z.number().int(),
    /** States present in the published version but gone from the draft. */
    removedStates: z.array(
      z.object({ familyId: z.string(), name: z.string(), issueCount: z.number().int() }),
    ),
    /**
     * Issues whose current state has no equivalent in the draft. These are
     * the ones that would become unmovable. The admin must choose a target
     * state for each group before publish is allowed.
     */
    strandedIssues: z.array(
      z.object({
        stateFamilyId: z.string(),
        stateName: z.string(),
        issueCount: z.number().int(),
        sampleIssueIds: z.array(IssueIdSchema).max(10),
        proposedTargetStateFamilyId: z.string().nullable(),
      }),
    ),
    /** Transitions that can never fire because no path reaches their source. */
    unreachableTransitions: z.array(
      z.object({ name: z.string(), fromStateName: z.string().nullable() }),
    ),
    /** States with no inbound transition — usually a modelling mistake. */
    orphanedStates: z.array(z.object({ name: z.string() })),
    /** familyId → familyId mapping that will be applied on publish. */
    stateRemapping: z.record(z.string()),
  }),
  requestedBy: UserIdSchema.nullable(),
  createdAt: InstantSchema,
  completedAt: InstantSchema.nullable(),
})
export type WorkflowPublishPreview = z.infer<typeof WorkflowPublishPreviewSchema>

export const PublishWorkflowSchema = z.object({
  /** Must match a `ready` preview: you cannot publish something unseen. */
  previewId: z.string().uuid(),
  /** Explicit resolution for each stranded group from that preview. */
  strandedResolutions: z.record(z.string()),
})

// ── Static analysis, shared by the editor and the preview job ────────

export interface WorkflowValidationIssue {
  severity: 'error' | 'warning'
  code:
    | 'no_initial_state'
    | 'multiple_initial_states'
    | 'no_done_state'
    | 'unreachable_state'
    | 'orphaned_state'
    | 'duplicate_state_name'
    | 'transition_to_missing_state'
  message: string
  stateId?: string
  transitionId?: string
}

/**
 * Structural validation. Pure and dependency-free so the browser editor
 * and the server publish path run the identical check — a client that
 * validates differently from the server produces "it looked fine until I
 * saved" bugs.
 */
export function validateWorkflowGraph(
  states: WorkflowState[],
  transitions: WorkflowTransition[],
): WorkflowValidationIssue[] {
  const problems: WorkflowValidationIssue[] = []
  const byId = new Map(states.map((s) => [s.id as string, s]))

  const initial = states.filter((s) => s.isInitial)
  if (initial.length === 0) {
    problems.push({
      severity: 'error',
      code: 'no_initial_state',
      message: 'Workflow has no initial state',
    })
  } else if (initial.length > 1) {
    problems.push({
      severity: 'error',
      code: 'multiple_initial_states',
      message: `${initial.length} states are marked initial; exactly one is allowed`,
    })
  }

  if (!states.some((s) => s.category === 'done')) {
    problems.push({
      severity: 'warning',
      code: 'no_done_state',
      // Not an error — a triage-only workflow may legitimately lack one —
      // but every burndown and cycle-time report will be empty, so say so.
      message: 'No state in the "done" category: completion reports will be empty',
    })
  }

  const seenNames = new Set<string>()
  for (const s of states) {
    const norm = s.name.trim().toLowerCase()
    if (seenNames.has(norm)) {
      problems.push({
        severity: 'error',
        code: 'duplicate_state_name',
        message: `Duplicate state name "${s.name}"`,
        stateId: s.id,
      })
    }
    seenNames.add(norm)
  }

  for (const t of transitions) {
    if (!byId.has(t.toStateId as string)) {
      problems.push({
        severity: 'error',
        code: 'transition_to_missing_state',
        message: `Transition "${t.name}" targets a state that does not exist`,
        transitionId: t.id,
      })
    }
  }

  // Reachability from the initial state. A global transition (null from)
  // can originate anywhere, so it makes its target reachable outright.
  const reachable = new Set<string>(initial.map((s) => s.id as string))
  let grew = true
  while (grew) {
    grew = false
    for (const t of transitions) {
      const targetKnown = byId.has(t.toStateId as string)
      if (!targetKnown) continue
      const sourceReachable = t.fromStateId === null || reachable.has(t.fromStateId as string)
      if (sourceReachable && !reachable.has(t.toStateId as string)) {
        reachable.add(t.toStateId as string)
        grew = true
      }
    }
  }

  for (const s of states) {
    if (!reachable.has(s.id as string)) {
      problems.push({
        severity: 'error',
        code: 'unreachable_state',
        message: `State "${s.name}" cannot be reached from the initial state`,
        stateId: s.id,
      })
    }
  }

  const hasInbound = new Set(transitions.map((t) => t.toStateId as string))
  for (const s of states) {
    if (!s.isInitial && !hasInbound.has(s.id as string)) {
      problems.push({
        severity: 'warning',
        code: 'orphaned_state',
        message: `State "${s.name}" has no inbound transition`,
        stateId: s.id,
      })
    }
  }

  return problems
}
