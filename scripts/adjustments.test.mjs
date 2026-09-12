// Corrections the counter makes to its own shelf.
//
// The thing being protected here is not the arithmetic — it is that four
// screens work the shelf figure out and all four have to get the same answer.
// The till warns on selling past it, the Stock page shows it, the close asks
// the cashier to confirm it, and the owner reads it at home. A correction that
// reached three of the four would be worse than no correction at all: it would
// make two honest people looking at the same shelf disagree.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_REASONS,
  adjustmentEntry,
  entriesOf,
  netAdjustments,
  reasonsFor,
  validAdjustment,
} from '../src/lib/adjustments.js'
import { buildLeftovers } from '../src/lib/leftovers.js'
import { stockAt } from '../src/lib/stock.js'

const bread = { id: 'bread-300', code: '11', name: 'Chicken & Grain Bread', price: 300 }
const cake = { id: 'cakes-400', code: '10', name: 'Simple & Fruit Cake', price: 400 }
const user = { id: 'ayesha', name: 'Ayesha' }

const entry = (over = {}) => ({
  productId: 'bread-300', code: '11', productName: 'Chicken & Grain Bread',
  delta: -6, reason: 'Dropped', byId: 'ayesha', byName: 'Ayesha',
  at: '2026-09-05T06:00:00.000Z',
  ...over,
})

test('the reasons offered match the direction of the correction', () => {
  // A list that offers "Dropped" as the explanation for finding six extra
  // loaves is a list nobody reads, and a cashier who stops reading the list
  // picks the first item every time.
  assert.ok(reasonsFor(4).includes('Extra from the kitchen'))
  assert.ok(!reasonsFor(4).includes('Dropped'))
  assert.ok(reasonsFor(-4).includes('Dropped'))
  assert.ok(!reasonsFor(-4).includes('Extra from the kitchen'))
  // Both ways, because it is the commonest one and it goes both ways.
  assert.ok(reasonsFor(4).includes('Miscounted earlier'))
  assert.ok(reasonsFor(-4).includes('Miscounted earlier'))
})

test('a correction without a reason is not a correction', () => {
  // The reason is the entire bargain. Without it this is a cashier typing over
  // the figure her own closing count is checked against.
  assert.equal(validAdjustment({ productId: 'x', delta: -6, reason: 'Dropped' }), true)
  assert.equal(validAdjustment({ productId: 'x', delta: -6 }), false)
  assert.equal(validAdjustment({ productId: 'x', delta: -6, reason: 'because' }), false)
  assert.ok(ALL_REASONS.length > 0)
})

test('nothing is not worth writing down', () => {
  assert.equal(validAdjustment({ productId: 'x', delta: 0, reason: 'Dropped' }), false)
  assert.equal(validAdjustment({ productId: '', delta: -1, reason: 'Dropped' }), false)
  assert.equal(validAdjustment({ productId: 'x', delta: 1.5, reason: 'Dropped' }), false)
  assert.equal(validAdjustment(), false)
})

test('an entry carries who said so and when', () => {
  const made = adjustmentEntry({
    product: bread, delta: -6, reason: 'Dropped', user, at: new Date('2026-09-05T06:00:00Z'),
  })
  assert.equal(made.byName, 'Ayesha')
  assert.equal(made.productName, 'Chicken & Grain Bread')
  assert.equal(made.delta, -6)
  // A string, fixed by the caller. These are appended with arrayUnion, which
  // compares whole objects — a server timestamp would differ on a retry and
  // book the same six dropped loaves a second time.
  assert.equal(made.at, '2026-09-05T06:00:00.000Z')
})

test('the day nets out, keeping both facts', () => {
  // "Minus six, dropped" then "plus six, miscounted" is two things that happened
  // in one morning. The shelf wants the total; the owner wants the pair.
  const record = { entries: [entry(), entry({ delta: 6, reason: 'Miscounted earlier', at: '2026-09-05T07:00:00.000Z' })] }
  assert.deepEqual(netAdjustments(record), { 'bread-300': 0 })
  assert.equal(entriesOf(record).length, 2)
  // Newest first — the correction somebody is asking about is the last one.
  assert.equal(entriesOf(record)[0].reason, 'Miscounted earlier')
})

test('a sheet that does not exist yet is no corrections, not a crash', () => {
  // Absent for most of the day, every day. This is the ordinary case.
  assert.deepEqual(netAdjustments(null), {})
  assert.deepEqual(netAdjustments({}), {})
  assert.deepEqual(netAdjustments({ entries: [] }), {})
})

