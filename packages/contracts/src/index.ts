/**
 * ══════════════════════════════════════════════════════════════════════
 * @flux/contracts — the single source of truth for the domain.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This package contains NO I/O, NO framework code, and NO business logic
 * that needs a database. It is types, zod schemas, and pure functions.
 *
 * That constraint is what makes it usable from all three sides at once:
 *
 *   • the API validates every request boundary against these schemas
 *   • the web client imports the same schemas for forms and optimistic
 *     updates, so client and server cannot disagree about what is valid
 *   • the workers and importer use the same event and command types, so a
 *     payload change breaks the build rather than production
 *
 * The rule for anyone extending it: if a piece of logic must give the same
 * answer on the client and the server, it belongs HERE as a pure function —
 * not implemented twice. `validateWorkflowGraph`, `evaluatePermission`,
 * `canBeChildOf`, `valueSchemaFor` and the rank functions are all in this
 * package for exactly that reason. Two implementations of one rule always
 * drift; one cannot.
 */

export * from './ids.js'
export * from './common.js'
export * from './errors.js'
export * from './query.js'
export * from './events.js'
export * from './tenancy.js'
export * from './project.js'
export * from './field.js'
export * from './workflow.js'
export * from './permission.js'
export * from './issue.js'
export * from './board.js'
export * from './automation.js'
export * from './import.js'

/**
 * Ranking is namespaced rather than flattened: `between`, `rankAfter` and
 * friends are far too generic to sit in a shared top-level namespace, and
 * `rank.between(a, b)` reads better at the call site anyway.
 */
export * as rank from './rank.js'
