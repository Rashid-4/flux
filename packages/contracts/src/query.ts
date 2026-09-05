import { z } from 'zod'

/**
 * ══════════════════════════════════════════════════════════════════════
 * FQL — the Flux Query Language, and its structured AST.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ONE filter representation is shared by:
 *   • search and saved views
 *   • board and swimlane definitions
 *   • automation rule conditions          (Phase 2)
 *   • dashboard widget scoping            (Phase 3)
 *   • natural-language query output       (Phase 4)
 *
 * The AST is the source of truth; the FQL text syntax is a
 * bidirectional projection of it. That direction matters:
 *
 *   • Jira stores JQL as a STRING. Consequences: it can only be validated
 *     by parsing, it can't be safely rewritten (a project rename breaks
 *     saved filters), the UI can't render it as controls, and every
 *     consumer reimplements interpretation.
 *
 *   • Flux stores the AST. It can be validated structurally, statically
 *     analysed (which indexes will this use?), rewritten mechanically on
 *     rename, rendered as filter chips OR as text, and — critically for
 *     Phase 4 — an LLM's natural-language output can be validated against
 *     this schema before it ever touches the database. A model that emits
 *     a malformed AST fails a zod parse; a model that emits malformed SQL
 *     is a security incident.
 *
 * There is no raw-SQL escape hatch by design. Everything compiles to
 * parameterised SQL from this tree, so injection is not a possible bug
 * class here.
 */

export const ComparatorSchema = z.enum([
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'is_empty',
  'is_not_empty',
])
export type Comparator = z.infer<typeof ComparatorSchema>

/**
 * Relative dates, held symbolically rather than resolved to an instant.
 *
 * A saved view meaning "updated in the last 7 days" must still mean that
 * next month. Storing `-7d` keeps it correct forever; storing a resolved
 * timestamp silently rots — a bug that is very easy to ship and very hard
 * to notice, because the filter keeps returning plausible results.
 */
export const RelativeDateSchema = z.object({
  relative: z.string().regex(/^[+-]\d+[dwmy]$/, 'e.g. -7d, +2w, -3m'),
})

export const NamedDateSchema = z.object({
  named: z.enum([
    'today',
    'yesterday',
    'start_of_week',
    'start_of_month',
    'start_of_sprint',
    'end_of_sprint',
  ]),
})

/**
 * Identity placeholders. A shared "assigned to me" view must resolve per
 * viewer, so the subject is stored as a reference, not a baked-in user id.
 * `current_user` is also what makes focus mode a plain saved view rather
 * than a special-cased feature.
 */
export const DynamicSubjectSchema = z.object({
  dynamic: z.enum(['current_user', 'current_user_teams', 'current_sprint', 'unassigned']),
})

export const FilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number()])),
  RelativeDateSchema,
  NamedDateSchema,
  DynamicSubjectSchema,
])
export type FilterValue = z.infer<typeof FilterValueSchema>

/**
 * Field references are namespaced so a custom field named `status` can
 * never be confused with the built-in one:
 *   `status`, `assignee`, `project`   → core columns
 *   `cf:severity`                     → field_definitions.key
 *   `parent.status`                   → one-hop relation
 */
