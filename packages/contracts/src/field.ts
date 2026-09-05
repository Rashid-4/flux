import { z } from 'zod'
import { FieldDefinitionIdSchema, IssueTypeIdSchema, ProjectIdSchema, UserIdSchema } from './ids.js'
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
  z.object({ type: z.literal('text_long'), maxLength: z.number().int().positive().default(32_000) }),
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
  z.object({ type: z.literal('date'), minDate: LocalDateSchema.optional(), maxDate: LocalDateSchema.optional() }),
  z.object({ type: z.literal('datetime') }),
  z.object({ type: z.literal('duration'), unit: z.enum(['minutes', 'hours', 'days']).default('hours') }),
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
  z.object({ type: z.literal('labels'), suggestFrom: z.enum(['project', 'org']).default('project') }),
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
    maxSizeBytes: z.number().int().positive().default(100 * 1024 * 1024),
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
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
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
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
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
