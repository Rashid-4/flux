import * as axeNamespace from 'axe-core'

/**
 * ══════════════════════════════════════════════════════════════════════
 * axe, scoped to the rules a jsdom component test can honestly run.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/specs/web/README.md §12 puts a11y in two layers — *"axe in component tests
 * + a keyboard-only pass"* — and §9 sets the target: **WCAG 2.2 AA**. This is the
 * first of those layers.
 *
 * The reason it is a helper rather than three lines in each test is the tag set.
 * `axe.run()` with no options runs all 105 rules, 30 of which are `best-practice`
 * and several of which are about the *page*: `region` wants every node inside a
 * landmark, `landmark-one-main` wants a `<main>`. A dialog rendered on its own into
 * a bare `<div>` fails all of those, correctly and uselessly — nobody ships a
 * dialog with no page around it. Left unscoped, the noise gets silenced the easy
 * way, by deleting the axe call. So the scope is WCAG conformance rules, and the
 * page-level pass belongs to `e2e/`, against a real browser and a real layout.
 *
 * ## What was measured
 *
 * axe-core 4.13.0, by enumerating `getRules()` rather than by reading docs:
 *
 * | Tag        | Rules | In this pass? |
 * | ---------- | ----- | ------------- |
 * | `wcag2a`   | 62    | yes |
 * | `wcag2aa`  | 3     | yes — one of them (`color-contrast`) cannot run here |
 * | `wcag21a`  | 1     | yes |
 * | `wcag21aa` | 3     | yes |
 * | `wcag22aa` | 1     | yes — its only rule (`target-size`) cannot run here |
 * | `wcag2aaa` | 3     | no — AAA is above the target |
 * | `best-practice` | 30 | no — page-level, and not a conformance requirement |
 *
 * There is **no `wcag22a` tag**: WCAG 2.2 added no level-A success criterion that
 * axe implements. Listing it would be a tag matching zero rules, which is the
 * failure CLAUDE.md calls *"a check that passes over a blind spot"* — it reads as
 * 2.2 coverage and runs nothing. ./axe.test.ts asserts every tag here matches at
 * least one real rule, so the next person cannot add one on a guess.
 */

/**
 * axe-core ships one UMD file with no `exports` map, no `module` field and a
 * `.d.ts` that ends in `export = axe`. Under Vite that arrives as a namespace
 * whose `default` is the module object *and* whose named keys were guessed from
 * the bundle by static analysis — measured, both `namespace.run` and
 * `namespace.default.run` are functions, and the two objects are **not** the same
 * one. `default` is the real module; the namespace is the fallback for a bundler
 * that does not synthesise one. This one line is why the interop is asserted in
 * ./axe.test.ts rather than assumed: `esModuleInterop` is off repo-wide, so
 * `import axe from 'axe-core'` does not typecheck and there is no compiler
 * guardrail here.
 */
export const axe: typeof axeNamespace =
  (axeNamespace as { default?: typeof axeNamespace }).default ?? axeNamespace

/**
 * The conformance tags this pass runs. WCAG 2.2 AA is the target from §9, and
 * WCAG is cumulative — 2.2 AA includes every 2.1 and 2.0 A/AA criterion — so all
 * five levels are listed rather than only the newest.
 */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

/**
 * Rules inside the tag set that jsdom cannot evaluate, and where each one is
 * actually checked instead.
 *
 * Both need **layout**. jsdom parses and styles but never lays out: measured,
 * `getBoundingClientRect()` returns zeros for every element on the page. A rule
 * that reasons about size or about what is painted on top of what is therefore not
 * merely unreliable here — it is reading zeros as facts.
 *
 * Disabling them is only defensible because each is covered somewhere real, which
 * is what the value of each entry records. An entry whose rule is not in scope, or
 * whose rule id does not exist, is dead configuration; ./axe.test.ts fails on both.
 */
export const LAYOUT_DEPENDENT_RULES: Readonly<Record<string, string>> = {
  'color-contrast':
    'Needs painted pixels. Every foreground/background pair in the design system is measured ' +
    'as an sRGB WCAG ratio in tokens.css and asserted by src/design/palette.test.ts, which is ' +
    'a stronger check than sampling whatever two colours a component happens to render.',
  'target-size':
    'Needs box geometry. The 24×24 minimum is a property of the rendered control, so it is ' +
    'checked in the e2e a11y pass against a real browser.',
}

