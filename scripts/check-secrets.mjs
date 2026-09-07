#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════
 * Committed-secret check.
 *
 * Not a replacement for a real scanner — it is the cheap check that
 * catches the specific mistake this repository is most exposed to:
 * someone fills in .env.example with working values while debugging,
 * or pastes a live token into a fixture.
 *
 * .env.example is the highest-risk file in the repo precisely because
 * it is documentation. It gets read, copied, and committed without
 * thought, so a real value in it is a real leak with a wide blast
 * radius.
 *
 * Scans tracked files only. Anything gitignored is not our problem;
 * anything tracked is public the moment the repo is.
 * ════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Values that are obviously placeholders. Kept generous on purpose: a
 * false positive here blocks a build for something harmless, which
 * teaches people to bypass the check.
 */
const PLACEHOLDER =
  /^(|(change|replace|set|fill|insert|generate|provide)[-_]?me([-_].*)?|xxx+|\.\.\.|<[^>]*>|\$\{[^}]*\}|placeholder|your[-_].*|example.*|dummy|todo|tbd|none|null|n\/a)$/i

/**
 * Local-development credentials, which are supposed to be in the file —
 * they are what docker-compose brings up and they grant access to
 * nothing but a throwaway container.
 *
 * The convention is a `_dev` suffix, so the check is a shape rather than
 * a list: a list means every new dev service needs this file edited, and
 * a check that needs editing to stay passing gets bypassed instead.
 */
const DEV_VALUE = /^[a-z0-9]+([_-][a-z0-9]+)*_dev(_[a-z0-9]+)?$/
const ALLOWED_DEV_VALUES = new Set(['flux', 'localhost', 'development', 'debug', 'info'])

const SECRET_KEY =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|CLIENT_SECRET|ACCESS_KEY|SALT|SIGNING)/i

/** Live-credential shapes, worth flagging wherever they appear. */
const HIGH_ENTROPY_PATTERNS = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\bsk_live_[0-9a-zA-Z]{20,}\b/ },
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'PEM private key', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  {
    name: 'password in a connection string',
    // Flags postgres://user:secret@host unless the secret is a known
    // dev value, a placeholder, or a `${...}` interpolation.
    //
    // The interpolation exemption is not a convenience. `postgres://u:${PW}@h`
    // contains no credential — the value is in a constant somewhere else — so
    // flagging it is a false positive on the *correct* way to write a test that
    // needs a fake password, which is the shape this repository has most of. A
    // check that fires on the right pattern gets bypassed, and the header above
    // says why that is the worse outcome.
    //
    // What it costs, stated rather than left to be discovered: a fixture
    // constant holding a *real* credential is invisible here, because this check
    // reads `KEY=VALUE` only in .env files and never follows an identifier. If a
    // live value is ever committed to a `const`, this is not the thing that will
    // find it.
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/]+:(?!flux_(app|migrator|relay)_dev\b)(?!\$\{)(?!change|your|example|placeholder|password\b)[^@\s/]{8,}@/i,
  },
]

const SKIP_EXT = /\.(png|jpe?g|gif|svg|ico|woff2?|ttf|eot|pdf|zip|gz|lock)$/i
const SKIP_PATH = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f !== '' && !SKIP_EXT.test(f) && !SKIP_PATH.test(f))
}

const problems = []

// ── .env.example: every KEY=VALUE must be a placeholder or dev value ──
for (const envFile of trackedFiles().filter((f) => /(^|\/)\.env(\..+)?$/.test(f))) {
  if (envFile === '.env' || /\/\.env$/.test(envFile)) {
    problems.push({
      file: envFile,
      line: 0,
      why: 'a .env file is tracked by git — run: git rm --cached ' + envFile,
    })
    continue
  }

  const lines = readFileSync(envFile, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return

    const eq = trimmed.indexOf('=')
    if (eq === -1) return

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    // Strip an inline comment, then quotes.
    value = value
      .replace(/\s+#.*$/, '')
      .replace(/^["'](.*)["']$/, '$1')
      .trim()

    if (
      value === '' ||
      PLACEHOLDER.test(value) ||
      DEV_VALUE.test(value) ||
      ALLOWED_DEV_VALUES.has(value)
    )
      return

    if (SECRET_KEY.test(key)) {
      problems.push({
        file: envFile,
        line: i + 1,
        why: `${key} has a concrete value. In an example file every secret must be a placeholder — this file gets copied and committed.`,
      })
    }
  })
}

// ── Live-credential shapes, anywhere in tracked text ──
for (const file of trackedFiles()) {
  // This file necessarily contains the patterns it looks for.
  if (file === 'scripts/check-secrets.mjs') continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue // binary or unreadable
  }
  if (content.includes(String.fromCharCode(0))) continue // binary

  const lines = content.split('\n')
  for (const { name, re } of HIGH_ENTROPY_PATTERNS) {
    lines.forEach((line, i) => {
      if (line.includes('check-secrets:allow')) return
      if (re.test(line)) {
        problems.push({ file, line: i + 1, why: `looks like a ${name}` })
      }
    })
  }
}

if (problems.length === 0) {
  console.log('check-secrets: OK — no committed credentials found.')
  process.exit(0)
}

console.error('')
console.error('  ✗ check-secrets: possible committed credentials.')
console.error('')
for (const p of problems) {
  console.error(`    ${p.file}${p.line ? `:${p.line}` : ''}`)
  console.error(`      ${p.why}`)
}
console.error('')
console.error('  If a match is genuinely not a secret, append a trailing')
console.error('  `check-secrets:allow` comment on that line.')
console.error('')
console.error('  If it IS a secret: removing it from the working tree is not')
console.error('  enough once it has been pushed. Rotate the credential.')
console.error('')
process.exit(1)
