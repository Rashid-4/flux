/**
 * A small reader for `tokens.css`, as text.
 *
 * Two tests parse that file and they must agree about what it says.
 * `theme-keys.test.ts` checks that the vocabulary in `theme-keys.ts` matches the
 * `@theme inline` block; `contrast.test.ts` checks that the colours in `:root` and
 * `.dark` actually meet the ratios their comments claim. Both need the same three
 * operations — find a block, list the custom properties it declares, read one
 * property's value — and a second copy of those forty lines is the failure mode this
 * whole directory exists to prevent. So there is one copy, here, and both tests
 * import it.
 *
 * ### Why it takes the CSS as a string
 *
 * It does not read the file. `tsconfig.app.json` compiles `src/` with
 * `types: ["vite/client"]` and no node types, precisely so application code cannot
 * import `node:fs` — and this module lives in `src/`. `scan-classes.ts` is built the
 * same way for the same reason: the *test* does the `readFileSync` and passes the
 * text in. That keeps the guarantee that nothing in `src/` outside a test can touch
 * the filesystem, which is worth more than saving one line per caller.
 *
 * ### Why not `import './tokens.css'`, or `?raw`
 *
 * `import './tokens.css'` hands the question to Tailwind's compiler, which is the
 * thing being checked. `?raw` returns an empty string under vitest, because
 * `css: false` in `vitest.config.ts` stubs every CSS module including the raw form —
 * so an assertion written against it would pass over nothing at all. Reading the
 * bytes is the only way to assert what the file *says*.
 *
 * ### Blind spots, recorded because a check that quietly sees nothing is worse than
 * no check
 *
 * - Only top-level blocks are found, and only up to the next line that is exactly
 *   `}`. A token declared inside a media query or a nested rule is invisible.
 *   Nothing does that today, and `theme-keys.test.ts` asserts the three blocks it
 *   reads contain no `{` rather than assuming it — so a future nested rule fails
 *   loudly instead of making a coverage assertion silently incomplete.
 * - `declaredProps` requires exactly two leading spaces, which is what prettier
 *   produces for a declaration inside a top-level block. A hand-indented line is
 *   not seen. That is deliberate: `pnpm format:check` runs in CI, so the indentation
 *   is machine-guaranteed, and a looser pattern would start matching the `--modifier`
 *   continuation lines.
 * - Nothing here understands CSS. A value is the text between `:` and `;`.
 */

/**
 * Comments removed.
 *
 * Every caller wants this rather than the raw file, because `tokens.css` documents
 * itself heavily and its header names `@theme`, `@custom-variant` and several token
 * names while explaining them. Counting occurrences in the raw text counts prose —
 * `it('uses @theme inline, never a bare @theme')` would fail on the paragraph that
 * says why bare `@theme` is wrong.
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * The text between `<opener>` and the next line that is exactly `}`.
 *
 * The first occurrence wins, which matters: `@layer base` redeclares both `:root`
 * and `.dark` to set `color-scheme`, and the semantic blocks are the ones every
 * caller means.
 */
export function block(code: string, opener: string): string {
  const start = code.indexOf(opener)
  if (start === -1) throw new Error(`tokens.css has no ${opener} block`)
  const from = start + opener.length
  const end = code.indexOf('\n}', from)
  if (end === -1) throw new Error(`tokens.css: ${opener} block is never closed`)
  return code.slice(from, end)
}

/**
 * Custom-property names declared directly in a block, ignoring the `--modifier`
 * forms (`--text-sm--line-height`) which belong to the property before them.
 */
export function declaredProps(source: string): string[] {
  const names: string[] = []
  for (const line of source.split('\n')) {
    const match = /^ {2}--([a-z0-9-]+)\s*:/.exec(line)
    const name = match?.[1]
    if (name !== undefined && !name.includes('--')) names.push(name)
  }
  return names
}

/** Value names in one `@theme` namespace, e.g. `card` from `--radius-card`. */
export function namespaceValues(source: string, namespace: string): string[] {
  return declaredProps(source)
    .filter((name) => name.startsWith(`${namespace}-`))
    .map((name) => name.slice(namespace.length + 1))
}

/** The declared value of one custom property, without its trailing semicolon. */
export function declaredValue(source: string, property: string): string | undefined {
  return new RegExp(`^ {2}--${property}\\s*:\\s*([^;]+);`, 'm').exec(source)?.[1]?.trim()
}

/** Semantic tokens a block reads through `var()`. */
export function referencedVars(source: string): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
    const name = match[1]
    if (name !== undefined) names.add(name)
  }
  return names
}

/** The three blocks every caller wants, parsed once from one string. */
export interface TokenBlocks {
  /** The whole file with comments stripped, for file-level assertions. */
  readonly code: string
  readonly theme: string
  readonly root: string
  readonly dark: string
}

/** Parse `tokens.css` source text into its three semantic blocks. */
export function readTokens(css: string): TokenBlocks {
  const code = stripComments(css)
  return {
    code,
    theme: block(code, '@theme inline {'),
    root: block(code, ':root {'),
    dark: block(code, '.dark {'),
  }
}
