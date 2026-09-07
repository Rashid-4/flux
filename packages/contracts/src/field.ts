import { z } from 'zod'
import {
  FieldDefinitionIdSchema,
  FieldKeySchema,
  IssueTypeIdSchema,
  ProjectIdSchema,
  UserIdSchema,
} from './ids.js'
import { AuditStampSchema, LocalDateSchema, RichTextDocSchema } from './common.js'
import { FilterNodeSchema } from './query.js'

/**
 * The reusable field library. Fields are an ORGANIZATION-level resource
 * that projects compose, never a project-level resource that projects mint
 * (docs/adr/0007-field-library.md, db/migrations/0004).
 */

export const FieldTypeSchema = z.enum([
  'text',
  'text_long',
  'rich_text',
  'number',
  'decimal',
  'checkbox',
  'select',
  'multi_select',
  'radio',
  'date',
  'datetime',
  'duration',
  'user',
  'multi_user',
  'team',
  'url',
  'email',
  'labels',
  'issue_link',
  'component',
  'version',
  'attachment',
  'formula',
])
export type FieldType = z.infer<typeof FieldTypeSchema>

export const SelectOptionSchema = z.object({
  /** Stable id. Renaming an option must not orphan stored values. */
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  position: z.number().int().nonnegative(),
  isArchived: z.boolean().default(false),
})
export type SelectOption = z.infer<typeof SelectOptionSchema>

/**
 * Type-specific configuration as a discriminated union.
 *
 * The alternative — a loose `config: Record<string, unknown>` — is how you
 * end up with a select field that has no options, or a number field whose
 * min exceeds its max, sitting in production because nothing validated it.
 * Discriminating on `type` means the API rejects an incoherent field
 * definition at the boundary.
 */
export const FieldConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    maxLength: z.number().int().positive().max(1000).default(255),
    pattern: z.string().optional(),
  }),
  z.object({
    type: z.literal('text_long'),
    maxLength: z.number().int().positive().default(32_000),
  }),
  z.object({ type: z.literal('rich_text') }),
  z.object({
    type: z.literal('number'),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('decimal'),
    min: z.number().optional(),
    max: z.number().optional(),
    precision: z.number().int().min(0).max(6).default(2),
  }),
  z.object({ type: z.literal('checkbox') }),
  z.object({
    type: z.literal('select'),
    options: z.array(SelectOptionSchema).min(1),
    allowCustomValues: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('multi_select'),
    options: z.array(SelectOptionSchema).min(1),
    maxSelections: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('radio'), options: z.array(SelectOptionSchema).min(2) }),
  z.object({
    type: z.literal('date'),
    minDate: LocalDateSchema.optional(),
    maxDate: LocalDateSchema.optional(),
  }),
  z.object({ type: z.literal('datetime') }),
  z.object({
    type: z.literal('duration'),
    unit: z.enum(['minutes', 'hours', 'days']).default('hours'),
  }),
  z.object({
    type: z.literal('user'),
    /** Restrict the picker to project members / a team, not the whole org. */
    restrictTo: z.enum(['org', 'project_members', 'team']).default('project_members'),
  }),
  z.object({
    type: z.literal('multi_user'),
    restrictTo: z.enum(['org', 'project_members', 'team']).default('project_members'),
    maxSelections: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('team') }),
  z.object({ type: z.literal('url') }),
  z.object({ type: z.literal('email') }),
  z.object({
    type: z.literal('labels'),
    suggestFrom: z.enum(['project', 'org']).default('project'),
  }),
  z.object({
    type: z.literal('issue_link'),
    restrictToProjectIds: z.array(ProjectIdSchema).default([]),
    restrictToIssueTypeIds: z.array(IssueTypeIdSchema).default([]),
  }),
  z.object({ type: z.literal('component') }),
  z.object({ type: z.literal('version') }),
  z.object({
    type: z.literal('attachment'),
    allowedMimeTypes: z.array(z.string()).default([]),
    maxSizeBytes: z
      .number()
      .int()
      .positive()
      .default(100 * 1024 * 1024),
  }),
  z.object({
    type: z.literal('formula'),
    /**
     * Formulas are a declarative expression tree, NOT a code string.
     * Same reasoning as workflow conditions: it must be evaluable on both
     * client and server from one definition, statically analysable for
     * cycles, and incapable of arbitrary execution. Real scripting lives
     * in the automation engine, off the write path.
     */
    expression: z.unknown(),
    resultType: z.enum(['number', 'decimal', 'duration', 'text']),
  }),
])
export type FieldConfig = z.infer<typeof FieldConfigSchema>

export const FieldDefinitionSchema = AuditStampSchema.extend({
  id: FieldDefinitionIdSchema,
  /** Immutable machine key used inside issues.custom_fields. */
  key: FieldKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  fieldType: FieldTypeSchema,
  config: FieldConfigSchema,
  isSystem: z.boolean(),
  isSearchable: z.boolean(),
  /** Powers the unused-field audit report — the cleanup loop Jira lacks. */
  usageCount: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable(),
  createdBy: UserIdSchema.nullable(),
})
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>

export const CreateFieldDefinitionSchema = z.object({
  key: FieldKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  config: FieldConfigSchema,
  isSearchable: z.boolean().default(true),
})

/**
 * Per-project/per-issue-type layout. Replaces Jira's screens + screen
 * schemes + field configurations + field configuration schemes.
 */
