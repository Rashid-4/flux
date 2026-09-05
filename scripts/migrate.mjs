#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Migration runner.
//
// Deliberately ~150 lines of plain SQL-file application rather than an
// ORM's migration tool. Reasons:
//   • Flux's schema uses RLS policies, rules, triggers, and procedures
//     that ORM migration DSLs model poorly or not at all.
//   • Plain .sql files are reviewable by anyone, diffable, and runnable
//     by a DBA without the app.
//   • Checksums make applied migrations immutable, which is what forces
//     the expand/contract discipline (docs/conventions.md §Migrations)
//     instead of letting someone "just fix" a shipped migration.
//
// Runs as flux_migrator (DATABASE_MIGRATOR_URL) — the only role allowed
// to alter the schema. Never as flux_app.
// ════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import pg from 'pg'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

const connectionString = process.env.DATABASE_MIGRATOR_URL
if (!connectionString) {
  console.error('DATABASE_MIGRATOR_URL is not set. Copy .env.example to .env.')
  process.exit(1)
}

async function loadMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      return {
        version: file.replace(/\.sql$/, ''),
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      }
    }),
  )
}

async function appliedMigrations(client) {
  // The ledger itself is created by 0001, so on a virgin database this
  // table does not exist yet. Treat that as "nothing applied".
  const { rows } = await client.query(`
    SELECT version, checksum FROM schema_migrations
    WHERE to_regclass('schema_migrations') IS NOT NULL
  `).catch((err) => {
    if (err.code === '42P01') return { rows: [] } // undefined_table
    throw err
  })
  return new Map(rows.map((r) => [r.version, r.checksum]))
}

async function up() {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const migrations = await loadMigrations()
    const applied = await appliedMigrations(client)

    // Immutability check BEFORE applying anything: if a merged migration
    // was edited, the two databases that ran the old and new versions are
    // now silently divergent. Fail loudly rather than paper over it.
    for (const m of migrations) {
      const prior = applied.get(m.version)
      if (prior && prior !== m.checksum) {
        throw new Error(
          `${m.file} has changed since it was applied.\n` +
            `Applied migrations are immutable — add a NEW migration instead.\n` +
            `  expected ${prior}\n  found    ${m.checksum}`,
        )
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.version))
    if (pending.length === 0) {
      console.log('Up to date — no pending migrations.')
      return
    }

    for (const m of pending) {
      // Each migration is its own transaction: a failure rolls back that
      // file cleanly and leaves earlier ones applied, so a retry resumes
      // rather than restarting.
      console.log(`→ applying ${m.file}`)
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query(
          `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
          [m.version, m.checksum],
        )
        await client.query('COMMIT')
        console.log(`  ✓ ${m.version}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`${m.file} failed: ${err.message}`)
      }
    }
    console.log(`\nApplied ${pending.length} migration(s).`)
  } finally {
    await client.end()
  }
}

async function status() {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const migrations = await loadMigrations()
    const applied = await appliedMigrations(client)
    for (const m of migrations) {
      const prior = applied.get(m.version)
      const mark = !prior ? 'pending' : prior === m.checksum ? 'applied' : 'MODIFIED'
      console.log(`${mark.padEnd(9)} ${m.version}`)
    }
  } finally {
    await client.end()
  }
}

const command = process.argv[2] ?? 'up'
try {
  if (command === 'up') await up()
  else if (command === 'status') await status()
  else {
    console.error(`Unknown command: ${command}. Use "up" or "status".`)
    process.exit(1)
  }
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
}
