// The raw-material ledger decides when the owner reorders and what his margin
// looks like, so its arithmetic is pinned down here.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMovement,
  daysOfStock,
  grossMargin,
  isLow,
  lowStock,
  purchaseTotal,
  stockValue,
  usageBetweenCounts,
  COUNT,
  RECEIVED,
  SPOILAGE,
} from '../src/lib/materials.js'

test('a delivery adds, spoilage takes away, a count replaces', () => {
  assert.equal(applyMovement(50, { type: RECEIVED, qty: 25 }), 75)
  assert.equal(applyMovement(50, { type: SPOILAGE, qty: 8 }), 42)
  // The person counting types what is on the shelf, not a difference.
  assert.equal(applyMovement(50, { type: COUNT, qty: 46 }), 46)
  assert.equal(applyMovement(50, { type: COUNT, qty: 90 }), 90, 'a count can go up too')
})

test('stock never goes below zero however the numbers arrive', () => {
  assert.equal(applyMovement(5, { type: SPOILAGE, qty: 20 }), 0)
  assert.equal(applyMovement(0, { type: COUNT, qty: -3 }), 0)
})

test('usage comes from what two counts cannot account for', () => {
  // 50kg counted, 25kg arrived, 2kg went bad, 31kg on the shelf a week later.
  const usage = usageBetweenCounts({
    previousCount: 50,
    receivedSince: 25,
    spoiledSince: 2,
    countedNow: 31,
    days: 7,
  })
  assert.equal(usage.used, 42)
  assert.equal(usage.perDay, 6)
})

test('usage is not guessed when there is nothing to compare against', () => {
  assert.equal(usageBetweenCounts({ previousCount: null, countedNow: 10, days: 7 }), null)
  assert.equal(usageBetweenCounts({ previousCount: 50, countedNow: 10, days: 0 }), null)
  // More on the shelf than can be explained — the paperwork is wrong, so say
  // nothing rather than report a negative usage.
  assert.equal(
    usageBetweenCounts({ previousCount: 10, receivedSince: 5, countedNow: 40, days: 7 }),
    null,
  )
})

test('days of stock left follow the rate it is actually used at', () => {
  assert.equal(daysOfStock({ onHand: 30, usagePerDay: 6 }), 5)
  assert.equal(daysOfStock({ onHand: 30 }), null, 'no rate known yet')
  assert.equal(daysOfStock({ onHand: 30, usagePerDay: 0 }), null)
})

test('low stock catches both the level set and running out soon', () => {
  assert.equal(isLow({ onHand: 4, reorderLevel: 5 }), true, 'under the level set')
  assert.equal(isLow({ onHand: 10, reorderLevel: 5 }), false)
  assert.equal(isLow({ onHand: 6, usagePerDay: 6 }), true, 'one day left')
  assert.equal(isLow({ onHand: 60, usagePerDay: 6 }), false, 'ten days left')
  assert.equal(isLow({ onHand: 100 }), false, 'no rate, no level, no alarm')
})

test('the low list is ordered by what runs out first, ignoring retired items', () => {
  const materials = [
    { id: 'flour', onHand: 60, usagePerDay: 6 },
    { id: 'butter', onHand: 6, usagePerDay: 6 },
    { id: 'yeast', onHand: 2, usagePerDay: 4 },
    { id: 'old', onHand: 0, reorderLevel: 5, active: false },
  ]
  assert.deepEqual(lowStock(materials).map((m) => m.id), ['yeast', 'butter'])
})

test('stock is valued at what it cost', () => {
  assert.equal(stockValue([{ onHand: 30, costPerUnit: 250 }, { onHand: 4, costPerUnit: 1200 }]), 12300)
  assert.equal(stockValue([]), 0)
})

test('a purchase totals its lines in whole rupees', () => {
  assert.equal(purchaseTotal([{ qty: 50, unitCost: 250 }, { qty: 4, unitCost: 1200 }]), 17300)
  assert.equal(purchaseTotal([{ qty: 2.5, unitCost: 199 }]), 498, 'fractional weights round')
  assert.equal(purchaseTotal([]), 0)
})

test('margin is takings less what was bought and what was binned', () => {
  const m = grossMargin({ salesTotal: 100000, materialCost: 40000, wasteValue: 5000 })
  assert.equal(m.margin, 55000)
  assert.equal(m.marginPct, 55)
})

test('margin does not divide by zero on a day with no trade', () => {
  const m = grossMargin({ salesTotal: 0, materialCost: 2000, wasteValue: 0 })
  assert.equal(m.margin, -2000)
  assert.equal(m.marginPct, null)
})
