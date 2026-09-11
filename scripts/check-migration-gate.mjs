import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function changedManualMigrations(base, head, cwd = process.cwd()) {
  if (![base, head].every(ref => /^[a-f0-9]{40}$/.test(ref))) {
    throw new Error('Migration gate requires full base and head commit SHAs')
  }
  // Include edits, removals and both sides of renames. An applied label does
  // not exempt modified SQL from review; additions-only missed that case.
  return execFileSync('git', [
    'diff', '--name-only', '--no-renames', '-z', `${base}...${head}`,
    '--', 'prisma/migrations/manual/',
  ], { cwd, encoding: 'utf8' }).split('\0').filter(path => path.endsWith('.sql'))
}

export function migrationConfirmationLabel(head) {
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Confirmation requires the full PR head SHA')
  // 46 characters: fits GitHub's label length while retaining the full SHA.
  return `db-ok:${head}`
}

export function requireMigrationConfirmation(files, labels, head) {
  const requiredLabel = migrationConfirmationLabel(head)
  if (!Array.isArray(labels) || !labels.every(label => typeof label === 'string')) {
    throw new Error('Invalid PR labels')
  }
  if (files.length && !labels.includes(requiredLabel)) {
    throw new Error(`Manual SQL changed. Apply and verify it in production, then add ${requiredLabel} to this PR. Older confirmations do not approve this revision.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const files = changedManualMigrations(process.env.BASE_SHA, process.env.HEAD_SHA)
    if (files.length) {
      const summary = `### Changed manual migrations\n\n${files.map(path => `- ${path}`).join('\n')}\n\nApply and verify these changes in production, then add the label ${migrationConfirmationLabel(process.env.HEAD_SHA)}. Every new commit needs a new confirmation; an old label cannot authorize it. This is human attestation, not database verification.\n`
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
      console.log(summary)
    }
    requireMigrationConfirmation(files, JSON.parse(process.env.PR_LABELS ?? '[]'), process.env.HEAD_SHA)
    console.log(files.length ? 'Production migration attestation present.' : 'No manual SQL changes.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
