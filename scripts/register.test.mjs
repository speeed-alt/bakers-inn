import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRegister, recentDates } from '../src/lib/register.js'

// The owner's pad, going back a fortnight. One ruled line per day.

const BRANCHES = [
  { id: 'MAIN', name: 'Susan Road', isMain: true },
  { id: 'B2', name: 'Gulberg' },
  { id: 'B3', name: 'Gulistan Colony' },
]

const PRODUCTS = [{ id: 'bread', code: '01', name: 'Bread', price: 100 }]

const production = (date) => ({
  businessDate: date,
  items: [{ productId: 'bread', qtyNeeded: 2000, perOutlet: { MAIN: 1000, B2: 500, B3: 500 } }],
  produced: { bread: 2000 },
})

const transfersFor = (date) => [
  { businessDate: date, toBranchId: 'B2', status: 'received', items: [{ productId: 'bread', qtySent: 500 }] },
  { businessDate: date, toBranchId: 'B3', status: 'received', items: [{ productId: 'bread', qtySent: 500 }] },
]

const closing = (date, branchId, salesTotal, wasteValue = 0) => ({
  businessDate: date,
  branchId,
  status: 'closed',
  salesTotal,
  wasteValue,
})

const closedDay = (date) => [
  closing(date, 'MAIN', 80000, 5000),
  closing(date, 'B2', 50000),
  closing(date, 'B3', 50000),
]

test('the dates run back from today, most recent first', () => {
  const dates = recentDates('2026-08-14', 4)
  assert.deepEqual(dates, ['2026-08-14', '2026-08-13', '2026-08-12', '2026-08-11'])
})

test('a closed day reads exactly like the line he writes', () => {
  // The row off the photographed pad: 2 lakh baked, split 1/0.5/0.5 lakh,
  // sold 80/50/50, total 1,80,000, stale 5,000.
  const date = '2026-08-13'
  const { rows } = buildRegister({
    dates: [date],
    branches: BRANCHES,
    products: PRODUCTS,
    closings: closedDay(date),
    productions: [production(date)],
    transfers: transfersFor(date),
  })

  assert.equal(rows.length, 1)
  const r = rows[0]
  assert.equal(r.production, 200000)
  assert.equal(r.perOutlet.MAIN.distributed, 100000)
  assert.equal(r.perOutlet.B2.distributed, 50000)
  assert.equal(r.perOutlet.B3.distributed, 50000)
  assert.equal(r.perOutlet.MAIN.sold, 80000)
  assert.equal(r.totalSale, 180000)
  assert.equal(r.totalStale, 5000)
  assert.equal(r.closed, true)
})

test('takings come from the closes, not from re-adding a fortnight of sales', () => {
  // Every close already totalled its own day the night it happened. Reading
  // thousands of individual sales back to get the same figure would be slow
  // and could disagree with what the cashier signed off.
  const date = '2026-08-13'
  const { rows } = buildRegister({
    dates: [date],
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [closing(date, 'B2', 4321)],
    productions: [],
    transfers: [],
  })
  assert.equal(rows[0].perOutlet.B2.sold, 4321)
})

test('a shop that never closed shows a dash, not a zero', () => {
  // A zero says the shop took nothing. A dash says nobody counted, which is a
  // different thing and the one worth chasing.
  const date = '2026-08-13'
  const { rows } = buildRegister({
    dates: [date],
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [closing(date, 'MAIN', 80000)],
    productions: [],
    transfers: [],
  })
  assert.equal(rows[0].perOutlet.MAIN.sold, 80000)
  assert.equal(rows[0].perOutlet.B2.sold, null)
  assert.equal(rows[0].closed, false)
})

test('a day nobody closed at all has no totals to stand behind', () => {
  const { rows } = buildRegister({
    dates: ['2026-08-13'],
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [],
    productions: [production('2026-08-13')],
    transfers: transfersFor('2026-08-13'),
  })
  assert.equal(rows[0].totalSale, null)
  assert.equal(rows[0].totalStale, null)
  assert.equal(rows[0].production, 200000, 'the bake still happened and is still known')
})

