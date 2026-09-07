#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if a tracked file is not reviewable text: a NUL byte, invalid
// UTF-8, or a bidirectional control character.
//
// WHY THIS EXISTS
//
// `apps/web/src/keyboard/registry.ts` keys a Map by two strings joined by a
// separator that cannot occur in either of them:
//
//     return `${binding}\u0000${id}`
//
// The separator is the right choice — `.` is in every id, and `+` and a space
// are both in bindings like `mod+k` and `g then b`, so every printable
// candidate can collide. What was wrong is that the byte was typed *raw*
// rather than written as the escape.
//
// git decides a blob is binary if it finds a NUL **in the first 8000 bytes**.
// This one landed at offset 6891, so the file compiled, typechecked, passed
// its tests, formatted clean, linted clean — and `git diff` reported
//
//     apps/web/src/keyboard/registry.ts | Bin 14293 -> 16354 bytes
//
// in place of the change. A 76-line edit to a reviewed module, invisible to
// review, to `git blame`, to `git log -p`, and to every diff view on GitHub.
// Nothing in the toolchain has an opinion about this: a NUL is valid UTF-8 and
// valid TypeScript inside a string literal, so the file was correct by every
// check the repository had and unreviewable by all of them. It was caught
// before it was committed, and only by reading the diffstat.
//
// **That 8000 is why this is a check and not a habit.** Two other files carry
// the same raw byte — `scripts/check-field-vocabularies.mjs` at offset 13030
// and `services/api/src/http/validate.ts` at 12937 — and both have been
// committed for months with their diffs rendering perfectly normally, because
// their NULs sit past the window git looks in. Same defect, same line of code,
// opposite outcome, decided by nothing but how much text happens to be above
// it. Neither file is safe: 5KB of new header above either one flips it to
// binary with no edit to the line at fault and no warning from anything.
//
// So the rule is the byte, not the byte's position. A property that holds by
// luck is a property that has not been checked.
//
// Rule C is a different hazard with the same signature — looking like text to
// a reviewer while being something else to a machine. Bidirectional override
// and isolate controls reorder the *display* of a line without changing what
// the compiler reads, so
//
//     if (isAdmin) { /*<RLO> } ; harmless(); if (false) { */ }
//
// can be made to render as a comment while executing. That is Trojan Source
// (CVE-2021-42574). None of these characters has a legitimate use in this
// repository — there is no right-to-left content in it — and the check is
// deliberately narrow: it does not ban ZWJ or ZWNJ, which are how emoji
// sequences and several scripts are legitimately written.
//
// The rules apply to **tracked** files, enumerated from git rather than from
// a directory walk, because the property being protected is a property of
// blobs. A file git does not have cannot be in a diff git shows.
//
// WHAT THIS DOES NOT CHECK
//
// Named, because a check that passes over a blind spot licenses the belief
// that the tree is clean — see CLAUDE.md.
//
//   • **Untracked files.** A new file with a NUL in it passes here until it
//     is `git add`ed. That is the moment the property starts to matter, so
//     the timing is right, but it does mean a local edit can sit dirty and
//     green.
//   • **Whether BINARY_PATHS is still accurate.** The list is empty today
//     because the repository is 100% text: there is not one tracked image,
//     font or archive. Inter arrives through `@fontsource-variable/inter` and
//     `UI Images/` is gitignored. When the first real binary lands it needs an
//     entry, and a stale entry is caught by Rule D rather than by reading.
//   • **Line endings, trailing whitespace, tabs, final newline.** Prettier
//     owns all four and `pnpm format:check` enforces them. Duplicating that
//     here would give two sources of truth for one property.
//   • **Homoglyphs.** A Cyrillic `а` in an identifier is legal, renders
//     identically to `a`, and is not detectable without a policy about which
//     scripts may appear where. Out of scope; named so it is not assumed
//     covered.
//
// NEGATIVE-TESTED
//
//   • A raw NUL written back into `entryKey` → Rule A fails, naming the file,
//     the line, and the escape to use. `format:check`, `lint`, `typecheck`
//     and all 1019 web tests stayed green on exactly that content, which is
//     the whole point — the gate was run with the NUL in place before it was
//     found, and reported nothing.
//   • A lone 0xE9 (a Latin-1 paste) → Rule B fails.
//   • A U+202E planted in a `.ts` comment → Rule C fails and names it. No
//     other check in CI notices.
//   • A `BINARY_PATHS` entry for a file that is text → Rule D fails; an entry
//     for a path that is not tracked → Rule D fails with the other message.
// ════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import process from 'node:process'

/**
 * Tracked paths that are legitimately not text, and why each one is here.
 *
 * Empty, and that is a measured fact rather than an omission — `git ls-files`
 * returns 388 paths and every one of them decodes as UTF-8 with no NUL. A
 * favicon would be the first entry; see `check:public` for the separate
 * question of whether a static asset ships.
 *
 * Exact paths, not globs. A glob like `**\/*.png` would silently cover a file
 * nobody meant to add, and the point of an allowlist is that each entry was a
 * decision.
 */
const BINARY_PATHS = []

