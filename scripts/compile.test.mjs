// The baking list is compiled, never typed, so the arithmetic is the thing that
// has to be right. These tests are the contract for that.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compileDemands,
  mergeProduction,
  productionProgress,
  shortfalls,
  mainShare,
} from '../src/lib/compile.js'

const BRANCHES = [
  { id: 'MAIN', isMain: true },
  { id: 'B2', isMain: false },
  { id: 'B3', isMain: false },
]

const demand = (branchId, items, status = 'submitted', id = `D-${branchId}`) => ({
  id,
  branchId,
  status,
  items,
})

const patty = (qty) => ({ productId: 'patty', code: '401', productName: 'Chicken Patty', qty })
const rusk = (qty) => ({ productId: 'rusk', code: '201', productName: 'Cake Rusk (500g)', qty })

test('three orders become one baking list with the split kept', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [
      demand('MAIN', [patty(20), rusk(5)]),
      demand('B2', [patty(15)]),
      demand('B3', [patty(10), rusk(3)]),
    ],
  })

  assert.equal(out.items.length, 2)
  const p = out.items.find((i) => i.productId === 'patty')
  assert.equal(p.qtyNeeded, 45, '20 + 15 + 10')
  assert.deepEqual(p.perOutlet, { MAIN: 20, B2: 15, B3: 10 })

  const r = out.items.find((i) => i.productId === 'rusk')
  assert.equal(r.qtyNeeded, 8)
  assert.deepEqual(r.perOutlet, { MAIN: 5, B3: 3 })

  assert.deepEqual(out.compiledFrom, ['D-MAIN', 'D-B2', 'D-B3'])
  assert.deepEqual(out.autoFilled, [])
  assert.deepEqual(out.missing, [])
})

test('the baking list is ordered by code so the kitchen can follow it', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(1), rusk(1)])],
  })
  assert.deepEqual(out.items.map((i) => i.code), ['201', '401'])
})

test('only the other outlets get a delivery note — the hub keeps its own', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(20)]), demand('B2', [patty(15)]), demand('B3', [rusk(3)])],
  })

  assert.deepEqual(out.transfers.map((t) => t.toBranchId), ['B2', 'B3'])
  assert.equal(out.transfers.find((t) => t.toBranchId === 'B2').items[0].qtyDemanded, 15)
  assert.equal(out.transfers.find((t) => t.toBranchId === 'B3').items[0].qtyDemanded, 3)
  assert.ok(!out.transfers.some((t) => t.toBranchId === 'MAIN'), 'the hub never posts to itself')
})

test('an outlet that missed the cutoff gets last week repeated, and is flagged', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(20)]), demand('B2', [patty(15)])],
    fallbacks: { B3: demand('B3', [patty(9)], 'locked', 'D-B3-lastweek') },
  })

  assert.equal(out.items.find((i) => i.productId === 'patty').qtyNeeded, 44, '20 + 15 + 9')
  assert.deepEqual(out.autoFilled, ['B3'])
  assert.deepEqual(out.missing, [])
  assert.ok(out.compiledFrom.includes('D-B3-lastweek'))
})

test('a brand new outlet with no history is reported, never invented', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(20)])],
  })
  assert.deepEqual(out.missing.sort(), ['B2', 'B3'])
  assert.equal(out.items.find((i) => i.productId === 'patty').qtyNeeded, 20)
})

test('a draft order is not counted — only what was actually submitted', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(20)]), demand('B2', [patty(15)], 'draft')],
  })
  assert.equal(out.items.find((i) => i.productId === 'patty').qtyNeeded, 20)
  assert.ok(out.missing.includes('B2'))
})

test('lines with a zero quantity are left off the list entirely', () => {
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(0), rusk(4)])],
  })
  assert.deepEqual(out.items.map((i) => i.productId), ['rusk'])
})

test('re-compiling never asks for less than the kitchen already baked', () => {
  const existing = {
    items: [{ productId: 'patty', code: '401', productName: 'Chicken Patty', qtyNeeded: 45, perOutlet: { MAIN: 45 } }],
    produced: { patty: 40 },
  }
  // Somebody cut their order right down after baking had started.
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [patty(5)])],
    existing,
  })
  assert.equal(out.items.find((i) => i.productId === 'patty').qtyNeeded, 40, 'work is never erased')
})

test('a line withdrawn after baking started stays on the list', () => {
  const merged = mergeProduction(
    [{ productId: 'rusk', code: '201', productName: 'Cake Rusk (500g)', qtyNeeded: 8 }],
    [{ productId: 'patty', code: '401', productName: 'Chicken Patty', qtyNeeded: 10, perOutlet: {} }],
    { rusk: 6 },
  )
  assert.deepEqual(merged.map((i) => i.productId).sort(), ['patty', 'rusk'])
  const kept = merged.find((i) => i.productId === 'rusk')
  // Target drops to what was baked, so the line reads as finished rather than
  // leaving the kitchen chasing 8 of something nobody is waiting for.
  assert.equal(kept.qtyNeeded, 6)
  assert.equal(kept.withdrawn, true)
  assert.equal(productionProgress({ items: merged, produced: { rusk: 6, patty: 10 } }).complete, true)
})

