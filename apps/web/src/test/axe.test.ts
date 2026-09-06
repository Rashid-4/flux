import * as axeNamespace from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  axe,
  AxeViolationError,
  axeViolations,
  expectNoAxeViolations,
  formatViolations,
  LAYOUT_DEPENDENT_RULES,
  WCAG_TAGS,
} from './axe'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The a11y harness, checked before anything is checked with it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every component test in this app will delegate its accessibility assertion to
 * ./axe.ts, which means a silently misconfigured helper turns the whole a11y layer
 * into decoration. There are three ways for it to fail quietly and all three are
 * asserted here:
 *
 *   1. **The interop.** axe-core is a UMD file with `export = axe`. If the
 *      `default ?? namespace` line ever resolves to the wrong object, `axe.run` is
 *      `undefined` — which is loud. Worse is resolving to an object that *has* a
 *      `run` from a different axe instance with different rule config.
 *   2. **The tags.** A misspelled tag matches zero rules and `axe.run` reports zero
 *      violations. Every test using the helper then passes, for every component,
 *      forever. This is the exact shape CLAUDE.md records under *"a check that
 *      passes over a blind spot is worse than no check"*.
 *   3. **The exemptions.** A disabled rule id that does not exist, or that was
 *      never in scope, is dead configuration that reads as a considered decision.
 *
 * The last block is the anti-vacuity pin: a fragment with a real, well-known
 * violation must actually fail.
 */

