import { describe, expect, it } from 'vitest'
import { htmlClassAttributes, stringLiterals, stripVariants, utilities } from './scan-classes'

/**
 * Unit tests for the tokenizer behind `palette.test.ts`.
 *
 * This file exists because of a specific failure. `palette.test.ts` asserts that
 * sets of offenders are empty, and a scanner that collects nothing produces exactly
 * that — so a bug in `scan-classes.ts` does not make the palette test fail, it makes
 * it *stop checking* while still reporting green. The first version had such a bug
 * (no regex-literal state, so a `"` inside a character class opened a string and the
 * next forty lines were read in the wrong state), and it was caught only because the
 * garbage it happened to collect matched a prefix. That is luck, not a test.
 *
 * So the tokenizer is tested directly, on the constructs that actually appear in
 * this codebase, with the emphasis on the two ways a character-level scanner
 * desynchronises: a `/` it misreads, and a quote it misreads.
 */

describe('stringLiterals', () => {
  it('collects the contents of single, double and template literals', () => {
    expect(stringLiterals(`const a = 'bg-surface'`)).toEqual(['bg-surface'])
    expect(stringLiterals(`const a = "text-fg"`)).toEqual(['text-fg'])
    expect(stringLiterals('const a = `gap-2`')).toEqual(['gap-2'])
  })

  it('skips line and block comments', () => {
    const source = [
      `// 'bg-black/50' was replaced by 'bg-overlay'`,
      `/* 'line-clamp-1' fought with 'flex' */`,
      `const real = 'bg-overlay'`,
    ].join('\n')
    expect(stringLiterals(source)).toEqual(['bg-overlay'])
  })

  it('honours backslash escapes, including an escaped quote', () => {
    expect(stringLiterals(String.raw`const a = 'it\'s fine'`)).toEqual([`it's fine`])
    expect(stringLiterals(String.raw`const a = "say \"hi\""`)).toEqual([`say "hi"`])
  })

  /**
   * The regression. A quote inside a regex character class must not open a string —
   * if it does, `'animate-pop-in'` below is never collected, and the scan silently
   * loses everything between the desync and the next matching quote.
   */
  it('does not desynchronise on a regex literal containing quotes', () => {
    const source = [
      String.raw`const attribute = /\bclass=(?:"([^"]*)"|'([^']*)')/g`,
      `const after = 'animate-pop-in'`,
    ].join('\n')
    expect(stringLiterals(source)).toEqual(['animate-pop-in'])
  })

  it('reads a regex after `(`, `=`, an arrow and `return`', () => {
    expect(stringLiterals(String.raw`x.replace(/^!/, '') + 'p-2'`)).toEqual(['', 'p-2'])
    expect(stringLiterals(String.raw`const re = /['"]/; const c = 'gap-1'`)).toEqual(['gap-1'])
    expect(stringLiterals(String.raw`const f = (s) => /^'/.test(s) ? 'mb-px' : 'mt-px'`)).toEqual([
      'mb-px',
      'mt-px',
    ])
    expect(
      stringLiterals(String.raw`function f() { return /'/.test(x) } const c = 'z-40'`),
    ).toEqual(['z-40'])
  })

  /**
   * The other half of the `/` problem, and the reason the preceder test is an
   * allowlist. Every one of these puts a `/` after something that ends an
   * expression; treating any of them as a regex opener swallows the rest of the file.
   */
  it('treats JSX slashes and division as division, not as a regex', () => {
    // Self-closing after a string attribute.
    expect(stringLiterals(`<Dialog className="p-2" />; const c = 'gap-2'`)).toEqual([
      'p-2',
      'gap-2',
    ])
    // Self-closing after a JSX spread.
    expect(stringLiterals(`<Dialog {...props} />; const c = 'gap-3'`)).toEqual(['gap-3'])
    // Self-closing after a bare identifier.
    expect(stringLiterals(`<br />; const c = 'gap-4'`)).toEqual(['gap-4'])
    // A close tag: `<` immediately before the slash.
    expect(stringLiterals(`<span>{label}</span>; const c = 'text-sm'`)).toEqual(['text-sm'])
    // Arithmetic.
    expect(stringLiterals(`const half = width / 2; const c = 'gap-5'`)).toEqual(['gap-5'])
    expect(stringLiterals(`const half = (a + b) / 2; const c = 'gap-6'`)).toEqual(['gap-6'])
  })

  /**
   * A template literal is emitted one static chunk at a time, and the expression
   * inside `${…}` is read as code — so a quote in there cannot leak into the chunk
   * around it. The chunks keep their whitespace because `utilities()` splits on it.
   */
  it('re-enters code state inside a template interpolation', () => {
    expect(stringLiterals('const c = `gap-2 ${cond ? "p-1" : "p-2"} mt-1`')).toEqual([
      'gap-2 ',
      'p-1',
      'p-2',
      ' mt-1',
    ])
    // Nested: a template inside an interpolation inside a template.
    expect(stringLiterals('const c = `a ${`b ${x} c`} d`')).toEqual(['a ', 'b ', ' c', ' d'])
    // An object literal inside the interpolation — its braces must not be mistaken
    // for the interpolation's own closing brace, which would end the template early
    // and read ` b` as code.
    expect(stringLiterals('const c = `a ${f({ k: "p-1" })} b`')).toEqual(['a ', 'p-1', ' b'])
  })
})

