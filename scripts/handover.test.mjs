// The hub counter counting in its own bake.
//
// The hub's share never comes on a van, so its cashier was the one person not
// told when the bread was done, and a short tray there surfaced only at closing
// as waste nobody could explain. What this protects: the figure the cashier is
// asked to confirm is exactly the one the shelf is about to show, the notice
// cannot open while the kitchen can still move trays onto a van, and a short
// count lands on the shelf as a named correction rather than vanishing.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTRA_FROM_KITCHEN,
  SHORT_FROM_KITCHEN,
  bakeStatus,
  handoverEntries,
  handoverItems,
  hubShare,
} from '../src/lib/handover.js'
import { netAdjustments, validAdjustment } from '../src/lib/adjustments.js'
import { buildLeftovers } from '../src/lib/leftovers.js'
import { receivedAt } from '../src/lib/stock.js'

const products = [
  { id: 'bread-300', code: '11', name: 'Chicken & Grain Bread', price: 300 },
  { id: 'cakes-400', code: '10', name: 'Simple & Fruit Cake', price: 400 },
]
const user = { id: 'zubair', name: 'Zubair' }
const production = {
  businessDate: '2026-09-13',
  status: 'done',
  produced: { 'bread-300': 50, 'cakes-400': 10 },
}
const note = (status, sent = 20, over = {}) => ({
  fromBranch: 'MAIN',
  toBranchId: 'B2',
  businessDate: '2026-09-13',
  status,
  items: [{ productId: 'bread-300', qtyDemanded: 20, qtySent: sent }],
  ...over,
})

test('the hub share is what was made, less what went on the vans', () => {
  const share = hubShare({ branchId: 'MAIN', production, outbound: [note('dispatched')] })
  assert.deepEqual(share, { 'bread-300': 30, 'cakes-400': 10 })
})

test('the count-in asks about exactly the figure the shelf will show', () => {
  // Two workings of the hub's share would drift, and the cashier would be
  // confirming a number that nothing else in the system uses.
  const outbound = [note('dispatched', 23)]
  const share = hubShare({ branchId: 'MAIN', production, outbound })
  const shelf = receivedAt({
    branchId: 'MAIN',
    isMain: true,
    transfers: outbound,
    production,
    businessDate: '2026-09-13',
  })
  assert.deepEqual(share, shelf)
  assert.equal(share['bread-300'], 27)
})

test('a note for another day does not come off this bake', () => {
  const share = hubShare({
    branchId: 'MAIN',
    production,
    outbound: [note('dispatched', 20, { businessDate: '2026-09-14' })],
  })
  assert.equal(share['bread-300'], 50)
})

test('nothing to count while the kitchen is still baking', () => {
  const open = { ...production, status: 'open' }
  const share = hubShare({ branchId: 'MAIN', production: open })
  assert.equal(bakeStatus({ production: open, share }), 'baking')
})

test('the notice waits until every van for the day has gone', () => {
  // A draft note can still be sent with more or less on it, and every tray it
  // moves changes what the hub keeps. Counting in before then counts stock that
  // may still leave.
  const outbound = [note('draft'), note('dispatched', 20, { toBranchId: 'B3' })]
  const share = hubShare({ branchId: 'MAIN', production, outbound })
  assert.equal(bakeStatus({ production, outbound, share }), 'dispatching')
})

test('a return still being written does not hold up the bake', () => {
  // A shop's leftovers going back to the hub are not a van the kitchen is loading.
  const outbound = [note('dispatched'), note('draft', 5, { direction: 'return' })]
  const share = hubShare({ branchId: 'MAIN', production, outbound })
  assert.equal(bakeStatus({ production, outbound, share }), 'ready')
})

test('ready once the list is done and the vans have gone', () => {
  const outbound = [note('dispatched')]
  const share = hubShare({ branchId: 'MAIN', production, outbound })
  assert.equal(bakeStatus({ production, outbound, share }), 'ready')
})

test('ready even on a day no other outlet ordered', () => {
  // The ordinary case this whole feature exists for: the hub's own order, and
  // no vans at all.
  const share = hubShare({ branchId: 'MAIN', production, outbound: [] })
  assert.equal(bakeStatus({ production, outbound: [], share }), 'ready')
})

test('counted in once is counted in, and the notice goes', () => {
  const share = hubShare({ branchId: 'MAIN', production })
  assert.equal(bakeStatus({ production, share, handover: { receivedByName: 'Zubair' } }), 'counted')
})

test('a bake that all went on vans is not something to count in', () => {
  const allGone = { ...production, produced: { 'bread-300': 20 } }
  const outbound = [note('dispatched')]
  const share = hubShare({ branchId: 'MAIN', production: allGone, outbound })
  assert.deepEqual(share, {})
  assert.equal(bakeStatus({ production: allGone, outbound, share }), 'nothing')
})

test('no baking list is no bake', () => {
  assert.equal(bakeStatus({ production: null }), 'none')
  assert.deepEqual(hubShare({ branchId: 'MAIN', production: null }), {})
})

test('a count that matches writes no corrections at all', () => {
  const share = { 'bread-300': 30, 'cakes-400': 10 }
  assert.deepEqual(handoverEntries({ share, counted: { 'bread-300': 30 }, products, user }), [])
})

test('a short tray is booked as short from the kitchen, with a name on it', () => {
  const share = { 'bread-300': 30, 'cakes-400': 10 }
  const [entry] = handoverEntries({ share, counted: { 'bread-300': 27 }, products, user })
  assert.equal(entry.delta, -3)
  assert.equal(entry.reason, SHORT_FROM_KITCHEN)
  assert.equal(entry.byName, 'Zubair')
  assert.equal(entry.productName, 'Chicken & Grain Bread')
  assert.equal(validAdjustment(entry), true)
})

test('an extra tray is booked as extra from the kitchen', () => {
  const [entry] = handoverEntries({
    share: { 'cakes-400': 10 },
    counted: { 'cakes-400': 12 },
    products,
    user,
  })
  assert.equal(entry.delta, 2)
  assert.equal(entry.reason, EXTRA_FROM_KITCHEN)
  assert.equal(validAdjustment(entry), true)
})

test('the shelf ends up holding what was counted, not what was made', () => {
  const share = { 'bread-300': 30, 'cakes-400': 10 }
  const counted = { 'bread-300': 27, 'cakes-400': 12 }
  const entries = handoverEntries({ share, counted, products, user })
  const shelf = buildLeftovers({ products, received: share, adjusted: netAdjustments({ entries }) })
  assert.equal(shelf.find((l) => l.productId === 'bread-300').expected, 27)
  assert.equal(shelf.find((l) => l.productId === 'cakes-400').expected, 12)
})

test('the record keeps both figures for every line', () => {
  const items = handoverItems({
    share: { 'bread-300': 30 },
    counted: { 'bread-300': 27 },
    products,
  })
  assert.deepEqual(items, [
    {
      productId: 'bread-300',
      code: '11',
      productName: 'Chicken & Grain Bread',
      qtyMade: 30,
      qtyCounted: 27,
    },
  ])
})

test('rubbish in a count is treated as agreement, not as a write-off', () => {
  const share = { 'bread-300': 30 }
  assert.deepEqual(handoverEntries({ share, counted: { 'bread-300': 'abc' }, products, user }), [])
  assert.deepEqual(handoverEntries({ share, counted: { 'bread-300': -4 }, products, user }), [])
  assert.equal(handoverItems({ share, counted: { 'bread-300': -4 }, products })[0].qtyCounted, 30)
})