/**
 * Bidirectional formatting characters, and nothing else.
 *
 * The five overrides and embeddings (U+202A–U+202E) plus the four isolates
 * (U+2066–U+2069) are the Trojan Source set. U+200E, U+200F and U+061C are
 * the marks: weaker, still display-reordering, still without a use here.
 *
 * ZWJ (U+200D), ZWNJ (U+200C) and the BOM are deliberately absent — the first
 * two are load-bearing in emoji and in Indic and Persian text, and a BOM is
 * Prettier's business.
 */
const BIDI = new Map([
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0x061c, 'ARABIC LETTER MARK'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
])

/**
 * `-z` and a NUL split, because a path may contain a newline and `git ls-files`
 * would then quote it — at which point a line-split reader is reading a path
 * that does not exist. Ironic given the subject, and the reason this is not a
 * `.split('\n')`.
 */
function trackedPaths() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out.split('\0').filter((path) => path !== '')
}

/** The 1-based line a byte offset falls on, for an error a person can act on. */
function lineOf(buffer, offset) {
  let line = 1
  for (let i = 0; i < offset; i += 1) if (buffer[i] === 0x0a) line += 1
  return line
}

const failures = []
let scanned = 0
let skipped = 0

for (const path of trackedPaths()) {
  /**
   * A tracked path with no file is a deletion staged but not committed, or a
   * sparse checkout. Neither is this check's business.
   */
  let stat
  try {
    stat = statSync(path)
  } catch {
    continue
  }
  if (!stat.isFile()) continue

  if (BINARY_PATHS.includes(path)) {
    skipped += 1
    continue
  }
  scanned += 1

  const buffer = readFileSync(path)

  // ── Rule A — no NUL byte ────────────────────────────────────────────
  const nul = buffer.indexOf(0)
  if (nul !== -1) {
    const total = buffer.filter((byte) => byte === 0).length
    failures.push({
      rule: 'A',
      subject: `${path}:${String(lineOf(buffer, nul))}`,
      detail: [
        `  contains a NUL byte (${String(total)} in the file), so git classifies the blob as`,
        `  binary and every diff of it reports "Bin <n> -> <m> bytes" instead of the change.`,
        ``,
        `  If it is a separator in a string or template literal, write the escape:`,
        `  \`\\u0000\` in TypeScript and JavaScript. Identical value, reviewable file.`,
        `  If the file is genuinely binary, add its exact path to BINARY_PATHS in`,
        `  this script with a comment saying what it is.`,
      ].join('\n'),
    })
    continue
  }

  // ── Rule B — decodes as UTF-8 ───────────────────────────────────────
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    failures.push({
      rule: 'B',
      subject: path,
      detail: [
        `  is not valid UTF-8. Tools in this repository assume it — \`git ls-files\`,`,
        `  Prettier, \`tsc\` and every check script read it as UTF-8 — and a lone`,
        `  high byte is usually a Latin-1 paste that will render as a mojibake box`,
        `  for the next reader.`,
        ``,
        `  Re-save as UTF-8, or add the path to BINARY_PATHS if it is not text.`,
      ].join('\n'),
    })
    continue
  }

  // ── Rule C — no bidirectional control characters ────────────────────
  for (let i = 0; i < text.length; i += 1) {
    const name = BIDI.get(text.codePointAt(i))
    if (name === undefined) continue
    failures.push({
      rule: 'C',
      subject: `${path}:${String(text.slice(0, i).split('\n').length)}`,
      detail: [
        `  contains U+${text.codePointAt(i).toString(16).toUpperCase().padStart(4, '0')} ${name}.`,
        ``,
        `  These characters reorder how a line *displays* without changing what the`,
        `  compiler reads, so reviewed source can execute something other than what`,
        `  it appears to say — CVE-2021-42574, "Trojan Source". There is no`,
        `  right-to-left content in this repository, so there is no legitimate use.`,
      ].join('\n'),
    })
    break
  }
}

// ── Rule D — no stale allowlist entry ─────────────────────────────────
for (const path of BINARY_PATHS) {
  let buffer
  try {
    buffer = readFileSync(path)
  } catch {
    failures.push({
      rule: 'D',
      subject: path,
      detail: [
        `  is in BINARY_PATHS and is not a tracked file. Remove the entry — an`,
        `  allowlist nobody prunes is how an exemption outlives the thing it excused.`,
      ].join('\n'),
    })
    continue
  }
  if (!buffer.includes(0)) {
    failures.push({
      rule: 'D',
      subject: path,
      detail: [
        `  is in BINARY_PATHS but contains no NUL byte, so it is text and does not`,
        `  need the exemption. Remove the entry so the file is checked.`,
      ].join('\n'),
    })
  }
}

console.log(
  `Checked ${String(scanned)} tracked file(s) for NUL bytes, UTF-8 validity and bidi controls` +
    (skipped === 0 ? '.' : `; ${String(skipped)} allowlisted as binary.`),
)

if (failures.length > 0) {
  console.error('')
  for (const failure of failures) {
    console.error(`  ✗ [Rule ${failure.rule}] ${failure.subject}`)
    console.error(failure.detail)
    console.error('')
  }
  console.error('  A file the toolchain accepts and a reviewer cannot read is not a')
  console.error('  cosmetic problem. The header has the full account, including why two')
  console.error('  files got away with it and one did not.')
  console.error('')
  process.exit(1)
}

console.log('✓ Every tracked file is reviewable text.')