test('rubbish in an entry is skipped rather than poisoning the shelf', () => {
  const record = { entries: [entry(), { delta: 4 }, { productId: 'x' }, null] }
  assert.deepEqual(netAdjustments(record), { 'bread-300': -6 })
})

// ---------------------------------------------------------------------------
// Where it lands.

test('a correction moves the expected figure, both ways', () => {
  const base = {
    products: [bread],
    received: { 'bread-300': 40 },
    sold: { 'bread-300': 10 },
  }
  assert.equal(buildLeftovers(base)[0].expected, 30)
  assert.equal(buildLeftovers({ ...base, adjusted: { 'bread-300': -6 } })[0].expected, 24)
  assert.equal(buildLeftovers({ ...base, adjusted: { 'bread-300': 6 } })[0].expected, 36)
})

test('the correction stays visible on the line', () => {
  // Folded into `expected` it would be indistinguishable from stock going
  // missing, which is the one thing the closing count exists to notice.
  const [line] = buildLeftovers({
    products: [bread],
    received: { 'bread-300': 40 },
    sold: { 'bread-300': 10 },
    adjusted: { 'bread-300': -6 },
  })
  assert.equal(line.adjusted, -6)
  assert.equal(line.received, 40)
  assert.equal(line.sold, 10)
})

test('a line with nothing but a correction still appears', () => {
  // Otherwise a cashier writes down six dropped loaves and watches the row she
  // wrote it against vanish.
  const lines = buildLeftovers({ products: [bread, cake], adjusted: { 'cakes-400': -2 } })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].productId, 'cakes-400')
})

test('a shelf cannot be corrected below empty', () => {
  // Writing off more than the system believes is there says the paperwork was
  // wrong, not that the shelf owes bread.
  const [line] = buildLeftovers({
    products: [bread],
    received: { 'bread-300': 4 },
    adjusted: { 'bread-300': -10 },
  })
  assert.equal(line.expected, 0)
})

test('stockAt takes the sheet and not the sum, so one place does the adding', () => {
  const shelf = stockAt({
    products: [bread],
    branch: { id: 'B2', name: 'Gulberg' },
    transfers: [{
      toBranchId: 'B2', status: 'received', businessDate: '2026-09-05', receivedOn: '2026-09-05',
      items: [{ productId: 'bread-300', qtyReceived: 40 }],
    }],
    sales: [{ branchId: 'B2', items: [{ productId: 'bread-300', qty: 10 }] }],
    businessDate: '2026-09-05',
    adjustments: { entries: [entry()] },
  })
  assert.equal(shelf.lines[0].expected, 24)
  assert.equal(shelf.onShelf, 24)
  // And the value of the shelf follows it down, or the owner's stock figure
  // says the shop is holding six loaves' worth of bread that is in the bin.
  assert.equal(shelf.value, 24 * 300)
})

test('no sheet means the shelf is exactly what it always was', () => {
  // Every existing caller passes nothing until it is wired up, and none of them
  // may change behaviour on the day this ships.
  const args = {
    products: [bread],
    branch: { id: 'B2', name: 'Gulberg' },
    transfers: [{
      toBranchId: 'B2', status: 'received', businessDate: '2026-09-05', receivedOn: '2026-09-05',
      items: [{ productId: 'bread-300', qtyReceived: 40 }],
    }],
    sales: [{ branchId: 'B2', items: [{ productId: 'bread-300', qty: 10 }] }],
    businessDate: '2026-09-05',
  }
  assert.equal(stockAt(args).lines[0].expected, 30)
  assert.equal(stockAt({ ...args, adjustments: null }).lines[0].expected, 30)
})

// ---------------------------------------------------------------------------
// A whole shelf at once.
//
// The count replaces twenty trips through a dialogue. What it must not do is
// get the arithmetic wrong in the ways a count taken on a live till can: undo
// the sales rung while the cashier was walking the shelf, double a delivery
// confirmed halfway through, or write off every row she simply skipped.

import { COUNT_REASON, countBaseline, countEntries, parseCount } from '../src/lib/adjustments.js'

const loaves = { 'bread-300': 40 }

test('an empty box is not a zero', () => {
  // Treating it as zero would write off every item the cashier did not get to.
  assert.equal(parseCount(''), null)
  assert.equal(parseCount('   '), null)
  assert.equal(parseCount(undefined), null)
  assert.equal(parseCount('0'), 0)
  assert.equal(parseCount(' 12 '), 12)
  // Unreadable is not guessed at: the screen refuses to save until it is fixed.
  assert.equal(parseCount('1.5'), null)
  assert.equal(parseCount('-2'), null)
  assert.equal(parseCount('abc'), null)
})

