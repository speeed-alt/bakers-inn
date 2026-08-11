import test from 'node:test'
import assert from 'node:assert/strict'
import {
  byProduct,
  receivedAt,
  soldAt,
  stockAt,
  stockReport,
  stockTotals,
} from '../src/lib/stock.js'

const products = [
  { id: 'bread-large', code: '02', name: 'Bread Large', price: 220 },
  { id: 'rusk', code: '05', name: 'Rusk', price: 150, sellsNextDay: true },
]

const branches = [
  { id: 'MAIN', name: 'Main Outlet', isMain: true },
  { id: 'B2', name: 'Gulberg' },
]

test('a counted-in delivery is stock; one still in the van is not', () => {
  const transfers = [
    {
      toBranchId: 'B2',
      status: 'received',
      items: [{ productId: 'bread-large', qtySent: 40, qtyReceived: 38 }],
    },
    {
      toBranchId: 'B2',
      status: 'dispatched',
      items: [{ productId: 'rusk', qtySent: 20 }],
    },
  ]
  // The received note counts what actually arrived, not what was sent. The
  // dispatched one is not on a shelf yet.
  assert.deepEqual(receivedAt({ branchId: 'B2', transfers }), { 'bread-large': 38 })
})

test('stock going back to the hub is not an arrival', () => {
  const transfers = [
    {
      toBranchId: 'MAIN',
      direction: 'return',
      status: 'received',
      items: [{ productId: 'rusk', qtySent: 5, qtyReceived: 5 }],
    },
  ]
  assert.deepEqual(receivedAt({ branchId: 'MAIN', transfers }), {})
})

test('the hub keeps its own share of the bake rather than sending itself a note', () => {
  const production = {
    items: [{ productId: 'bread-large', perOutlet: { MAIN: 12, B2: 40 } }],
    produced: { 'bread-large': 52 },
  }
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', isMain: true, transfers: [], production }),
    { 'bread-large': 12 },
  )
})

test('the hub has what was baked, not what was planned', () => {
  // A short bake means the hub's own counter is short too. Counting the plan
  // would put bread on the shelf that never came out of the oven.
  const production = {
    items: [{ productId: 'bread-large', perOutlet: { MAIN: 12 } }],
    produced: { 'bread-large': 5 },
  }
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', isMain: true, transfers: [], production }),
    { 'bread-large': 5 },
  )
})

test('before anything is recorded as baked, the hub has nothing', () => {
  const production = { items: [{ productId: 'bread-large', perOutlet: { MAIN: 12 } }] }
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', isMain: true, transfers: [], production }),
    { 'bread-large': 0 },
  )
})

test('a voided sale did not sell anything', () => {
  const sales = [
    { branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 3 }] },
    { branchId: 'B2', status: 'voided', items: [{ productId: 'bread-large', qty: 9 }] },
    { branchId: 'MAIN', status: 'normal', items: [{ productId: 'bread-large', qty: 5 }] },
  ]
  assert.deepEqual(soldAt(sales, 'B2'), { 'bread-large': 3 })
})

test("one outlet's shelf is what came in less what went out", () => {
  const shelf = stockAt({
    products,
    branch: branches[1],
    transfers: [
      {
        toBranchId: 'B2',
        status: 'received',
        items: [{ productId: 'bread-large', qtySent: 40, qtyReceived: 40 }],
      },
    ],
    sales: [{ branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 15 }] }],
    previousClosing: { carry: [{ productId: 'rusk', qty: 6 }] },
  })

  const bread = shelf.lines.find((l) => l.productId === 'bread-large')
  assert.equal(bread.received, 40)
  assert.equal(bread.sold, 15)
  assert.equal(bread.expected, 25)

  // Yesterday's rusk carried over and nobody has bought any.
  const rusk = shelf.lines.find((l) => l.productId === 'rusk')
  assert.equal(rusk.carriedIn, 6)
  assert.equal(rusk.expected, 6)

  assert.equal(shelf.onShelf, 31)
  assert.equal(shelf.value, 25 * 220 + 6 * 150)
})

test('selling more than arrived shows nothing left, not minus two loaves', () => {
  const shelf = stockAt({
    products,
    branch: branches[1],
    transfers: [],
    sales: [{ branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 2 }] }],
  })
  assert.equal(shelf.lines.find((l) => l.productId === 'bread-large').expected, 0)
})

test('an outlet with nothing still appears, because an empty shop is a fact', () => {
  const report = stockReport({
    products,
    branches,
    transfers: [],
    sales: [],
    closings: [],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })
  assert.deepEqual(report.outlets.map((o) => o.branchName), ['Main Outlet', 'Gulberg'])
  assert.equal(report.onShelf, 0)
})

test('yesterday is matched per outlet, not taken from whichever closed first', () => {
  const report = stockReport({
    products,
    branches,
    transfers: [],
    sales: [],
    closings: [
      { branchId: 'MAIN', businessDate: '2026-08-11', carry: [{ productId: 'rusk', qty: 4 }] },
      { branchId: 'B2', businessDate: '2026-08-11', carry: [{ productId: 'rusk', qty: 9 }] },
      // An older close for the same outlet must not be picked up.
      { branchId: 'B2', businessDate: '2026-08-10', carry: [{ productId: 'rusk', qty: 99 }] },
    ],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })
  assert.equal(report.outlets[0].onShelf, 4)
  assert.equal(report.outlets[1].onShelf, 9)
  assert.equal(report.onShelf, 13)
})

