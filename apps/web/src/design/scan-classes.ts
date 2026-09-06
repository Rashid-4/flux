/**
 * A small tokenizer that pulls candidate Tailwind class names out of source text.
 *
 * `palette.test.ts` uses it to check every utility in the application against the
 * vocabulary in `theme-keys.ts`. It lives in its own module rather than inside the
 * test because getting it wrong in either direction is expensive: a scanner that
 * misses classes makes the test pass over the drift it exists to find, and a
 * scanner that invents them makes the test fail on prose.
 *
 * ### Why it reads string literals rather than the whole file
 *
 * The naive version greps the file text for `/[a-z-]+-[a-z0-9-]+/g`. That cannot
 * work here, because these components are heavily commented and the comments are
 * *about* class names — `dialog.tsx` explains why `bg-black/50` was replaced,
 * `select.tsx` explains why `line-clamp-1` was dropped, the README lists every
 * shadcn class we removed. A whole-text scan flags all of them, so the test would
 * fail on its own documentation and the only way to make it pass would be to stop
 * documenting decisions.
 *
 * So this walks the source with a tiny state machine, tracking string, template and
 * comment state, and collects only what is inside a string literal. Class names in
 * this codebase are always in one: `className="…"`, `cn('…', '…')`, a `cva` base
 * array, a `class="…"` attribute in index.html.
 *
 * ### What it deliberately does not attempt
 *
 * It is not a JavaScript parser. It does not distinguish a `className` string from
 * an import specifier or an `aria-label`, so `'@/lib/cn'` and `'Skip to main
 * content'` are collected too. That is fine — the checks are all of the form "if
 * this token starts with `bg-`, its value must be a known colour", and no
 * non-class string in this codebase starts with a utility prefix. If one ever does,
 * the test fails and the fix is to name the constant rather than to loosen the
 * scanner.
 *
 * ### Regex literals, and why they get real handling
 *
 * The first draft skipped them, on the reasoning that a stray quote inside a regex
 * would at worst collect some garbage that matches no prefix. That was wrong, and
 * this file's own source proved it within a minute of the test first running.
 *
 * `htmlClassAttributes` below contains `/\bclass=(?:"([^"]*)"|'([^']*)')/g`. Read
 * character by character with no regex awareness, the `"` opens a string, the next
 * `"` closes it, the `|'` opens another, and the final `'` opens a **third** that
 * has no closing quote for another forty lines — so the scanner swallowed a doc
 * comment as though it were a class string, and reported `animate-pop-in\`` as an
 * unknown animation.
 *
 * The garbage was the harmless half. The dangerous half is that everything between
 * the desynchronising quote and the resynchronising one is read in the wrong state:
 * real class strings in that range are consumed as ordinary source and **never
 * collected**. A scanner that quietly stops seeing part of a file is precisely the
 * "check that passes over a blind spot" CLAUDE.md warns about — it would have
 * reported success over whatever it had skipped.
 *
 * So `/` is disambiguated the way a real tokenizer does it, from the preceding
 * significant token: a `/` can only begin a regex where an expression cannot
 * already have ended. In TSX that distinction has to include the JSX forms —
 * `<div />` and `</div>` both put a `/` after something that ends an expression —
 * which is why the test below is an allowlist of *positions where a regex is
 * possible* rather than a denylist of characters. Getting that backwards fails
 * closed on JSX, which is most of this codebase.
 */

const IDENTIFIER = /[A-Za-z0-9_$]/

/**
 * Characters after which a `/` cannot be division, because no expression has
 * ended yet — so it must open a regex literal.
 *
 * This is an allowlist rather than a denylist on purpose. The characters that
 * precede a `/` in TSX and are *not* regex positions are the interesting set —
 * `<` in `</div>`, `}` in `{...props} />`, `"` in `className="x" />`, an
 * identifier in `<br />` — and a denylist that forgets any one of them turns
 * every JSX close tag into a regex and swallows the rest of the file. An
 * allowlist that forgets an entry merely reads one real regex as division,
 * which is the failure this module can absorb.
 */
const REGEX_PRECEDERS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
])

