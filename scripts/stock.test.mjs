import test from 'node:test'
import assert from 'node:assert/strict'
import {
  byProduct,
  receivedAt,
  sentBackFrom,
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

test('stock coming back to the hub is an arrival, because it arrives', () => {
  // This asserted the opposite, and the opposite lost stock every night. The
  // reasoning behind it was that a return is not a delivery — true from the
  // shop's end, where it is a departure. But the loop has already narrowed to
  // notes addressed *to* this outlet, so what is left here is the hub taking
  // crates off a van. Excluding them meant unsold bread left the shop's books,
  // where it correctly stopped being carried, and never reached the hub's:
  // counted in by a named person, and then accounted for nowhere.
  const transfers = [
    {
      fromBranch: 'B2',
      toBranchId: 'MAIN',
      direction: 'return',
      status: 'received',
      items: [{ productId: 'rusk', qtySent: 5, qtyReceived: 5 }],
    },
  ]
  assert.deepEqual(receivedAt({ branchId: 'MAIN', transfers }), { rusk: 5 })
})

test('a return still on its way back has not arrived', () => {
  const transfers = [
    {
      fromBranch: 'B2',
      toBranchId: 'MAIN',
      direction: 'return',
      status: 'dispatched',
      items: [{ productId: 'rusk', qtySent: 5 }],
    },
  ]
  assert.deepEqual(receivedAt({ branchId: 'MAIN', transfers }), {})
})

test('the hub keeps what it made and did not put on a note', () => {
  // The compile writes a draft note for every outlet in the same batch as the
  // list, so bread destined for Gulberg is spoken for from the moment the list
  // exists — long before the van. That is what keeps the hub's closing count to
  // its own forty rather than the whole bake standing in the room.
  const production = {
    items: [{ productId: 'bread-large', perOutlet: { MAIN: 12, B2: 40 } }],
    produced: { 'bread-large': 52 },
  }
  const transfers = [
    {
      fromBranch: 'MAIN',
      toBranchId: 'B2',
      status: 'draft',
      items: [{ productId: 'bread-large', qtyDemanded: 40, qtySent: null }],
    },
  ]
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', isMain: true, transfers, production }),
    { 'bread-large': 12 },
  )
})

test('a short bake the hub gives away entirely leaves the hub with nothing', () => {
  // The one that put bread on the owner's screen that was forty minutes down
  // the road. Twelve came out of the oven against an order for fifty-two; the
  // baker sent all twelve to Gulberg rather than keep his own share. The hub's
  // shelf is empty, and it used to read twelve.
  const production = {
    items: [{ productId: 'bread-large', perOutlet: { MAIN: 12, B2: 40 } }],
    produced: { 'bread-large': 12 },
  }
  const transfers = [
    {
      fromBranch: 'MAIN',
      toBranchId: 'B2',
      status: 'dispatched',
      items: [{ productId: 'bread-large', qtyDemanded: 40, qtySent: 12 }],
    },
  ]
  assert.deepEqual(receivedAt({ branchId: 'MAIN', isMain: true, transfers, production }), {})
})

test('a tray the hub baked and kept is the hub’s stock', () => {
  // Extras belonged nowhere at all: the old figure was capped at what the hub
  // had ordered for its own counter, so a second bake nobody asked for was, on
  // every screen in the system, zero.
  const production = {
    items: [],
    produced: {},
    extras: { rusk: { productId: 'rusk', productName: 'Rusk', qty: 20 } },
  }
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', isMain: true, transfers: [], production }),
    { rusk: 20 },
  )
})

test('an extra shared out is only the hub’s for the part it kept', () => {
  const production = {
    items: [],
    produced: {},
    extras: { rusk: { productId: 'rusk', productName: 'Rusk', qty: 20 } },
  }
  const transfers = [
    {
      fromBranch: 'MAIN',
      toBranchId: 'B2',
      status: 'dispatched',
      items: [{ productId: 'rusk', qtyDemanded: 0, qtySent: 8, extra: true }],
    },
  ]
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', isMain: true, transfers, production }),
    { rusk: 12 },
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
  // No key at all rather than a zero, so the close wizard does not ask anybody
  // to count a product the ovens have not produced.
  const production = { items: [{ productId: 'bread-large', perOutlet: { MAIN: 12 } }] }
  assert.deepEqual(receivedAt({ branchId: 'MAIN', isMain: true, transfers: [], production }), {})
})

test('a delivery counts on the day it was taken in, not the day on the note', () => {
  // The baker bakes tomorrow's bread tonight, so the note is stamped tomorrow.
  // The shop counts it in this evening and sells from it this evening. Read
  // against the note's own date, closing today showed a shop that had taken in
  // seventy-two items as having taken in none.
  const note = {
    fromBranch: 'MAIN',
    toBranchId: 'B2',
    businessDate: '2026-08-20',
    receivedOn: '2026-08-19',
    status: 'received',
    items: [{ productId: 'bread-large', qtySent: 40, qtyReceived: 40 }],
  }
  assert.deepEqual(
    receivedAt({ branchId: 'B2', transfers: [note], businessDate: '2026-08-19' }),
    { 'bread-large': 40 },
  )
  // And it belongs to that day only — otherwise closing both days would count
  // the same forty loaves twice.
  assert.deepEqual(
    receivedAt({ branchId: 'B2', transfers: [note], businessDate: '2026-08-20' }),
    {},
  )
})