test('a line withdrawn before any baking simply goes away', () => {
  const merged = mergeProduction(
    [{ productId: 'rusk', code: '201', productName: 'Cake Rusk', qtyNeeded: 8 }],
    [{ productId: 'patty', code: '401', productName: 'Chicken Patty', qtyNeeded: 10, perOutlet: {} }],
    {},
  )
  assert.deepEqual(merged.map((i) => i.productId), ['patty'])
})

test('a bake-ahead order gains lines without disturbing the ones in progress', () => {
  const existing = {
    items: [{ productId: 'cake', code: '305', productName: 'Birthday Cake', qtyNeeded: 2, perOutlet: { MAIN: 2 } }],
    produced: { cake: 1 },
  }
  const out = compileDemands({
    branches: BRANCHES,
    demands: [demand('MAIN', [{ productId: 'cake', code: '305', productName: 'Birthday Cake', qty: 2 }, patty(6)])],
    existing,
  })
  assert.equal(out.items.length, 2)
  assert.equal(out.items.find((i) => i.productId === 'cake').qtyNeeded, 2)
  assert.equal(out.items.find((i) => i.productId === 'patty').qtyNeeded, 6)
})

test('progress and shortfall read straight off the order', () => {
  const order = {
    items: [
      { productId: 'patty', productName: 'Chicken Patty', qtyNeeded: 45 },
      { productId: 'rusk', productName: 'Cake Rusk', qtyNeeded: 8 },
    ],
    produced: { patty: 40, rusk: 8 },
  }
  const p = productionProgress(order)
  assert.equal(p.needed, 53)
  assert.equal(p.made, 48)
  assert.equal(p.lines, 2)
  assert.equal(p.linesRecorded, 2)
  assert.equal(p.linesMet, 1)

  assert.deepEqual(shortfalls(order), [
    { productId: 'patty', productName: 'Chicken Patty', short: 5 },
  ])

  const done = productionProgress({ items: order.items, produced: { patty: 45, rusk: 8 } })
  assert.equal(done.complete, true)
  assert.deepEqual(shortfalls({ items: order.items, produced: { patty: 45, rusk: 8 } }), [])
})

test('a short morning still counts as finished once every line is recorded', () => {
  const items = [
    { productId: 'patty', productName: 'Chicken Patty', qtyNeeded: 45 },
    { productId: 'rusk', productName: 'Cake Rusk', qtyNeeded: 8 },
  ]
  // The ovens managed 38 of 45. That is a normal day, not an unfinishable one —
  // if this were not complete the deliveries could never leave the hub.
  const short = productionProgress({ items, produced: { patty: 38, rusk: 8 } })
  assert.equal(short.complete, true, 'a short bake must still be closeable')
  assert.equal(short.linesMet, 1)
  assert.equal(short.made, 46)

  // Genuinely unfinished: one line never recorded at all.
  const unfinished = productionProgress({ items, produced: { patty: 38 } })
  assert.equal(unfinished.complete, false)
  assert.equal(unfinished.linesRecorded, 1)
})

test('recording zero is a real answer, not a missing one', () => {
  const items = [{ productId: 'patty', productName: 'P', qtyNeeded: 10 }]
  // "We baked none of these" must count as recorded and let the day close.
  const none = productionProgress({ items, produced: { patty: 0 } })
  assert.equal(none.complete, true)
  assert.equal(none.made, 0)
  assert.deepEqual(shortfalls({ items, produced: { patty: 0 } }), [
    { productId: 'patty', productName: 'P', short: 10 },
  ])
})

test('baking over the asked-for amount is not reported as short', () => {
  const order = { items: [{ productId: 'patty', productName: 'P', qtyNeeded: 10 }], produced: { patty: 12 } }
  assert.deepEqual(shortfalls(order), [])
  assert.equal(productionProgress(order).complete, true)
})

test("the hub's own stock is what it baked for itself, less what went out", () => {
  const order = {
    items: [{ productId: 'patty', productName: 'P', qtyNeeded: 45, perOutlet: { MAIN: 20, B2: 25 } }],
    produced: { patty: 45 },
  }
  assert.deepEqual(mainShare(order, 'MAIN'), { patty: 20 })
  assert.deepEqual(mainShare(order, 'MAIN', { patty: 5 }), { patty: 15 })

  // A short bake cannot leave the hub claiming more than exists.
  const short = { items: order.items, produced: { patty: 12 } }
  assert.deepEqual(mainShare(short, 'MAIN'), { patty: 12 })
})
