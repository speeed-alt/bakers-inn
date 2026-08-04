// The closing count and the day's report are what the owner's waste figures are
// built from, so the arithmetic is pinned down here.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLeftovers,
  defaultDisposition,
  sellThrough,
  splitLeftovers,
  wasteValue,
  CARRY,
  RETURN,
  WASTE,
} from '../src/lib/leftovers.js'
import { buildDailyReport, carryoverFrom } from '../src/lib/dailyReport.js'

const BREAD = { id: 'bread', code: '101', name: 'Milk Bread', price: 220, sellsNextDay: false }
const RUSK = { id: 'rusk', code: '201', name: 'Cake Rusk', price: 480, sellsNextDay: true }
const PATTY = { id: 'patty', code: '401', name: 'Chicken Patty', price: 180, sellsNextDay: false }
const PRODUCTS = [BREAD, RUSK, PATTY]

test('what does not keep is binned; what keeps stays on the shelf', () => {
  assert.equal(defaultDisposition(BREAD), WASTE)
  assert.equal(defaultDisposition(RUSK), CARRY)
  assert.equal(defaultDisposition({}), WASTE, 'unknown products are treated as perishable')
})

test('the count is filled in from what arrived and what sold', () => {
  const lines = buildLeftovers({
    products: PRODUCTS,
    received: { bread: 20, rusk: 5 },
    sold: { bread: 17, rusk: 2 },
  })
  assert.deepEqual(lines.map((l) => l.productId), ['bread', 'rusk'], 'only what was handled')
  const bread = lines.find((l) => l.productId === 'bread')
  assert.equal(bread.expected, 3)
  assert.equal(bread.disposition, WASTE)
  const rusk = lines.find((l) => l.productId === 'rusk')
  assert.equal(rusk.expected, 3)
  assert.equal(rusk.disposition, CARRY)
})

test('yesterday’s shelf counts towards today', () => {
  const lines = buildLeftovers({
    products: PRODUCTS,
    received: { rusk: 4 },
    carriedIn: { rusk: 3 },
    sold: { rusk: 5 },
  })
  assert.equal(lines[0].expected, 2, '3 carried + 4 in − 5 sold')
  assert.equal(lines[0].carriedIn, 3)
})

test('selling more than arrived shows zero, never a negative shelf', () => {
  const lines = buildLeftovers({ products: PRODUCTS, received: { bread: 5 }, sold: { bread: 8 } })
  assert.equal(lines[0].expected, 0)
})

test('a product handled today appears even when none should be left', () => {
  const lines = buildLeftovers({ products: PRODUCTS, received: { bread: 5 }, sold: { bread: 5 } })
  assert.equal(lines.length, 1, 'still counted — the shelf may disagree')
  assert.equal(lines[0].expected, 0)
})

test('counted lines split into binned, carried and sent back', () => {
  const lines = buildLeftovers({
    products: PRODUCTS,
    received: { bread: 20, rusk: 6, patty: 10 },
    sold: { bread: 17, rusk: 2, patty: 9 },
  })
  const { waste, carry, returns } = splitLeftovers(
    lines,
    { bread: 3, rusk: 4, patty: 1 },
    { rusk: RETURN },
    { bread: 'Stale' },
  )
  assert.deepEqual(waste.map((w) => [w.productId, w.qty, w.reason]), [
    ['bread', 3, 'Stale'],
    ['patty', 1, 'Unsold'],
  ])
  assert.deepEqual(returns.map((r) => [r.productId, r.qty]), [['rusk', 4]])
  assert.deepEqual(carry, [])
})

test('nothing left of a line means it is left out entirely', () => {
  const lines = buildLeftovers({ products: PRODUCTS, received: { bread: 5 }, sold: { bread: 5 } })
  const { waste, carry, returns } = splitLeftovers(lines, { bread: 0 })
  assert.deepEqual([waste, carry, returns], [[], [], []])
})

test('waste is valued at what it would have sold for', () => {
  const priceOf = (id) => PRODUCTS.find((p) => p.id === id)?.price ?? 0
  assert.equal(wasteValue([{ productId: 'bread', qty: 3 }], priceOf), 660)
  assert.equal(wasteValue([], priceOf), 0)
})

test('sell-through is what went out over what was there', () => {
  const lines = buildLeftovers({
    products: PRODUCTS,
    received: { bread: 20, patty: 10 },
    sold: { bread: 17, patty: 8 },
  })
  assert.equal(sellThrough(lines), 83, '25 of 30')
  assert.equal(sellThrough([]), null, 'no stock, no percentage')
})

// --- the day's report ------------------------------------------------------

const sale = (items, over = {}) => ({
  status: 'normal',
  payment: 'cash',
  total: items.reduce((s, i) => s + i.price * i.qty, 0),
  items,
  ...over,
})