test('turned round, it is one row per product and a column per outlet', () => {
  const report = stockReport({
    products,
    branches,
    transfers: [],
    sales: [],
    closings: [
      { branchId: 'MAIN', businessDate: '2026-08-11', carry: [{ productId: 'rusk', qty: 4 }] },
      { branchId: 'B2', businessDate: '2026-08-11', carry: [{ productId: 'rusk', qty: 9 }] },
    ],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })

  const rows = byProduct(report)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].productName, 'Rusk')
  assert.equal(rows[0].perOutlet.MAIN.left, 4)
  assert.equal(rows[0].perOutlet.B2.left, 9)
  assert.equal(rows[0].left, 13)
})

test('each row carries what came in, what sold, what is left, and what it is worth', () => {
  const report = stockReport({
    products,
    branches,
    transfers: [
      {
        toBranchId: 'B2',
        status: 'received',
        items: [{ productId: 'bread-large', qtySent: 40, qtyReceived: 40 }],
      },
    ],
    sales: [
      { branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 15 }] },
    ],
    closings: [
      { branchId: 'B2', businessDate: '2026-08-11', carry: [{ productId: 'bread-large', qty: 5 }] },
    ],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })

  const bread = byProduct(report).find((r) => r.productId === 'bread-large')
  assert.equal(bread.carriedIn, 5)
  assert.equal(bread.received, 40)
  assert.equal(bread.available, 45)
  assert.equal(bread.sold, 15)
  assert.equal(bread.left, 30)
  assert.equal(bread.worth, 30 * 220)
  assert.equal(bread.soldValue, 15 * 220)
})

test('an outlet with none because it sold out reads differently from one that got none', () => {
  const report = stockReport({
    products,
    branches,
    transfers: [
      {
        toBranchId: 'B2',
        status: 'received',
        items: [{ productId: 'bread-large', qtySent: 10, qtyReceived: 10 }],
      },
    ],
    sales: [{ branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 10 }] }],
    closings: [],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })

  const bread = byProduct(report).find((r) => r.productId === 'bread-large')
  // Gulberg sold out; the hub never had any. Both show nothing left, and the
  // difference is the whole reason the row carries more than one figure.
  assert.equal(bread.perOutlet.B2.left, 0)
  assert.equal(bread.perOutlet.B2.sold, 10)
  assert.equal(bread.perOutlet.MAIN, undefined)
})

test('the totals add up the rows', () => {
  const rows = [
    { available: 45, sold: 15, left: 30, worth: 6600, soldValue: 3300, unaccounted: 0 },
    { available: 10, sold: 4, left: 6, worth: 900, soldValue: 600, unaccounted: 0 },
  ]
  assert.deepEqual(stockTotals(rows), {
    available: 55,
    sold: 19,
    left: 36,
    worth: 7500,
    soldValue: 3900,
    unaccounted: 0,
  })
  assert.deepEqual(stockTotals([]), {
    available: 0,
    sold: 0,
    left: 0,
    worth: 0,
    soldValue: 0,
    unaccounted: 0,
  })
})

test('selling more than arrived is named rather than swallowed by the clamp', () => {
  const report = stockReport({
    products,
    branches,
    transfers: [],
    // Nothing was ever delivered, yet three loaves were sold. Per line the
    // shelf clamps at zero — there is no minus-three bread — but that would
    // leave the totals not adding up, which reads as broken arithmetic.
    sales: [{ branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 3 }] }],
    closings: [],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })

  const bread = byProduct(report).find((r) => r.productId === 'bread-large')
  assert.equal(bread.available, 0)
  assert.equal(bread.sold, 3)
  assert.equal(bread.left, 0)
  assert.equal(bread.unaccounted, 3)
  assert.equal(stockTotals(byProduct(report)).unaccounted, 3)
})

test('one shop overselling is not cancelled out by another sitting on stock', () => {
  // Gulberg sells four it never received; the hub has forty untouched. Measured
  // on the row those cancel and the gap vanishes — leaving totals that cannot
  // be reconciled and no explanation on screen. It has to be counted per outlet.
  const report = stockReport({
    products,
    branches,
    transfers: [
      {
        toBranchId: 'MAIN',
        status: 'received',
        items: [{ productId: 'bread-large', qtySent: 40, qtyReceived: 40 }],
      },
    ],
    sales: [{ branchId: 'B2', status: 'normal', items: [{ productId: 'bread-large', qty: 4 }] }],
    closings: [],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })

  const rows = byProduct(report)
  const totals = stockTotals(rows)
  assert.equal(totals.unaccounted, 4)
  // And with it named, the top line reconciles: had − sold + unaccounted = left.
  assert.equal(totals.available - totals.sold + totals.unaccounted, totals.left)
})
