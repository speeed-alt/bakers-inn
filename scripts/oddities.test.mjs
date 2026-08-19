// Lines worth a second look before the money is taken.
//
// The one that prompted this: 9,999 kg of biscuits at Rs 1,400 — Rs 13,998,600
// on a bill, from one stuck `+`, with nothing anywhere saying a word.

import test from 'node:test'
import assert from 'node:assert/strict'
import { oddLines, BIG_LINE } from '../src/lib/oddities.js'
import { maxFor, MAX_COUNTED_UNITS, MAX_WEIGHED_UNITS } from '../src/lib/quantity.js'

const line = (over = {}) => ({
  productId: 'bread',
  name: 'Bread Small',
  price: 120,
  qty: 2,
  ...over,
})

test('an ordinary bill has nothing odd about it', () => {
  assert.deepEqual(oddLines([line()], { onShelf: { bread: 40 } }), [])
})

test('selling more than the shelf is said, not refused', () => {
  const odd = oddLines([line({ qty: 50 })], { onShelf: { bread: 40 } })
  assert.equal(odd.length, 1)
  assert.equal(odd[0].kind, 'over-shelf')
  assert.equal(odd[0].left, 40)
})

test('selling exactly what is left is not odd', () => {
  assert.deepEqual(oddLines([line({ qty: 40 })], { onShelf: { bread: 40 } }), [])
})

test('a product the system has no opinion about earns no warning', () => {
  // The ordinary state of a shop before its first delivery is counted in.
  // Absent is not the same fact as zero, and warning on it would train the
  // cashier to tap past the warning every morning.
  assert.deepEqual(oddLines([line({ qty: 50 })], { onShelf: {} }), [])
  assert.deepEqual(oddLines([line({ qty: 50 })], { onShelf: null }), [])
})

test('a product genuinely down to none is over the shelf', () => {
  const odd = oddLines([line({ qty: 1 })], { onShelf: { bread: 0 } })
  assert.equal(odd.length, 1)
  assert.equal(odd[0].kind, 'over-shelf')
})

test('the line that started this is caught on its size alone', () => {
  // 9,999 kg of biscuits, with no shelf figure to compare against.
  const odd = oddLines(
    [{ productId: 'biscuits', name: 'Biscuits', price: 1400, qty: 9999, soldByWeight: true }],
    { onShelf: null },
  )
  assert.equal(odd.length, 1)
  assert.equal(odd[0].kind, 'large')
  assert.equal(odd[0].amount, 13998600)
})

test('a real wedding order is not flagged for being big', () => {
  // Five hundred loaves is a real morning. The threshold has to sit above the
  // largest honest line, or the warning becomes something to tap past.
  const odd = oddLines([line({ qty: 200 })], { onShelf: { bread: 400 } })
  assert.deepEqual(odd, [])
  assert.ok(200 * 120 < BIG_LINE)
})

test('over the shelf wins over merely large, so one line says one thing', () => {
  const odd = oddLines([line({ qty: 400 })], { onShelf: { bread: 10 } })
  assert.equal(odd.length, 1)
  assert.equal(odd[0].kind, 'over-shelf')
})

test('a weighed line is capped in kilos, a counted one in units', () => {
  assert.equal(maxFor({ soldByWeight: true }), MAX_WEIGHED_UNITS)
  assert.equal(maxFor({}), MAX_COUNTED_UNITS)
  assert.ok(MAX_WEIGHED_UNITS < 9999, 'nine tonnes of biscuits is not a bakery order')
})