export const ProjectFieldConfigSchema = z.object({
  id: z.string().uuid(),
  projectId: ProjectIdSchema,
  /** Null = applies to every issue type in the project. */
  issueTypeId: IssueTypeIdSchema.nullable(),
  fieldDefinitionId: FieldDefinitionIdSchema,
  fieldKey: z.string(),
  isRequired: z.boolean(),
  showOnCreate: z.boolean(),
  showOnView: z.boolean(),
  position: z.number().int(),
  section: z.string().nullable(),
  defaultValue: z.unknown().nullable(),
  labelOverride: z.string().nullable(),
  helpText: z.string().nullable(),
  /**
   * Conditional fields, held as filter ASTs over the in-flight issue.
   * Declarative so the SAME rule drives the client (hide the input) and
   * the server (reject the write). Two implementations of one rule always
   * drift; one definition cannot.
   */
  visibilityRule: FilterNodeSchema.nullable(),
  requirementRule: FilterNodeSchema.nullable(),
})
export type ProjectFieldConfig = z.infer<typeof ProjectFieldConfigSchema>

/**
 * ══════════════════════════════════════════════════════════════════════
 * What `GET /projects/:key/field-layout` returns. CR-011.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `ProjectFieldConfigSchema` above was well designed and **unreachable**: no
 * specified endpoint returned it, `ProjectDetailSchema` did not carry it, and
 * `IssueDetailSchema` carried the *values* (`customFields: Record<string,
 * unknown>`) without the definitions needed to render any of them. So
 * `valueSchemaFor` below was exported for a client to validate with, and took a
 * `FieldConfig` no client could obtain.
 *
 * That was the severe half of CR-011, and it is a correctness gap rather than a
 * missing feature: without this, not one custom field can be drawn, the create
 * form cannot know what is required — so it submits and collects a `422` the
 * server could have told it about, which is the exact one-error-per-submit
 * behaviour `docs/specs/api/fields.md` §2 exists to prevent — and the
 * `visibilityRule`/`requirementRule` design is defeated, because a declarative AST
 * whose whole argument is *"one definition drives both sides"* has only one side
 * if the client cannot fetch it.
 *
 * ### Why both halves, and why not on the issue
 *
 * `definitions` alongside `configs` because a config holds `fieldDefinitionId` and
 * `fieldKey` and **not** the `FieldConfig` — which is what carries a select's
 * options, a number's precision and a text field's pattern, and what
 * `valueSchemaFor` needs. Two arrays rather than one denormalised list because one
 * definition is shared by every issue type that shows the field, and inlining it
 * per config would repeat a 40-option select's options once per type.
 *
 * Its own endpoint rather than a key on `IssueDetail`, for three reasons that all
 * point the same way: it belongs to `(project, issueType)` and not to an issue, so
 * inlining repeats project-level data on every issue in the project; it is the
 * *same answer* for every issue the user opens, so it caches for the session and
 * the second issue view is faster than an inlined version would be; and the create
 * form needs it before any issue exists.
 */
export const ProjectFieldLayoutSchema = z.object({
  projectId: ProjectIdSchema,
  /**
   * In `position` order, and including configs for every issue type in the
   * project. The client filters by `issueTypeId` — null means every type — rather
   * than re-fetching per type, because switching the type in a create form must
   * not be a network round trip.
   */
  configs: z.array(ProjectFieldConfigSchema),
  /**
   * Every definition referenced by `configs`, exactly once. A config whose
   * definition is absent is a server bug, not a case for the client to degrade
   * around: it would render a labelled input that cannot be validated.
   */
  definitions: z.array(FieldDefinitionSchema),
})
export type ProjectFieldLayout = z.infer<typeof ProjectFieldLayoutSchema>

/**
 * Runtime validator for a stored custom-field value.
 *
 * Called on every write. Returns a zod schema rather than validating
 * directly so the caller can compose it into a whole-issue schema and
 * report all field errors at once — a form that surfaces one error at a
 * time is a bad form.
 */
export function valueSchemaFor(config: FieldConfig): z.ZodTypeAny {
  switch (config.type) {
    case 'text': {
      let s = z.string().max(config.maxLength)
      if (config.pattern) s = s.regex(new RegExp(config.pattern))
      return s
    }
    case 'text_long':
      return z.string().max(config.maxLength)
    case 'rich_text':
      return RichTextDocSchema
    case 'number': {
      let s = z.number().int()
      if (config.min !== undefined) s = s.min(config.min)
      if (config.max !== undefined) s = s.max(config.max)
      return s
    }
    case 'decimal': {
      let s = z.number()
      if (config.min !== undefined) s = s.min(config.min)
      if (config.max !== undefined) s = s.max(config.max)
      return s
    }
    case 'checkbox':
      return z.boolean()
    case 'select':
    case 'radio': {
      const ids = config.options.filter((o) => !o.isArchived).map((o) => o.id)
      // Archived options stay VALID for existing values but are not
      // offerable — otherwise archiving an option would retroactively
      // invalidate every issue that already used it.
      return config.type === 'select' && config.allowCustomValues
        ? z.string()
        : z.enum(ids as [string, ...string[]])
    }
    case 'multi_select': {
      const ids = config.options.filter((o) => !o.isArchived).map((o) => o.id)
      let s = z.array(z.enum(ids as [string, ...string[]]))
      if (config.maxSelections) s = s.max(config.maxSelections)
      return s
    }
    case 'date':
      return LocalDateSchema
    case 'datetime':
      return z.string().datetime({ offset: true })
    case 'duration':
      return z.number().int().nonnegative()
    case 'user':
    case 'team':
    case 'component':
    case 'version':
    case 'issue_link':
      return z.string().uuid()
    case 'multi_user':
      return z.array(z.string().uuid())
    case 'url':
      return z.string().url()
    case 'email':
      return z.string().email()
    case 'labels':
      return z.array(z.string().min(1).max(64))
    case 'attachment':
      return z.array(z.string().uuid())
    case 'formula':
      // Computed server-side; never accepted from a client.
      return z.never()
  }
}
