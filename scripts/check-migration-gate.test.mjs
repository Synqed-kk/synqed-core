import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedManualMigrations, requireMigrationConfirmation } from './check-migration-gate.mjs'

test('real git changes include additions, edits, deletions and moves out of manual SQL', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'migration-gate-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'Migration gate test')
  const dir = join(cwd, 'prisma/migrations/manual')
  mkdirSync(dir, { recursive: true })
  for (const name of ['edit', 'delete', 'move']) writeFileSync(join(dir, `${name}.sql`), 'SELECT 1;\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD')
  writeFileSync(join(dir, 'edit.sql'), 'SELECT 2;\n')
  writeFileSync(join(dir, 'add.sql'), 'SELECT 3;\n')
  rmSync(join(dir, 'delete.sql'))
  renameSync(join(dir, 'move.sql'), join(cwd, 'moved.sql'))
  git('add', '-A')
  git('commit', '-qm', 'changes')
  const head = git('rev-parse', 'HEAD')
  assert.deepEqual(changedManualMigrations(base, head, cwd).sort(),
    ['add', 'delete', 'edit', 'move'].map(name => `prisma/migrations/manual/${name}.sql`))
  assert.deepEqual(changedManualMigrations(head, head, cwd), [])
})

test('requires the exact confirmation label and rejects malformed labels', () => {
  assert.throws(() => requireMigrationConfirmation(['change.sql'], []))
  assert.throws(() => requireMigrationConfirmation(['change.sql'], ['not-migrations-applied']))
  assert.throws(() => requireMigrationConfirmation(['change.sql'], 'migrations-applied'))
  assert.doesNotThrow(() => requireMigrationConfirmation(['change.sql'], ['migrations-applied']))
  assert.doesNotThrow(() => requireMigrationConfirmation([], []))
})

test('rejects refs other than complete commit IDs', () => {
  assert.throws(() => changedManualMigrations('main', '--help'), /commit SHAs/)
})