/** Keywords after which a `/` is a regex: `return /re/.test(x)`. */
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'case',
  'delete',
  'void',
  'new',
  'do',
  'else',
  'yield',
  'await',
])

function startsRegex(prev: string, beforePrev: string, prevWord: string): boolean {
  // Start of file.
  if (prev === '') return true
  // `>` is the ambiguous one: a regex can follow an arrow (`=> /re/`) but never a
  // JSX tag close (`<div>`), and both end in the same character.
  if (prev === '>') return beforePrev === '='
  if (REGEX_PRECEDERS.has(prev)) return true
  return prevWord !== '' && REGEX_KEYWORDS.has(prevWord)
}

/** The index just past a regex literal that opens at `start`. */
function skipRegexLiteral(source: string, start: number): number {
  const n = source.length
  let i = start + 1
  let inCharacterClass = false

  while (i < n) {
    // `charAt` rather than `[i]`: it is typed `string`, not `string | undefined`,
    // so the bounds the loop already guarantees do not have to be re-asserted with
    // a non-null assertion on every read. Past the end it returns '', which matches
    // none of the comparisons below.
    const c = source.charAt(i)
    if (c === '\\') {
      i += 2
      continue
    }
    // A regex literal cannot contain a raw newline. Reaching one means the guess
    // above was wrong, so stop at the line end: one line of damage instead of
    // the rest of the file.
    if (c === '\n') break
    if (inCharacterClass) {
      if (c === ']') inCharacterClass = false
    } else if (c === '[') {
      // `/` inside `[…]` is not the terminator — this is exactly what
      // `htmlClassAttributes`'s own pattern needs.
      inCharacterClass = true
    } else if (c === '/') {
      i += 1
      break
    }
    i += 1
  }

  while (i < n && /[a-z]/.test(source.charAt(i))) i += 1
  return i
}

/**
 * Every string literal in a TypeScript/TSX source, as raw text.
 *
 * A template literal is emitted as one entry per static chunk rather than one
 * per literal: `` `grid-cols-${n} gap-2` `` yields `grid-cols-` and ` gap-2`.
 * That is not a compromise, it is the correct reading — a class name spanning an
 * interpolation is not a fixed string and cannot be checked against a token list
 * either way, and splitting at the boundary keeps the scanner from gluing the two
 * sides of one into a token that appears nowhere in the source. Nested
 * interpolations re-enter code state properly, so a quote inside `${…}` cannot
 * desynchronise the literal it sits in.
 */