test("today's line comes from the live figures, and says it is still running", () => {
  // The day is not closed, so there is no close to read. The dashboard already
  // has the live sheet and that is the only thing that exists.
  const today = '2026-08-14'
  const todaySheet = {
    production: { value: 150000, linesRecorded: 1 },
    outlets: [
      { branchId: 'MAIN', distributed: 100000, sold: 40000 },
      { branchId: 'B2', distributed: 50000, sold: 20000 },
      { branchId: 'B3', distributed: 50000, sold: 10000 },
    ],
    totalSale: 70000,
    totalStale: null,
    outletsClosed: 0,
  }

  const { rows } = buildRegister({
    dates: [today],
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [],
    productions: [],
    transfers: [],
    today,
    todaySheet,
  })

  assert.equal(rows[0].live, true)
  assert.equal(rows[0].totalSale, 70000)
  assert.equal(rows[0].production, 150000)
  assert.equal(rows[0].closed, false)
})

test('a bake nobody has recorded yet is not printed as nothing baked', () => {
  const date = '2026-08-13'
  const { rows } = buildRegister({
    dates: [date],
    branches: BRANCHES,
    products: PRODUCTS,
    closings: closedDay(date),
    productions: [{ businessDate: date, items: [{ productId: 'bread', qtyNeeded: 2000 }], produced: {} }],
    transfers: [],
  })
  assert.equal(rows[0].production, null)
})

test('days before the shop was on the system are not printed as blank lines', () => {
  // A run of empty ruled lines at the bottom reads as the system losing data
  // rather than as the system not having existed yet.
  const dates = recentDates('2026-08-14', 10)
  const traded = dates[0]
  const { rows } = buildRegister({
    dates,
    branches: BRANCHES,
    products: PRODUCTS,
    closings: closedDay(traded),
    productions: [production(traded)],
    transfers: transfersFor(traded),
  })
  assert.equal(rows.length, 1)
})

test('a quiet day in the middle of a working fortnight is kept', () => {
  // That gap is exactly what the owner wants to notice: somebody did not close.
  const dates = recentDates('2026-08-14', 3)
  const { rows } = buildRegister({
    dates,
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [...closedDay(dates[0]), ...closedDay(dates[2])],
    productions: [],
    transfers: [],
  })
  assert.equal(rows.length, 3)
  assert.equal(rows[1].totalSale, null, 'the middle day stays, empty')
})

test('the foot adds up the fortnight', () => {
  const dates = recentDates('2026-08-14', 2)
  const { totals } = buildRegister({
    dates,
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [...closedDay(dates[0]), ...closedDay(dates[1])],
    productions: [production(dates[0]), production(dates[1])],
    transfers: [...transfersFor(dates[0]), ...transfersFor(dates[1])],
  })
  assert.equal(totals.days, 2)
  assert.equal(totals.production, 400000)
  assert.equal(totals.totalSale, 360000)
  assert.equal(totals.totalStale, 10000)
  assert.equal(totals.perOutlet.MAIN.sold, 160000)
  assert.equal(totals.perOutlet.B2.distributed, 100000)
})

test('one day’s deliveries never leak into another day’s line', () => {
  const dates = recentDates('2026-08-14', 2)
  const { rows } = buildRegister({
    dates,
    branches: BRANCHES,
    products: PRODUCTS,
    closings: [...closedDay(dates[0]), ...closedDay(dates[1])],
    productions: [production(dates[0])],
    transfers: transfersFor(dates[0]),
  })
  assert.equal(rows[0].perOutlet.B2.distributed, 50000)
  assert.equal(rows[1].perOutlet.B2.distributed, 0, 'yesterday had no delivery of its own')
})
