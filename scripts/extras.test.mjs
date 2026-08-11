import test from 'node:test'
import assert from 'node:assert/strict'
import { extrasList, extrasTotal, productionProgress } from '../src/lib/compile.js'

const order = {
  items: [
    { productId: 'bread-large', qtyNeeded: 40 },
    { productId: 'bread-small', qtyNeeded: 60 },
  ],
  produced: { 'bread-large': 40, 'bread-small': 60 },
  extras: {
    'donut-small': { productId: 'donut-small', code: '06', productName: 'Donut Small', qty: 24, byName: 'Usman' },
    'rusk': { productId: 'rusk', code: '05', productName: 'Rusk', qty: 10, byName: 'Usman' },
  },
}

test('extras are listed by name, so the dispatch screen reads in a stable order', () => {
  assert.deepEqual(extrasList(order).map((e) => e.productName), ['Donut Small', 'Rusk'])
})

test('extras add up', () => {
  assert.equal(extrasTotal(order), 34)
})

test('an extra taken back drops out, because nothing here is deleted', () => {
  const corrected = { ...order, extras: { ...order.extras, rusk: { ...order.extras.rusk, qty: 0 } } }
  assert.deepEqual(extrasList(corrected).map((e) => e.productName), ['Donut Small'])
  assert.equal(extrasTotal(corrected), 24)
})

test('an order with no extras is simply empty', () => {
  assert.deepEqual(extrasList({ items: [] }), [])
  assert.equal(extrasTotal(null), 0)
})

test('extras do not count towards finishing the list', () => {
  // The whole point: a tray of spare donuts must not make an unbaked line of
  // bread look done.
  const half = {
    items: order.items,
    produced: { 'bread-large': 40 },
    extras: order.extras,
  }
  const progress = productionProgress(half)
  assert.equal(progress.complete, false)
  assert.equal(progress.linesRecorded, 1)
  // ...and they do not inflate what was made against what was needed.
  assert.equal(progress.made, 40)
  assert.equal(progress.needed, 100)
})

test('a fully recorded list is complete even with extras alongside it', () => {
  const progress = productionProgress(order)
  assert.equal(progress.complete, true)
  assert.equal(progress.made, 100)
})
