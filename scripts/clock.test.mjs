// A tablet with a wrong clock files takings under the wrong day, and nothing
// else in the system would notice. These cover the arithmetic and the wording.
import test from 'node:test'
import assert from 'node:assert/strict'
import { clockDrift, describeDrift, driftMatters } from '../src/lib/clock.js'

const SERVER = 'Tue, 04 Aug 2026 09:00:00 GMT'
const at = (iso) => new Date(iso)

test('a device ahead of the server reports positive drift', () => {
  assert.equal(clockDrift(SERVER, at('2026-08-04T09:10:00Z')), 10 * 60_000)
})

test('a device behind the server reports negative drift', () => {
  assert.equal(clockDrift(SERVER, at('2026-08-04T08:45:00Z')), -15 * 60_000)
})

test('a clock that agrees reports no drift at all', () => {
  assert.equal(clockDrift(SERVER, at('2026-08-04T09:00:00Z')), 0)
})

test('no header, or an unparseable one, is unknown rather than zero', () => {
  // Zero would claim the clock is correct, which is a different statement.
  assert.equal(clockDrift(null, at('2026-08-04T09:00:00Z')), null)
  assert.equal(clockDrift('', at('2026-08-04T09:00:00Z')), null)
  assert.equal(clockDrift('not a date', at('2026-08-04T09:00:00Z')), null)
})

test('small drift is ignored, and unknown drift never raises a warning', () => {
  assert.equal(driftMatters(null), false)
  assert.equal(driftMatters(0), false)
  assert.equal(driftMatters(4 * 60_000), false)
  assert.equal(driftMatters(-4 * 60_000), false)
})

test('drift at or past the tolerance matters, in both directions', () => {
  assert.equal(driftMatters(5 * 60_000), true)
  assert.equal(driftMatters(-5 * 60_000), true)
  assert.equal(driftMatters(26 * 60 * 60_000), true)
})

test('the drift is described the way a person would say it', () => {
  assert.equal(describeDrift(7 * 60_000), '7 minutes fast')
  assert.equal(describeDrift(-7 * 60_000), '7 minutes slow')
  assert.equal(describeDrift(60 * 60_000), '1 hour fast')
  assert.equal(describeDrift(3 * 60 * 60_000), '3 hours fast')
  assert.equal(describeDrift(-24 * 60 * 60_000), '1 day slow')
  assert.equal(describeDrift(48 * 60 * 60_000), '2 days fast')
})

test('an unknown drift describes as nothing, so no banner can render empty', () => {
  assert.equal(describeDrift(null), '')
})