describe('htmlClassAttributes', () => {
  it('reads a class attribute wrapped across lines', () => {
    const source = ['<a', '  href="#main"', '  class="sr-only', '  focus:not-sr-only"', '>'].join(
      '\n',
    )
    expect(htmlClassAttributes(source)).toEqual(['sr-only\n  focus:not-sr-only'])
  })

  it('accepts single-quoted attributes', () => {
    expect(htmlClassAttributes(`<div class='bg-canvas'>`)).toEqual(['bg-canvas'])
  })

  it('ignores classes named inside HTML comments', () => {
    const source = `<!-- was class="bg-white" --><div class="bg-canvas">`
    expect(htmlClassAttributes(source)).toEqual(['bg-canvas'])
  })

  it('does not match a longer attribute ending in `class`', () => {
    // `\b` before `class` would still match `data-class=`; the point of the word
    // boundary is that it does not match `className=` in a TSX file read by mistake.
    expect(htmlClassAttributes(`<div className="p-2">`)).toEqual([])
  })
})

describe('stripVariants', () => {
  it('removes a simple variant prefix', () => {
    expect(stripVariants('hover:bg-surface-2')).toBe('bg-surface-2')
    expect(stripVariants('sm:flex-row')).toBe('flex-row')
  })

  it('removes stacked variants', () => {
    expect(stripVariants('data-[state=open]:animate-pop-in')).toBe('animate-pop-in')
    expect(stripVariants('group-data-[size=sm]/avatar:size-4')).toBe('size-4')
    expect(stripVariants('dark:hover:focus:text-fg')).toBe('text-fg')
  })

  /**
   * The colons inside an arbitrary variant are not the separator. `:not(…)` is the
   * common case and appears in every generated component's icon-sizing selector.
   */
  it('ignores colons nested inside brackets and parentheses', () => {
    expect(stripVariants(`[&_svg:not([class*='size-'])]:size-3.5`)).toBe('size-3.5')
    expect(stripVariants(`[&:focus-visible]:outline-2`)).toBe('outline-2')
  })

  it('passes a bare utility through and rejects an empty one', () => {
    expect(stripVariants('bg-surface')).toBe('bg-surface')
    expect(stripVariants('')).toBeNull()
    expect(stripVariants('hover:')).toBeNull()
  })
})

describe('utilities', () => {
  it('splits on whitespace and normalises important, negation and opacity', () => {
    expect(utilities('!p-2 -mt-1 bg-overlay/50 p-3!')).toEqual(['p-2', 'mt-1', 'bg-overlay', 'p-3'])
  })

  it('collapses runs of whitespace, including newlines', () => {
    expect(utilities('  bg-surface\n\n  text-fg\t')).toEqual(['bg-surface', 'text-fg'])
  })

  /**
   * Arbitrary values are `eslint.config.mjs`'s jurisdiction — it bans them for every
   * prefix that can carry a token and permits the layout escapes. Checking them here
   * as well would duplicate that rule and eventually disagree with it.
   */
  it('drops tokens carrying an arbitrary value or property', () => {
    expect(utilities('w-[calc(100%-2rem)] max-h-[calc(100dvh-4rem)]')).toEqual([])
    expect(utilities('[&_svg]:shrink-0')).toEqual(['shrink-0'])
  })

  /**
   * Strings that were never classes are not all *dropped*, and that is the design.
   * The scanner over-collects — it cannot tell a `className` from an import
   * specifier without being a parser — and what makes that safe is the invariant in
   * `scan-classes.ts`: no non-class string in this codebase starts with a utility
   * prefix. So these either vanish or collapse to a token no assertion looks at.
   * Asserting the real output rather than `[]` is the point: it records where the
   * safety actually comes from.
   */
  it('reduces strings that were never classes to nothing any check looks at', () => {
    // An import specifier: truncated at the first `/`, since that is the opacity
    // modifier's separator.
    expect(utilities('@/lib/cn')).toEqual(['@'])
    // A URL: the scheme's colon reads as a variant, and what is left starts with `/`.
    expect(utilities('https://example.com/x')).toEqual([])
    // A MIME type.
    expect(utilities('image/svg+xml')).toEqual(['image'])
    // A quoted CSS declaration.
    expect(utilities('display: flex')).toEqual(['flex'])
  })

  it('keeps ordinary prose harmless', () => {
    // Prose is collected — `aria-label` and `sr-only` text are string literals too —
    // and none of it starts with a utility prefix, which is what makes that safe.
    expect(utilities('Skip to main content')).toEqual(['Skip', 'to', 'main', 'content'])
  })
})