/**
 * One rule switched off for one call, with the reason it is switched off.
 *
 * A `Record<ruleId, reason>` rather than an array of ids, because an unexplained
 * suppression is indistinguishable from a bug someone gave up on. The reason
 * lands in no output — it exists to be read at the call site, and to make writing
 * one an act that requires a justification.
 */
export type RuleExemptions = Readonly<Record<string, string>>

export interface AxeRunOptions {
  /**
   * Extra rules to skip for this call only, on top of `LAYOUT_DEPENDENT_RULES`.
   *
   * Reach for this when the rule is right and the *fragment* is the problem — a
   * `<td>` rendered without its `<table>`, an `<option>` without its `<select>`.
   * If the rule is wrong about the product, that is a change request, not an
   * exemption.
   */
  exempt?: RuleExemptions | undefined
}

/** A violation, flattened to what a failure message needs. */
export interface AxeViolation {
  id: string
  impact: string
  help: string
  helpUrl: string
  nodes: Array<{ html: string; summary: string }>
}

function toViolation(result: axeNamespace.Result): AxeViolation {
  return {
    id: result.id,
    impact: result.impact ?? 'unknown',
    help: result.help,
    helpUrl: result.helpUrl,
    nodes: result.nodes.map((node) => ({
      html: node.html,
      summary: node.failureSummary ?? '',
    })),
  }
}

/**
 * Run the conformance pass over one element and return what failed.
 *
 * The element is required rather than defaulting to `document`. A component test
 * that audited the whole document would be auditing jsdom's bare `<html>` too —
 * which has no `lang`, no `<title>` and no landmarks — and the resulting failures
 * belong to nobody.
 */
export async function axeViolations(
  container: Element,
  options: AxeRunOptions = {},
): Promise<AxeViolation[]> {
  const disabled: Record<string, { enabled: false }> = {}
  for (const id of Object.keys(LAYOUT_DEPENDENT_RULES)) disabled[id] = { enabled: false }
  for (const id of Object.keys(options.exempt ?? {})) disabled[id] = { enabled: false }

  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
    rules: disabled,
    /**
     * Violations only. axe otherwise builds `passes`, `incomplete` and
     * `inapplicable` as well — around a hundred result objects per call, none of
     * which any assertion here reads.
     */
    resultTypes: ['violations'],
  })

  return results.violations.map(toViolation)
}

/**
 * The error a failed audit throws.
 *
 * A distinct class rather than `expect(violations).toEqual([])`, because the
 * default diff for that is a wall of nested objects with the one useful line —
 * *which element, and what to do about it* — buried in the middle. §13's rule
 * about never showing a user an error that says nothing applies to the developer
 * reading a test failure at 6pm just as much.
 */
export class AxeViolationError extends Error {
  readonly violations: readonly AxeViolation[]

  constructor(violations: readonly AxeViolation[]) {
    super(formatViolations(violations))
    this.name = 'AxeViolationError'
    this.violations = violations
  }
}

export function formatViolations(violations: readonly AxeViolation[]): string {
  const count = violations.length
  const heading = `axe found ${String(count)} accessibility violation${count === 1 ? '' : 's'}:`
  const blocks = violations.map((violation) => {
    const nodes = violation.nodes.map((node, index) => {
      const lines = [`    ${String(index + 1)}. ${node.html}`]
      for (const line of node.summary.split('\n')) {
        if (line.trim() !== '') lines.push(`       ${line.trim()}`)
      }
      return lines.join('\n')
    })
    return [
      `  ${violation.id} (${violation.impact}) — ${violation.help}`,
      `    ${violation.helpUrl}`,
      ...nodes,
    ].join('\n')
  })
  return [heading, ...blocks].join('\n\n')
}

/**
 * Assert an element has no WCAG A/AA violations.
 *
 * `await expectNoAxeViolations(container)` in every component test that renders
 * something interactive. §12's rule is that a11y is a layer of the test suite, not
 * a pass someone does later.
 */
export async function expectNoAxeViolations(
  container: Element,
  options: AxeRunOptions = {},
): Promise<void> {
  const violations = await axeViolations(container, options)
  if (violations.length > 0) throw new AxeViolationError(violations)
}