function fragment(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the axe-core interop', () => {
  it('resolves to something with a working API surface', () => {
    expect(typeof axe.run).toBe('function')
    expect(typeof axe.getRules).toBe('function')
    expect(axe.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  /**
   * The measured shape the `default ?? namespace` line exists for. Both halves
   * carry a `run`, and they are different objects — so the choice between them is
   * a real choice, not a formality, and `default` is the module axe itself
   * exported rather than one a bundler reconstructed.
   */
  it('is the module default, which is not the namespace', () => {
    const bag = axeNamespace as unknown as Record<string, unknown>
    expect(typeof bag['default']).toBe('object')
    expect(axe).toBe(bag['default'])
    expect(axe).not.toBe(axeNamespace)
  })

  it('exposes a rule catalogue to check the configuration against', () => {
    expect(axe.getRules().length).toBeGreaterThan(50)
  })
})

describe('the tag scope', () => {
  const rules = axe.getRules()

  function rulesTagged(tag: string): string[] {
    return rules.filter((rule) => (rule.tags ?? []).includes(tag)).map((rule) => rule.ruleId)
  }

  /**
   * The blind-spot guard. A tag axe does not know is not an error — it is a run
   * that quietly checks nothing.
   */
  it.each([...WCAG_TAGS])('runs at least one real rule for %s', (tag) => {
    expect(rulesTagged(tag).length).toBeGreaterThan(0)
  })

  it('covers the WCAG 2.0 A criteria, which is the bulk of the suite', () => {
    expect(rulesTagged('wcag2a').length).toBeGreaterThan(30)
  })

  /**
   * `wcag22a` is deliberately absent from `WCAG_TAGS`, and this is why: axe
   * implements no rule under it. Pinned so that if a future axe release adds one,
   * this fails and the tag gets added rather than being missed.
   */
  it('confirms there is no wcag22a rule to run', () => {
    expect(rulesTagged('wcag22a')).toEqual([])
  })

  /** AAA and best-practice are out of scope by decision, not by accident. */
  it('leaves AAA and best-practice to other passes', () => {
    expect(WCAG_TAGS as readonly string[]).not.toContain('wcag2aaa')
    expect(WCAG_TAGS as readonly string[]).not.toContain('best-practice')
    /** Both exist and would have run had they been listed. */
    expect(rulesTagged('wcag2aaa').length).toBeGreaterThan(0)
    expect(rulesTagged('best-practice').length).toBeGreaterThan(0)
  })

  /**
   * `region` is the rule that would otherwise make every isolated component fail:
   * a fragment rendered into a bare `<div>` has no landmark around it. It sits in
   * `best-practice`, which is the mechanical reason excluding that tag is enough
   * and no per-rule exemption is needed for it.
   */
  it('excludes the page-level rules by tag rather than one at a time', () => {
    expect(rulesTagged('best-practice')).toContain('region')
    for (const tag of WCAG_TAGS) {
      expect(rulesTagged(tag), tag).not.toContain('region')
    }
  })
})

describe('the layout-dependent exemptions', () => {
  const rules = axe.getRules()
  const exempted = Object.keys(LAYOUT_DEPENDENT_RULES)

  it.each(exempted)('names %s, which is a rule that exists', (id) => {
    expect(rules.map((rule) => rule.ruleId)).toContain(id)
  })

  /**
   * An exemption for a rule outside the tag set is dead configuration: it reads as
   * a considered trade-off and disables nothing.
   */
  it.each(exempted)('disables %s from inside the scope, not outside it', (id) => {
    const rule = rules.find((entry) => entry.ruleId === id)
    const tags = rule?.tags ?? []
    expect(
      tags.some((tag) => (WCAG_TAGS as readonly string[]).includes(tag)),
      tags.join(','),
    ).toBe(true)
  })

  it.each(exempted)('records where %s is checked instead', (id) => {
    expect(LAYOUT_DEPENDENT_RULES[id]?.length ?? 0).toBeGreaterThan(40)
  })

  /**
   * The honest consequence, stated rather than glossed: `target-size` is the only
   * `wcag22aa` rule axe has, so disabling it leaves this pass with **no** WCAG 2.2
   * coverage at all — which is exactly why the e2e a11y pass is not optional.
   *
   * If axe adds a second `wcag22aa` rule, this fails, and the right response is to
   * delete this test and note that the jsdom pass now covers 2.2 too.
   */
  it('leaves this pass with no WCAG 2.2 coverage, which is why e2e exists', () => {
    const wcag22 = rules
      .filter((rule) => (rule.tags ?? []).includes('wcag22aa'))
      .map((rule) => rule.ruleId)
    expect(wcag22).toEqual(['target-size'])
    expect(exempted).toContain('target-size')
  })

  it('keeps the exemption list short enough to read', () => {
    expect(exempted.length).toBeLessThanOrEqual(2)
  })
})

describe('axeViolations', () => {
  /**
   * Anti-vacuity, and the most important test in the file. Everything above
   * asserts configuration; this asserts that the configuration finds something.
   * `image-alt` is `wcag2a` / `wcag111`, needs no layout, and is unambiguous.
   */
  it('finds a violation that is really there', async () => {
    const host = fragment('<img src="/logo.png">')
    const violations = await axeViolations(host)
    expect(violations.map((violation) => violation.id)).toContain('image-alt')
  })

  it('reports nothing for a fragment that is fine', async () => {
    const host = fragment('<img src="/logo.png" alt="flux">')
    await expect(axeViolations(host)).resolves.toEqual([])
  })

  /**
   * A decorative image is `alt=""`, not a missing `alt`. Asserted because a helper
   * that flagged it would push people towards inventing alt text for spacers,
   * which is worse for a screen reader than silence.
   */
  it('accepts an explicitly empty alt', async () => {
    const host = fragment('<img src="/divider.png" alt="">')
    await expect(axeViolations(host)).resolves.toEqual([])
  })

  it('carries the rule id, impact, help text and a documentation link', async () => {
    const host = fragment('<img src="/logo.png">')
    const [violation] = await axeViolations(host)
    expect(violation?.id).toBe('image-alt')
    expect(violation?.impact).not.toBe('unknown')
    expect(violation?.help).not.toBe('')
    expect(violation?.helpUrl).toContain('dequeuniversity.com')
    expect(violation?.nodes[0]?.html).toContain('<img')
    expect(violation?.nodes[0]?.summary).not.toBe('')
  })

  /**
   * Scoped to what was passed in. Two components rendered in one test must fail
   * independently, or a violation in a fixture gets attributed to the component
   * under test.
   */
  it('audits only the element it was given', async () => {
    const broken = fragment('<img src="/broken.png">')
    const fine = fragment('<img src="/fine.png" alt="fine">')
    await expect(axeViolations(fine)).resolves.toEqual([])
    expect((await axeViolations(broken)).map((violation) => violation.id)).toContain('image-alt')
  })

  it('skips a rule the caller exempts, with its reason', async () => {
    const host = fragment('<img src="/logo.png">')
    await expect(
      axeViolations(host, {
        exempt: { 'image-alt': 'Testing the exemption path itself, not a real product decision.' },
      }),
    ).resolves.toEqual([])
  })

  /**
   * The exemption is per call. Without this, a suppression written for one
   * component would leak into every later test in the file — the same
   * cross-contamination `server.resetHandlers()` exists to prevent for MSW.
   */
  it("does not let one call's exemption outlive it", async () => {
    const host = fragment('<img src="/logo.png">')
    await axeViolations(host, { exempt: { 'image-alt': 'One call only.' } })
    expect((await axeViolations(host)).map((violation) => violation.id)).toContain('image-alt')
  })

  it('still disables the layout-dependent rules when a caller exempts others', async () => {
    const host = fragment('<img src="/logo.png" alt="flux">')
    await expect(
      axeViolations(host, { exempt: { 'aria-hidden-focus': 'Unrelated to this fragment.' } }),
    ).resolves.toEqual([])
  })
})

describe('expectNoAxeViolations', () => {
  it('resolves quietly for an accessible fragment', async () => {
    const host = fragment('<button type="button">Save</button>')
    await expect(expectNoAxeViolations(host)).resolves.toBeUndefined()
  })

  it('throws a message naming the rule and the element', async () => {
    const host = fragment('<img src="/logo.png">')
    await expect(expectNoAxeViolations(host)).rejects.toThrow(AxeViolationError)
    await expect(expectNoAxeViolations(host)).rejects.toThrow(/image-alt/)
    await expect(expectNoAxeViolations(host)).rejects.toThrow(/<img/)
  })

  it('keeps the violations on the error for a test that wants to inspect them', async () => {
    const host = fragment('<img src="/logo.png">')
    const error = await expectNoAxeViolations(host).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AxeViolationError)
    expect((error as AxeViolationError).violations.map((v) => v.id)).toContain('image-alt')
  })
})

describe('formatViolations', () => {
  const violation = {
    id: 'label',
    impact: 'critical',
    help: 'Form elements must have labels',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/label',
    nodes: [{ html: '<input type="text">', summary: 'Fix any of the following:\n  No label' }],
  }

  it('leads with the count, pluralised', () => {
    expect(formatViolations([violation])).toContain('1 accessibility violation:')
    expect(formatViolations([violation, { ...violation, id: 'button-name' }])).toContain(
      '2 accessibility violations:',
    )
  })

  it('names the rule, its impact, the fix and the element', () => {
    const report = formatViolations([violation])
    expect(report).toContain('label (critical) — Form elements must have labels')
    expect(report).toContain(violation.helpUrl)
    expect(report).toContain('<input type="text">')
    expect(report).toContain('No label')
  })

  /** Nothing to report reads as nothing to report, not as an empty heading. */
  it('says zero rather than rendering an empty list', () => {
    expect(formatViolations([])).toBe('axe found 0 accessibility violations:')
  })
})
