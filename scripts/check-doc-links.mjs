#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if a doc links to a file that does not exist, or cites a section
// number the target does not have.
//
// WHY THIS EXISTS
//
// This is the seventh distinct kind of drift found in this repository, and it
// arrives the same way as the other six: a change that is correct in itself
// invalidates something elsewhere that nothing was watching.
//
// Two instances, both from one session of editing:
//
//   projects.md pointed at `permissions.md §8` for scheme promotion. Then
//   permissions.md gained a new §9 and its old §9/§10 became §10/§11 — so §8
//   still existed, still rendered as a working link, and now described guard
//   rails on dangerous grants instead. A dead link is annoying. A link that
//   silently resolves to the wrong section is worse, because a build agent
//   follows it and implements the wrong thing with no reason to doubt it.
//
//   issues.md said `see §8` in a paragraph whose target had shifted to §9,
//   for the same reason: seven headings were renumbered to insert §5.
//
// The fix is not "be careful when renumbering". Renumbering happens, and it is
// exactly the moment nobody re-reads the other nine specs. So:
//
//   1. Every relative markdown link resolves to a file that exists.
//   2. Every `§N` next to a link resolves to a `## N.` heading in that file.
//   3. Every bare `§N` resolves to a `## N.` heading in the SAME file.
//   4. (Note, not a failure.) Every backticked `docs/**.md` path that does not
//      exist yet — see below.
//   5. No two change requests claim one number, and each one's `# CR-NNN`
//      heading agrees with its filename. See that rule for why it lives here
//      rather than in a script of its own.
//
// Rule 3 is what catches the `see §8` case, and it is the one that would have
// caught it on the commit that broke it.
//
// Rule 4 reports, as a note rather than a failure, every backticked path to a
// doc that does not exist yet — `docs/adr/0005-lexorank-ordering.md` and friends,
// cited from contracts and scripts by path rather than by link. Those are real
// obligations and there are currently several, but they are unwritten work rather
// than drift, and a red build for work nobody claimed to have finished is a build
// people stop reading. The note is a live TODO list that cannot go stale, which is
// strictly better than the same list written into CLAUDE.md by hand.
//
// WHAT IS DELIBERATELY NOT CHECKED
//
// Anchor fragments (`file.md#some-heading`) and external URLs. The first would
// need a slug algorithm that matches whatever renders these docs, and there is
// no renderer — they are read as text by people and by agents. The second needs
// the network, and a CI job that fails because somebody else's site is down is
// a job people learn to re-run rather than read.
// ════════════════════════════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import process from 'node:process'

const ROOTS = ['docs', '.', 'db/migrations', 'packages/contracts/src']

function markdownIn(dir, depth = 0) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue
    const path = join(dir, e.name)
    if (e.isDirectory() && depth < 3) out.push(...markdownIn(path, depth + 1))
    else if (e.isFile() && e.name.endsWith('.md')) out.push(path)
  }
  return out
}

const files = [...new Set(ROOTS.flatMap((r) => markdownIn(r)))].sort()

/**
 * Files scanned for backticked doc paths only (rule 4). Contracts and scripts
 * cite ADRs by path in comments, and those are the citations most likely to
 * outlive the thing they point at.
 */
const CITING_DIRS = ['packages/contracts/src', 'scripts', 'db/migrations']

function sourcesIn(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(ts|mjs|sql)$/.test(e.name) && !e.name.endsWith('.d.ts'))
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/** file → Set of numbered `## N.` headings it defines. */
const sectionsByFile = new Map()

function sectionsOf(file) {
  if (sectionsByFile.has(file)) return sectionsByFile.get(file)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    sectionsByFile.set(file, null)
    return null
  }
  const found = new Set()
  for (const m of text.matchAll(/^#{2,3}\s+(\d+)\./gm)) found.add(Number(m[1]))
  sectionsByFile.set(file, found)
  return found
}

const missingFile = []
const missingSection = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const here = dirname(file)

  // ── 1 + 2. [label](target.md) optionally followed by §N ─────────────
  // The §N may sit inside the same parenthesis, right after the link, or a
  // few words later ("see [x.md](x.md) §4, step 2"), so allow a short gap
  // but not enough to cross into the next sentence.
  for (const m of text.matchAll(/\[[^\]]+\]\(([^)#\s]+\.md)\)(.{0,24}?§(\d+))?/gs)) {
    const [, target, , section] = m
    const resolved = normalize(join(here, target))

    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      missingFile.push(`${file} → ${target} (resolved ${resolved})`)
      continue
    }
    if (section === undefined) continue

    const sections = sectionsOf(resolved)
    if (sections && sections.size && !sections.has(Number(section))) {
      const have = [...sections].sort((a, b) => a - b)
      missingSection.push(
        `${file} → ${target} §${section} — ${target} has ` +
          `§${have[0]}–§${have[have.length - 1]}`,
      )
    }
  }

  // ── 3. A bare §N, meaning a section of this same file ───────────────
  // Skip any §N that was already consumed as part of a link above, which is
  // why this runs on a copy with the link forms blanked out.
  const withoutLinks = text.replace(/\[[^\]]+\]\([^)]*\)(.{0,24}?§\d+)?/gs, ' ')
  const own = sectionsOf(file)
  if (!own || !own.size) continue

  for (const m of withoutLinks.matchAll(/§(\d+)/g)) {
    const n = Number(m[1])
    if (own.has(n)) continue
    const have = [...own].sort((a, b) => a - b)
    missingSection.push(`${file} → own §${n} — this file has §${have[0]}–§${have[have.length - 1]}`)
  }
}