export function stringLiterals(source: string): string[] {
  const out: string[] = []
  const n = source.length

  let state: 'code' | "'" | '"' | '`' = 'code'
  let value = ''
  /** Brace depth at each `${` we are currently inside, innermost last. */
  const interpolations: number[] = []
  let braceDepth = 0

  // The last significant character, the one before it, and the last identifier —
  // together, enough to tell a regex from a division.
  let prev = ''
  let beforePrev = ''
  let prevWord = ''
  let i = 0

  const mark = (c: string, word = '') => {
    beforePrev = prev
    prev = c
    prevWord = word
  }

  while (i < n) {
    const c = source.charAt(i)

    if (state === "'" || state === '"') {
      // A backslash escapes the next character, including the quote itself.
      if (c === '\\') {
        value += source[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === state) {
        out.push(value)
        value = ''
        state = 'code'
        mark(c)
        i += 1
        continue
      }
      value += c
      i += 1
      continue
    }

    if (state === '`') {
      if (c === '\\') {
        value += source[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === '`') {
        out.push(value)
        value = ''
        state = 'code'
        mark(c)
        i += 1
        continue
      }
      if (c === '$' && source[i + 1] === '{') {
        out.push(value)
        value = ''
        interpolations.push(braceDepth)
        braceDepth += 1
        state = 'code'
        mark('{')
        i += 2
        continue
      }
      value += c
      i += 1
      continue
    }

    // Comments: a `//` or `/*` outside a string swallows everything up to its
    // terminator, which is what keeps the prose in these files out of the
    // results. Checked before the regex/division split because `//` is neither.
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1
      continue
    }

    if (IDENTIFIER.test(c)) {
      let word = ''
      while (i < n && IDENTIFIER.test(source.charAt(i))) {
        word += source.charAt(i)
        i += 1
      }
      mark(word.charAt(word.length - 1), word)
      continue
    }

    if (c === '/') {
      i = startsRegex(prev, beforePrev, prevWord) ? skipRegexLiteral(source, i) : i + 1
      mark('/')
      continue
    }

    if (c === "'" || c === '"' || c === '`') {
      state = c
      i += 1
      continue
    }

    if (c === '{') {
      braceDepth += 1
      mark(c)
      i += 1
      continue
    }
    if (c === '}') {
      braceDepth -= 1
      if (interpolations.length > 0 && braceDepth === interpolations[interpolations.length - 1]) {
        interpolations.pop()
        state = '`'
        i += 1
        continue
      }
      mark(c)
      i += 1
      continue
    }

    mark(c)
    i += 1
  }

  // An unterminated literal at EOF: emit what was collected rather than dropping
  // it, so a truncated file fails the caller's checks loudly instead of quietly.
  if (value !== '') out.push(value)

  return out
}

/** Every `class="…"` attribute value in an HTML source. */
export function htmlClassAttributes(source: string): string[] {
  // Comments stripped first, for the same reason as above: index.html explains
  // its own skip-link classes in a comment directly above them.
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '')
  const out: string[] = []
  // `[\s\S]` rather than `.` because the skip link's class list is wrapped across
  // several lines by prettier, and `.` stops at the newline.
  const attribute = /\bclass=(['"])([\s\S]*?)\1/g
  let match: RegExpExecArray | null
  while ((match = attribute.exec(withoutComments)) !== null) {
    out.push(match[2] ?? '')
  }
  return out
}

/**
 * Strip Tailwind variant prefixes from a class token, returning the bare utility.
 *
 * `hover:bg-surface-2` → `bg-surface-2`
 * `data-[state=open]:animate-pop-in` → `animate-pop-in`
 * `group-data-[size=sm]/avatar:size-4` → `size-4`
 * `[&_svg:not([class*='size-'])]:size-3.5` → `size-3.5`
 *
 * Bracket depth is tracked so the colons *inside* an arbitrary variant — and there
 * are several, `:not(…)` being the common one — are not mistaken for the variant
 * separator. Returns `null` for a token that is not a plausible class at all.
 */
export function stripVariants(token: string): string | null {
  let depth = 0
  let start = 0

  for (let i = 0; i < token.length; i += 1) {
    const c = token[i]
    if (c === '[' || c === '(') depth += 1
    else if (c === ']' || c === ')') depth -= 1
    else if (c === ':' && depth === 0) start = i + 1
  }

  const utility = token.slice(start)
  return utility === '' ? null : utility
}

/**
 * The classes in a whitespace-separated class string, as bare utilities with
 * variants, negation, `!important` and any opacity modifier removed.
 *
 * Tokens carrying an arbitrary value (`w-[calc(100%-2rem)]`) are dropped: those are
 * `eslint.config.mjs`'s jurisdiction, which bans them for every prefix that can
 * carry a token and permits them for the layout escapes. Checking them here would
 * duplicate that rule and disagree with it eventually.
 */
export function utilities(classString: string): string[] {
  const out: string[] = []

  for (const raw of classString.split(/\s+/)) {
    if (raw === '') continue

    const stripped = stripVariants(raw)
    if (stripped === null) continue

    // `!bg-primary` and `bg-primary!` are both valid important syntax in v4.
    let utility = stripped.replace(/^!/, '').replace(/!$/, '')
    // Negative utilities: `-mb-px`, `-outline-offset-2`.
    utility = utility.replace(/^-/, '')
    // Opacity modifier: `bg-overlay/50` → `bg-overlay`. Split before the check so
    // the base colour is what gets validated.
    const slash = utility.indexOf('/')
    if (slash !== -1) utility = utility.slice(0, slash)

    if (utility === '') continue
    // Arbitrary values and arbitrary properties belong to lint, not here.
    if (utility.includes('[') || utility.includes(']')) continue
    // A colon surviving variant-stripping means this was never a class — a CSS
    // declaration quoted in a string, a URL, a `type/subtype`.
    if (utility.includes(':')) continue

    out.push(utility)
  }

  return out
}