test('a shop’s day reconciles from delivery to shelf', () => {
  const report = buildDailyReport({
    branchId: 'B2',
    businessDate: '2026-07-28',
    ref: 'R-0728-B2',
    products: PRODUCTS,
    sales: [sale([{ productId: 'bread', name: 'Milk Bread', price: 220, qty: 17 }])],
    transfersIn: [
      {
        status: 'received',
        items: [{ productId: 'bread', qtySent: 20, qtyReceived: 20 }],
      },
    ],
    closing: {
      wasteItems: [{ productId: 'bread', qty: 3, reason: 'Stale' }],
      carry: [],
      returns: [],
      countedCash: 3740,
      overShort: 0,
    },
  })

  const bread = report.byProduct.find((p) => p.productId === 'bread')
  assert.equal(bread.received, 20)
  assert.equal(bread.sold, 17)
  assert.equal(bread.wasted, 3)
  assert.equal(bread.unexplained, 0)
  assert.equal(report.reconciles, true)
  assert.equal(report.wasteQty, 3)
  assert.equal(report.wasteValue, 660, '3 × Rs 220')
  assert.equal(report.wastePct, 15, '3 of 20')
  assert.equal(report.sellThroughPct, 85)
  assert.equal(report.salesTotal, 3740)
})

test('a count that does not add up is reported, not hidden', () => {
  const report = buildDailyReport({
    branchId: 'B2',
    businessDate: '2026-07-28',
    products: PRODUCTS,
    sales: [sale([{ productId: 'bread', name: 'Milk Bread', price: 220, qty: 17 }])],
    transfersIn: [{ status: 'received', items: [{ productId: 'bread', qtySent: 20, qtyReceived: 20 }] }],
    // Only two binned, but three are unaccounted for.
    closing: { wasteItems: [{ productId: 'bread', qty: 2 }], carry: [], returns: [] },
  })
  assert.equal(report.reconciles, false)
  assert.equal(report.byProduct[0].unexplained, 1)
})

test('a short delivery is valued and never counted as the shop’s waste', () => {
  const report = buildDailyReport({
    branchId: 'B2',
    businessDate: '2026-07-28',
    products: PRODUCTS,
    sales: [],
    transfersIn: [
      { status: 'received', items: [{ productId: 'patty', qtySent: 11, qtyReceived: 9 }] },
    ],
    closing: { wasteItems: [], carry: [{ productId: 'patty', qty: 9 }], returns: [] },
  })
  assert.equal(report.transferVarianceQty, 2)
  assert.equal(report.transferVarianceValue, 360, '2 × Rs 180')
  assert.equal(report.wasteQty, 0, 'the shop did not waste it')
  assert.equal(report.byProduct[0].received, 9, 'only what actually arrived')
})

test('the hub counts its own share of the bake, capped by what was made', () => {
  const report = buildDailyReport({
    branchId: 'MAIN',
    mainId: 'MAIN',
    businessDate: '2026-07-28',
    products: PRODUCTS,
    sales: [],
    production: {
      items: [
        { productId: 'bread', perOutlet: { MAIN: 12, B2: 8 } },
        { productId: 'patty', perOutlet: { MAIN: 20 } },
      ],
      produced: { bread: 20, patty: 14 },
    },
    closing: { wasteItems: [], carry: [], returns: [] },
  })
  const rows = Object.fromEntries(report.byProduct.map((r) => [r.productId, r.received]))
  assert.equal(rows.bread, 12, 'its own share')
  assert.equal(rows.patty, 14, 'capped: only 14 were baked of the 20 it wanted')
})

test('stock sent back to the hub is neither sold nor wasted', () => {
  const report = buildDailyReport({
    branchId: 'B2',
    businessDate: '2026-07-28',
    products: PRODUCTS,
    sales: [],
    transfersIn: [{ status: 'received', items: [{ productId: 'rusk', qtySent: 6, qtyReceived: 6 }] }],
    closing: { wasteItems: [], carry: [], returns: [{ productId: 'rusk', qty: 6 }] },
  })
  const rusk = report.byProduct[0]
  assert.equal(rusk.returned, 6)
  assert.equal(rusk.wasted, 0)
  assert.equal(rusk.unexplained, 0)
  assert.equal(report.wasteValue, 0)
})

test('a delivery still on its way counts for nothing yet', () => {
  const report = buildDailyReport({
    branchId: 'B2',
    businessDate: '2026-07-28',
    products: PRODUCTS,
    sales: [],
    transfersIn: [{ status: 'dispatched', items: [{ productId: 'bread', qtySent: 20 }] }],
    closing: { wasteItems: [], carry: [], returns: [] },
  })
  assert.equal(report.byProduct.length, 0, 'nothing arrived, nothing to report')
})

test('tomorrow starts with what was left on the shelf tonight', () => {
  assert.deepEqual(carryoverFrom({ carry: [{ productId: 'rusk', qty: 4 }] }), { rusk: 4 })
  assert.deepEqual(carryoverFrom(null), {})
})
