import { z } from 'zod'

/**
 * Branded id types.
 *
 * Every id in Flux is a uuid, which means without branding they are all
 * mutually assignable and the compiler will happily let you pass a
 * ProjectId where an IssueId belongs. In a domain with ~25 entity types
 * that is not a hypothetical bug — it is a weekly one.
 *
 * Branding is erased at runtime (zero cost) but makes those mix-ups
 * compile errors.
 */
/**
 * The brand marker is a phantom PROPERTY, not a `unique symbol`.
 *
 * A `declare const brand: unique symbol` used as a computed key is the more
 * fashionable idiom, and it does not survive `declaration: true`: the
 * compiler cannot name the symbol in the ~60 emitted .d.ts files that
 * mention a branded id, and every one of them fails with TS4023. Exporting
 * the symbol does not fix it either.
 *
 * A readonly phantom property is nameable, so declaration emit works, and it
 * is equally unforgeable in practice: `__brand` exists only in the type, so
 * the only way to produce a branded value is a deliberate cast or a
 * `brandedId()` parse. Please do not "modernise" this back to a symbol.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B }

const uuid = z.string().uuid()

function brandedId<B extends string>(_name: B) {
  return uuid.transform((v) => v as Brand<string, B>)
}

export type OrganizationId = Brand<string, 'OrganizationId'>
export type UserId = Brand<string, 'UserId'>
export type TeamId = Brand<string, 'TeamId'>
export type ProjectId = Brand<string, 'ProjectId'>
export type IssueId = Brand<string, 'IssueId'>
export type IssueTypeId = Brand<string, 'IssueTypeId'>
export type WorkflowId = Brand<string, 'WorkflowId'>
export type WorkflowStateId = Brand<string, 'WorkflowStateId'>
export type WorkflowTransitionId = Brand<string, 'WorkflowTransitionId'>
export type FieldDefinitionId = Brand<string, 'FieldDefinitionId'>
export type PermissionSchemeId = Brand<string, 'PermissionSchemeId'>
export type ProjectRoleId = Brand<string, 'ProjectRoleId'>
export type BoardId = Brand<string, 'BoardId'>
export type SprintId = Brand<string, 'SprintId'>
export type CommentId = Brand<string, 'CommentId'>
export type AttachmentId = Brand<string, 'AttachmentId'>
export type ComponentId = Brand<string, 'ComponentId'>
export type ProjectVersionId = Brand<string, 'ProjectVersionId'>
export type AutomationRuleId = Brand<string, 'AutomationRuleId'>
export type SavedViewId = Brand<string, 'SavedViewId'>
export type ImportJobId = Brand<string, 'ImportJobId'>
export type SecurityLevelId = Brand<string, 'SecurityLevelId'>
export type EventId = Brand<string, 'EventId'>

export const OrganizationIdSchema = brandedId('OrganizationId')
export const UserIdSchema = brandedId('UserId')
export const TeamIdSchema = brandedId('TeamId')
export const ProjectIdSchema = brandedId('ProjectId')
export const IssueIdSchema = brandedId('IssueId')
export const IssueTypeIdSchema = brandedId('IssueTypeId')
export const WorkflowIdSchema = brandedId('WorkflowId')
export const WorkflowStateIdSchema = brandedId('WorkflowStateId')
export const WorkflowTransitionIdSchema = brandedId('WorkflowTransitionId')
export const FieldDefinitionIdSchema = brandedId('FieldDefinitionId')
export const PermissionSchemeIdSchema = brandedId('PermissionSchemeId')
export const ProjectRoleIdSchema = brandedId('ProjectRoleId')
export const BoardIdSchema = brandedId('BoardId')
export const SprintIdSchema = brandedId('SprintId')
export const CommentIdSchema = brandedId('CommentId')
export const AttachmentIdSchema = brandedId('AttachmentId')
export const ComponentIdSchema = brandedId('ComponentId')
export const ProjectVersionIdSchema = brandedId('ProjectVersionId')
export const AutomationRuleIdSchema = brandedId('AutomationRuleId')
export const SavedViewIdSchema = brandedId('SavedViewId')
export const ImportJobIdSchema = brandedId('ImportJobId')
export const SecurityLevelIdSchema = brandedId('SecurityLevelId')
export const EventIdSchema = brandedId('EventId')

/**
 * Issue key, e.g. `FLUX-142`. Displayed everywhere and used in URLs, so
 * it is validated as a first-class value rather than a loose string.
 */
