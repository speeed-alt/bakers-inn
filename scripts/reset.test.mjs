// Does the reset actually reset everything?
//
// The failure this exists for has already happened once. The equivalent list in
// demo-day.mjs was missing `expenses`, so a clear that printed success left a
// month of fabricated wages — around Rs 346,000 of them — sitting in the owner's
// profit figure. Nothing failed. The report simply went on being wrong.
//
// A list of collection names cannot be checked against itself, so it is checked
// against the rules file, which is the one place every collection in the system
// has to be named in order to be writable at all.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRADING } from './reset-trading.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const rules = readFileSync(join(here, '..', 'firestore.rules'), 'utf8')

/**
 * Collections that describe the shop rather than record a day of it, and so
 * survive a reset. Named here so leaving one out of TRADING is a decision
 * somebody made rather than a line somebody forgot.
 */
const KEPT = ['users', 'branches', 'products', 'rawMaterials']

function collectionsInRules() {
  return [...rules.matchAll(/match \/([A-Za-z][A-Za-z0-9]*)\/\{/g)]
    .map((m) => m[1])
    // `match /databases/{database}/documents` is the wrapper every rules file
    // opens with, not a collection anybody stores anything in.
    .filter((name) => name !== 'databases')
}

test('every collection is either cleared by the reset or deliberately kept', () => {
  const all = new Set(collectionsInRules())
  const accounted = new Set([...TRADING, ...KEPT])
  const missed = [...all].filter((name) => !accounted.has(name))

  assert.deepEqual(
    missed,
    [],
    `not named in reset-trading.mjs: ${missed.join(', ')} — clear it or add it to KEPT here`,
  )
})

test('the reset does not claim to clear something that does not exist', () => {
  // A stale name is harmless at runtime — an empty collection reads as empty —
  // but it makes the list look complete when it is describing a system that has
  // moved on.
  const all = new Set(collectionsInRules())
  const ghosts = TRADING.filter((name) => !all.has(name))
  assert.deepEqual(ghosts, [], `named in the reset but not in the rules: ${ghosts.join(', ')}`)
})

test('the reset never touches what the shop is, only what it did', () => {
  for (const kept of KEPT) {
    assert.ok(!TRADING.includes(kept), `${kept} would be deleted — that is the catalogue or the staff`)
  }
})

test('the collections that hold a day of trading are all in the list', () => {
  // Spelled out rather than derived, so that deleting one of these from the
  // list to "fix" a failing test above fails here instead.
  for (const name of ['sales', 'closings', 'transfers', 'demands', 'productionOrders', 'expenses']) {
    assert.ok(TRADING.includes(name), `${name} must be cleared by a reset`)
  }
})