export const FieldRefSchema = z
  .string()
  .regex(/^(cf:)?[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'e.g. status, assignee, cf:severity, parent.status')
export type FieldRef = z.infer<typeof FieldRefSchema>

export type FilterNode =
  | { op: 'and'; children: FilterNode[] }
  | { op: 'or'; children: FilterNode[] }
  | { op: 'not'; child: FilterNode }
  | { op: 'cmp'; field: FieldRef; cmp: Comparator; value: FilterValue }
  /**
   * History predicate — queries the issue's change log rather than its
   * current state. Enables "was moved to In Progress and back", "has been
   * reassigned more than twice", "sat in Review for over 5 days".
   * Jira's JQL cannot express most of this, which is why flow-efficiency
   * questions there require exporting to a spreadsheet.
   */
  | {
      op: 'changed'
      field: FieldRef
      /** `| undefined` is required under exactOptionalPropertyTypes so this
       *  hand-written type matches what zod's `.optional()` infers below. */
      from?: FilterValue | undefined
      to?: FilterValue | undefined
      after?: FilterValue | undefined
      before?: FilterValue | undefined
      byActorKind?: 'user' | 'automation' | 'import' | 'ai' | 'system' | undefined
    }
  /** Duration in a state, computed from history. Drives SLA + flow views. */
  | { op: 'time_in_state'; state: string; cmp: 'gt' | 'lt'; seconds: number }
  /** Graph traversal over issue_links — powers the dependency view. */
  | { op: 'linked'; linkType: 'blocks' | 'blocked_by' | 'relates_to' | 'duplicates'; child: FilterNode }

export const FilterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('and'), children: z.array(FilterNodeSchema).min(1) }),
    z.object({ op: z.literal('or'), children: z.array(FilterNodeSchema).min(1) }),
    z.object({ op: z.literal('not'), child: FilterNodeSchema }),
    z.object({
      op: z.literal('cmp'),
      field: FieldRefSchema,
      cmp: ComparatorSchema,
      value: FilterValueSchema,
    }),
    z.object({
      op: z.literal('changed'),
      field: FieldRefSchema,
      from: FilterValueSchema.optional(),
      to: FilterValueSchema.optional(),
      after: FilterValueSchema.optional(),
      before: FilterValueSchema.optional(),
      byActorKind: z.enum(['user', 'automation', 'import', 'ai', 'system']).optional(),
    }),
    z.object({
      op: z.literal('time_in_state'),
      state: z.string(),
      cmp: z.enum(['gt', 'lt']),
      seconds: z.number().int().positive(),
    }),
    z.object({
      op: z.literal('linked'),
      linkType: z.enum(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
      child: FilterNodeSchema,
    }),
  ]),
)

export const SortDirectionSchema = z.enum(['asc', 'desc'])
export const SortSpecSchema = z.object({
  field: FieldRefSchema,
  direction: SortDirectionSchema.default('asc'),
  /** Where NULLs land. Explicit because the default differs per engine. */
  nulls: z.enum(['first', 'last']).default('last'),
})
export type SortSpec = z.infer<typeof SortSpecSchema>

export const QuerySchema = z.object({
  filter: FilterNodeSchema.optional(),
  /** Free-text term, routed to Meilisearch and intersected with `filter`. */
  text: z.string().max(512).optional(),
  sort: z.array(SortSpecSchema).max(3).default([]),
  /**
   * Bounded depth. An unbounded recursive filter is a denial-of-service
   * vector: a 500-level-deep OR tree costs the planner far more than it
   * costs the client to send. Enforced at the API edge, not just here.
   */
  maxDepth: z.number().int().max(12).default(8),
})
export type Query = z.infer<typeof QuerySchema>

/** Guard against pathological nesting before compiling to SQL. */
export function filterDepth(node: FilterNode): number {
  switch (node.op) {
    case 'and':
    case 'or':
      return 1 + Math.max(...node.children.map(filterDepth))
    case 'not':
    case 'linked':
      return 1 + filterDepth(node.child)
    default:
      return 1
  }
}

/**
 * Every field reference in a tree. Used to (a) verify the caller may see
 * the referenced fields, (b) rewrite references on rename, (c) decide
 * whether a query can be served by Meilisearch or must hit Postgres.
 */
export function referencedFields(node: FilterNode, acc: Set<string> = new Set()): Set<string> {
  switch (node.op) {
    case 'and':
    case 'or':
      node.children.forEach((c) => referencedFields(c, acc))
      break
    case 'not':
    case 'linked':
      referencedFields(node.child, acc)
      break
    case 'cmp':
    case 'changed':
      acc.add(node.field)
      break
    case 'time_in_state':
      acc.add('status')
      break
  }
  return acc
}