export const IssueKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,8}$/, 'must look like PROJ-123')
export type IssueKey = z.infer<typeof IssueKeySchema>

export const ProjectKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'must be 2-10 uppercase alphanumerics starting with a letter')
export type ProjectKey = z.infer<typeof ProjectKeySchema>

export function parseIssueKey(key: string): { projectKey: ProjectKey; number: number } {
  const parsed = IssueKeySchema.parse(key)
  const dash = parsed.lastIndexOf('-')
  return {
    projectKey: parsed.slice(0, dash) as ProjectKey,
    number: Number(parsed.slice(dash + 1)),
  }
}

/** `bytes[i]`, bounds-checked. See the call sites in `uuidv7` for why the
 *  check is performed rather than asserted away. */
function byteAt(bytes: Uint8Array, i: number): number {
  const b = bytes[i]
  if (b === undefined) throw new Error(`uuidv7: byte index ${i} out of range`)
  return b
}

/**
 * The only platform API this package requires, declared here rather than
 * acquired from `@types/node` or the DOM lib.
 *
 * `@flux/contracts` is consumed as *source* (`exports: "./src/index.ts"`), so
 * it is compiled inside every consumer's program: `apps/web` under DOM types,
 * the API and the workers under node types, and `@flux/mocks` under
 * deliberately **no** ambient types at all. Anything this package needed from
 * a global type set would therefore have to be present in all of them — and
 * `types: ["node"]` here, which is what used to make this line compile, was
 * the wrong way to get it twice over: it broke `@flux/mocks` outright, and it
 * would have let `process.env` or `Buffer` into a schema file, compile
 * cleanly, and fail in the browser bundle.
 *
 * A local `declare` shadows rather than redeclares, so it coexists with the
 * node globals the test configs still pull in. The surface is one function,
 * and it is the same function in the browser, in node ≥ 19, in Deno and in a
 * worker. `randomUUID` is deliberately not declared: ids here are v7 for the
 * ordering reason below, and the platform's v4 would silently discard it.
 */
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T
}

/**
 * UUIDv7 — time-ordered, so ids generated in sequence land in adjacent
 * B-tree pages instead of scattering random inserts across the index.
 * On a table as write-heavy as `issues` that is the difference between
 * an index that stays compact and one that fragments under load.
 *
 * Ids are generated in the application, not the database, because the
 * API needs the id before it writes (to build the event payload and the
 * response optimistically) and a round-trip to fetch it would defeat the
 * point.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  // 48-bit big-endian millisecond timestamp
  const ts = BigInt(now)
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  }
  crypto.getRandomValues(bytes.subarray(6))
  // Stamp the version and variant bits over two of the random bytes. Reading a
  // byte back out is `number | undefined` under `noUncheckedIndexedAccess`, and
  // the two obvious ways to silence that are both wrong here: `!` skips the
  // check, and `?? 0` would mint a syntactically valid UUID with the wrong
  // version bits — which nothing downstream validates and everything
  // time-ordered depends on. So the read is checked and throws.
  bytes[6] = (byteAt(bytes, 6) & 0x0f) | 0x70 // version 7
  bytes[8] = (byteAt(bytes, 8) & 0x3f) | 0x80 // RFC 9562 variant (0b10xx)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function newId<B extends string>(): Brand<string, B> {
  return uuidv7() as Brand<string, B>
}