test('the line keeps its figure before the clamp', () => {
  const [line] = buildLeftovers({ products: [bread], received: { 'bread-300': 5 }, sold: { 'bread-300': 8 } })
  assert.equal(line.expected, 0)
  assert.equal(line.raw, -3)
})

test('a count writes one entry per line that moved, and nothing for the rest', () => {
  const lines = buildLeftovers({ products: [bread, cake], received: loaves, sold: { 'bread-300': 10 } })
  const entries = countEntries({
    products: [bread, cake],
    baseline: countBaseline(lines, { 'bread-300': 10 }),
    counts: { 'bread-300': '27', 'cakes-400': '' },
    user,
    at: new Date('2026-09-12T10:00:00Z'),
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].delta, -3)
  assert.equal(entries[0].reason, COUNT_REASON)
  assert.equal(entries[0].byName, 'Ayesha')
  // An ordinary correction in every respect, so the owner's trail reads the same.
  assert.equal(validAdjustment(entries[0]), true)
})

test('typing the figure already on screen is agreement, not a correction', () => {
  const lines = buildLeftovers({ products: [bread], received: loaves, sold: { 'bread-300': 10 } })
  const entries = countEntries({
    products: [bread],
    baseline: countBaseline(lines, { 'bread-300': 10 }),
    counts: { 'bread-300': '30' },
    user,
  })
  assert.deepEqual(entries, [])
})

test('an item nothing happened to today can be counted onto the shelf', () => {
  // The tray the kitchen carried over without paperwork: no delivery, no sale,
  // no row — until the count puts four on it.
  const lines = buildLeftovers({ products: [bread, cake], received: loaves, sold: { 'bread-300': 10 } })
  const entries = countEntries({
    products: [bread, cake],
    baseline: countBaseline(lines, { 'bread-300': 10 }),
    counts: { 'cakes-400': '4' },
    user,
  })
  const after = buildLeftovers({
    products: [bread, cake], received: loaves, sold: { 'bread-300': 10 },
    adjusted: netAdjustments({ entries }),
  })
  assert.equal(after.find((l) => l.productId === 'cakes-400').expected, 4)
})

test('the shelf lands on exactly the number typed, even below zero on paper', () => {
  const inputs = { products: [bread], received: { 'bread-300': 5 }, sold: { 'bread-300': 8 } }
  const entries = countEntries({
    products: [bread],
    baseline: countBaseline(buildLeftovers(inputs), { 'bread-300': 8 }),
    counts: { 'bread-300': '5' },
    user,
  })
  assert.equal(entries[0].delta, 8)
  assert.equal(buildLeftovers({ ...inputs, adjusted: netAdjustments({ entries }) })[0].expected, 5)
})

test('a 0 typed over a 0 on screen writes nothing, whatever the paperwork says underneath', () => {
  const lines = buildLeftovers({ products: [bread], received: { 'bread-300': 5 }, sold: { 'bread-300': 8 } })
  const entries = countEntries({
    products: [bread],
    baseline: countBaseline(lines, { 'bread-300': 8 }),
    counts: { 'bread-300': '0' },
    user,
  })
  assert.deepEqual(entries, [])
})

test('a loaf sold while the cashier is still counting still comes off', () => {
  // The count opens with 10 sold and 30 on the shelf. She counts 26. Before
  // she presses Save, the till sells two more. The shelf must end at 24 —
  // measuring against the figure at save time would have put it back to 26.
  const atStart = { 'bread-300': 10 }
  const now = { products: [bread], received: loaves, sold: { 'bread-300': 12 } }
  const entries = countEntries({
    products: [bread],
    baseline: countBaseline(buildLeftovers(now), atStart),
    counts: { 'bread-300': '26' },
    user,
  })
  assert.equal(buildLeftovers({ ...now, adjusted: netAdjustments({ entries }) })[0].expected, 24)

  // And counting exactly what was there at the start is still agreement.
  const agree = countEntries({
    products: [bread],
    baseline: countBaseline(buildLeftovers(now), atStart),
    counts: { 'bread-300': '30' },
    user,
  })
  assert.deepEqual(agree, [])
})

test('a delivery confirmed halfway through the count is not counted twice', () => {
  // 30 on the shelf when the count opens; twenty more counted in off the van
  // before Save; she counts the 50 now in front of her.
  const now = { products: [bread], received: { 'bread-300': 60 }, sold: { 'bread-300': 10 } }
  const entries = countEntries({
    products: [bread],
    baseline: countBaseline(buildLeftovers(now), { 'bread-300': 10 }),
    counts: { 'bread-300': '50' },
    user,
  })
  assert.deepEqual(entries, [])
})