// ── 4. Backticked or bare paths to docs that do not exist yet ─────────
// Informational. These are obligations, not drift.
const promised = new Map()

for (const file of [...files, ...CITING_DIRS.flatMap(sourcesIn)]) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const m of text.matchAll(/\b(docs\/[A-Za-z0-9._/-]*\.md)\b/g)) {
    const target = m[1]
    if (existsSync(target)) continue
    // `docs/change-requests/NNN-short-title.md` is a naming convention, not a
    // path — the template and the frozen-paths script both spell it out.
    if (/\bNNN\b/.test(target)) continue
    // This file's own header quotes the citations it exists to report on.
    if (file === 'scripts/check-doc-links.mjs') continue
    if (!promised.has(target)) promised.set(target, new Set())
    promised.get(target).add(file)
  }
}

// ── 5. Change-request numbers are unique, and match their own heading ─
//
// A different failure mode from the four above, and the one that produced this
// rule: two branches each added `docs/change-requests/010-*.md` with different
// slugs. Git merged both without a conflict, because the filenames differ — so
// `main` ended up with two CR-010s, and every later reference to "CR-010" was
// ambiguous with nothing anywhere reporting it. Renumbering after the fact means
// editing whatever already cites the loser.
//
// This cannot be caught on the branch that causes it: each branch is internally
// consistent, and the collision only exists once both have landed. So the check
// is deliberately positioned to fail on `main` immediately after the second
// merge, which blocks the next PR rather than the one that introduced it. Late,
// and still far earlier than a human noticing two files with the same prefix.
//
// The second half — the `# CR-NNN` heading agreeing with the filename prefix —
// is the one that pays on every rename. Renumbering a CR is two edits (the file
// name and the H1) plus every citation, and the H1 is the one that gets
// forgotten, because nothing reads it except a person who already knows which
// file they opened.
const crNumbers = new Map()
const crProblems = []

for (const file of files.filter((f) => f.startsWith('docs/change-requests/'))) {
  const name = file.slice('docs/change-requests/'.length)
  if (name === 'TEMPLATE.md') continue
  const prefix = /^(\d+)-/.exec(name)
  if (!prefix) {
    crProblems.push(
      `${file} — filename does not start with a number. Convention is NNN-short-title.md`,
    )
    continue
  }
  const n = prefix[1]
  if (!crNumbers.has(n)) crNumbers.set(n, [])
  crNumbers.get(n).push(file)

  const heading = /^#\s+CR-(\d+)\b/m.exec(readFileSync(file, 'utf8'))
  if (!heading) {
    crProblems.push(
      `${file} — no \`# CR-${n} — …\` heading. The number must be readable from the file itself`,
    )
  } else if (heading[1] !== n) {
    crProblems.push(`${file} — heading says CR-${heading[1]}, filename says ${n}`)
  }
}

for (const [n, group] of [...crNumbers].sort()) {
  if (group.length > 1)
    crProblems.push(`CR-${n} is claimed by ${group.length} files: ${group.join(', ')}`)
}

console.log(`Checked ${files.length} markdown file(s).`)

if (crProblems.length) {
  console.error('\n✗ Change-request numbering:')
  for (const u of crProblems.sort()) console.error(`  • ${u}`)
  console.error(
    '\nA CR number is how the contracts, the specs and the commit messages refer\n' +
      'to a decision. Two files answering to one number makes every one of those\n' +
      'references ambiguous, and git will never report it — the filenames differ.',
  )
}

if (missingFile.length) {
  console.error('\n✗ Links to files that do not exist:')
  for (const u of [...new Set(missingFile)].sort()) console.error(`  • ${u}`)
}

if (missingSection.length) {
  console.error('\n✗ Section references that do not resolve:')
  for (const u of [...new Set(missingSection)].sort()) console.error(`  • ${u}`)
  console.error(
    '\nA §N that resolves to the wrong section is worse than a dead one: it\n' +
      'renders correctly and sends a build agent to confidently implement the\n' +
      'wrong thing. Renumbering a spec means re-checking every reference into it.',
  )
}

if (promised.size) {
  console.log(`\nℹ ${promised.size} doc(s) cited by path but not yet written:`)
  for (const [target, from] of [...promised].sort()) {
    console.log(`  ${target}  ← ${[...from].sort().join(', ')}`)
  }
  console.log(
    '  Not a failure — these are unwritten, not broken. But a citation to a\n' +
      '  document that does not exist is a promise, and the build agent reading\n' +
      '  it has no way to tell which of the two it is.',
  )
}

if (missingFile.length || missingSection.length || crProblems.length) process.exitCode = 1
else {
  console.log('\n✓ Every relative doc link and every §N reference resolves.')
  console.log(`✓ ${crNumbers.size} change-request number(s), each unique and matching its heading.`)
}