test('a note written before arrivals were stamped falls back to its own date', () => {
  const old = {
    fromBranch: 'MAIN',
    toBranchId: 'B2',
    businessDate: '2026-08-19',
    status: 'received',
    items: [{ productId: 'bread-large', qtySent: 10, qtyReceived: 10 }],
  }
  assert.deepEqual(
    receivedAt({ branchId: 'B2', transfers: [old], businessDate: '2026-08-19' }),
    { 'bread-large': 10 },
  )
})

test('stock a shop has sent back is no longer on that shop’s shelf', () => {
  // It was in two places at once: still at the shop that sent it, and now also
  // at the hub that took it in, so the owner's total for the day was larger
  // than the bakery had made.
  const arrived = {
    fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-08-19', receivedOn: '2026-08-19',
    status: 'received', items: [{ productId: 'rusk', qtySent: 12, qtyReceived: 12 }],
  }
  const goneBack = {
    fromBranch: 'B2', toBranchId: 'MAIN', businessDate: '2026-08-19',
    direction: 'return', status: 'dispatched',
    items: [{ productId: 'rusk', qtySent: 12, qtyReceived: null }],
  }

  const shop = stockAt({
    products,
    branch: branches[1],
    transfers: [arrived, goneBack],
    sales: [],
    businessDate: '2026-08-19',
  })
  assert.equal(shop.lines.find((l) => l.productId === 'rusk').expected, 0)

  // From the moment the note is written, not when the hub confirms it: the
  // crates are on the van either way.
  const confirmed = stockAt({
    products,
    branch: branches[1],
    transfers: [arrived, { ...goneBack, status: 'received' }],
    sales: [],
    businessDate: '2026-08-19',
  })
  assert.equal(confirmed.lines.find((l) => l.productId === 'rusk').expected, 0)

  // And the next day it is not taken off twice — the shop's own carryover has
  // already excluded it, so a note from yesterday must not subtract again.
  const tomorrow = stockAt({
    products,
    branch: branches[1],
    transfers: [goneBack],
    sales: [],
    previousClosing: { carry: [{ productId: 'rusk', qty: 3 }] },
    businessDate: '2026-08-20',
  })
  assert.equal(tomorrow.lines.find((l) => l.productId === 'rusk').expected, 3)
})

test('the hub gains exactly what the shop lost', () => {
  const goneBack = {
    fromBranch: 'B2', toBranchId: 'MAIN', businessDate: '2026-08-19', receivedOn: '2026-08-19',
    direction: 'return', status: 'received',
    items: [{ productId: 'rusk', qtySent: 12, qtyReceived: 12 }],
  }
  assert.deepEqual(
    receivedAt({ branchId: 'MAIN', transfers: [goneBack], businessDate: '2026-08-19' }),
    { rusk: 12 },
  )
  assert.deepEqual(
    sentBackFrom({ branchId: 'B2', transfers: [goneBack], businessDate: '2026-08-19' }),
    { rusk: 12 },
  )
})

test('stock that only moved between outlets is not counted as more to sell', () => {
  // Twelve rusks delivered to Gulberg and sent back the same evening are
  // twelve rusks, not twenty-four. The row is the group's whole story, so both
  // ends of that journey are in it, and adding them both would tell the owner
  // his bakery had more to sell than it ever made.
  const report = stockReport({
    products,
    branches,
    transfers: [
      {
        fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-08-12',
        receivedOn: '2026-08-12', status: 'received',
        items: [{ productId: 'rusk', qtySent: 12, qtyReceived: 12 }],
      },
      {
        fromBranch: 'B2', toBranchId: 'MAIN', businessDate: '2026-08-12',
        receivedOn: '2026-08-12', direction: 'return', status: 'received',
        items: [{ productId: 'rusk', qtySent: 12, qtyReceived: 12 }],
      },
    ],
    sales: [],
    closings: [],
    businessDate: '2026-08-12',
    previousDate: '2026-08-11',
  })

  const rusk = byProduct(report).find((r) => r.productId === 'rusk')
  assert.equal(rusk.available, 12, 'twelve rusks, not twenty-four')
  assert.equal(rusk.left, 12)
  assert.equal(rusk.perOutlet.B2.left, 0)
  assert.equal(rusk.perOutlet.MAIN.left, 12)
  assert.equal(rusk.unaccounted, 0, 'nothing is missing — it moved')
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
        businessDate: '2026-08-12',
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
        businessDate: '2026-08-12',
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
        businessDate: '2026-08-12',
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
