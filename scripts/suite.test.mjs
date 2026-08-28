// Does `npm test` actually run the tests?
//
// The suite is an explicit list of filenames in package.json rather than a
// glob, because `scripts/rules.test.mjs` needs the Firestore emulator running
// and cannot go in with the rest — it has its own `npm run test:rules`.
//
// The cost of that list is silent. Add a test file and forget to name it, and
// nothing fails; the file simply never runs, and it goes on not running for as
// long as nobody counts. That is exactly what happened to this file's
// neighbours: `catalogue.test.mjs` sat green in the repo and outside the suite.
//
// So the list checks itself.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

/** Test files that need the emulator, and so run under `npm run test:rules`. */
const NEEDS_EMULATOR = ['rules.test.mjs']

test('every test file is in one suite or the other', () => {
  const onDisk = readdirSync(here).filter((f) => f.endsWith('.test.mjs'))
  const inSuite = new Set(
    `${pkg.scripts.test} ${pkg.scripts['test:rules']}`
      .split(/\s+/)
      .filter((word) => word.endsWith('.test.mjs'))
      .map((path) => path.split('/').pop()),
  )

  const missing = onDisk.filter((file) => !inSuite.has(file))
  assert.deepEqual(
    missing,
    [],
    `not run by npm test: ${missing.join(', ')} — add them to "test" in package.json`,
  )
})

test('the emulator tests are kept out of the ordinary run', () => {
  // Putting them in would make `npm test` fail on any machine without the
  // emulator up, which trains everybody to ignore a red suite.
  for (const file of NEEDS_EMULATOR) {
    assert.ok(!pkg.scripts.test.includes(file), `${file} must not be in npm test`)
    assert.ok(pkg.scripts['test:rules'].includes(file), `${file} must be in npm run test:rules`)
  }
})
