import test from 'node:test'
import assert from 'node:assert/strict'
import { dailySheet, distributedTo, productionValue } from '../src/lib/dailySheet.js'

// The fixture is the owner's own sheet for 13-8-26, photographed off the
// counter. Every expected figure below is a number in his handwriting:
//
//   production 2,00,000
//   distribution   Susan Road 1,00,000 · Gulberg 50,000 · Gulistan Colony 50,000
//   sale position  Susan Road   80,000 · Gulberg 50,000 · Gulistan Colony 50,000
//   total sale 1,80,000 · total stale 5,000
//
// If this file ever disagrees with that row, the screen is wrong, not the paper.

const DATE = '2026-08-13'

const PRODUCTS = [{ id: 'bread', code: '01', name: 'Bread Large', price: 100 }]

const BRANCHES = [
  { id: 'MAIN', name: 'Susan Road', isMain: true },
  { id: 'B2', name: 'Gulberg' },
  { id: 'B3', name: 'Gulistan Colony' },
]

// 2000 loaves at Rs 100 = the 2 lakh he wrote, split 1000/500/500.
const PRODUCTION = {
  businessDate: DATE,
  items: [{ productId: 'bread', qtyNeeded: 2000, perOutlet: { MAIN: 1000, B2: 500, B3: 500 } }],
  produced: { bread: 2000 },
}

// `fromBranch` is on every real note — the compile stamps it, and so does a
// return — and it is what says whose shelf the bread has left.
const TRANSFERS = [
  { fromBranch: 'MAIN', toBranchId: 'B2', status: 'dispatched', items: [{ productId: 'bread', qtySent: 500 }] },
  { fromBranch: 'MAIN', toBranchId: 'B3', status: 'dispatched', items: [{ productId: 'bread', qtySent: 500 }] },
]

const sale = (branchId, total) => ({
  branchId,
  businessDate: DATE,
  status: 'normal',
  payment: 'cash',
  total,
  items: [{ productId: 'bread', name: 'Bread Large', price: 100, qty: total / 100 }],
})

const SALES = [sale('MAIN', 80000), sale('B2', 50000), sale('B3', 50000)]

const CLOSINGS = [
  { branchId: 'MAIN', businessDate: DATE, status: 'closed', wasteValue: 5000 },
  { branchId: 'B2', businessDate: DATE, status: 'closed', wasteValue: 0 },
  { branchId: 'B3', businessDate: DATE, status: 'closed', wasteValue: 0 },
]

const build = (over = {}) =>
  dailySheet({
    products: PRODUCTS,
    branches: BRANCHES,
    production: PRODUCTION,
    transfers: TRANSFERS,
    sales: SALES,
    closings: CLOSINGS,
    businessDate: DATE,
    ...over,
  })

const at = (sheet, id) => sheet.outlets.find((o) => o.branchId === id)

// --- his row, line by line -------------------------------------------------

test("the sheet reproduces the owner's own row for 13-8-26", () => {
  const sheet = build()

  assert.equal(sheet.production.value, 200000, 'production — 2 lakh')

  assert.equal(at(sheet, 'MAIN').distributed, 100000, 'distribution — Susan Road')
  assert.equal(at(sheet, 'B2').distributed, 50000, 'distribution — Gulberg')
  assert.equal(at(sheet, 'B3').distributed, 50000, 'distribution — Gulistan Colony')

  assert.equal(at(sheet, 'MAIN').sold, 80000, 'sale position — Susan Road')
  assert.equal(at(sheet, 'B2').sold, 50000, 'sale position — Gulberg')
  assert.equal(at(sheet, 'B3').sold, 50000, 'sale position — Gulistan Colony')

  assert.equal(sheet.totalSale, 180000, 'total sale')
  assert.equal(sheet.totalStale, 5000, 'total stale')
})

test('what he sent out adds up to what he baked', () => {
  // The check his own sheet passes: 1,00,000 + 50,000 + 50,000 = 2 lakh. If the
  // system ever disagrees, a delivery has gone missing between the two.
  const sheet = build()
  assert.equal(sheet.distributed, sheet.production.value)
})

test('the 15,000 his sheet has no column for is named, not swallowed', () => {
  // Sent 2,00,000, sold 1,80,000, stale 5,000. The 20,000 unsold is bread on a
  // shelf, and 15,000 of it appears nowhere on the paper at all.
  const sheet = build()
  assert.equal(sheet.unsold, 20000)
  assert.equal(sheet.unsold - sheet.totalStale, 15000)
})

test('a bottle of Coke is takings, but is not bread off the shelf', () => {
  // The sale position has to include it — the money is in the drawer. What it
  // must not do is come off the unsold figure, because nothing was ever
  // distributed for it. Counting it there would report 5,000 less bread on the
  // shelf than is really there, and on a quiet morning it would go negative.
  const withCoke = build({
    sales: [
      ...SALES,
      {
        branchId: 'B2',
        businessDate: DATE,
        status: 'normal',
        payment: 'cash',
        total: 5000,
        items: [
          { productId: 'custom:coke', custom: true, name: 'Coke', price: 100, qty: 50 },
        ],
      },
    ],
  })

  assert.equal(at(withCoke, 'B2').sold, 55000, 'the shop took it, so it is in the sale position')
  assert.equal(withCoke.totalSale, 185000)
  assert.equal(withCoke.soldOffList, 5000)
  assert.equal(withCoke.unsold, 20000, 'unchanged — the same bread is still on the shelf')
})

// --- stale is counted, never assumed ---------------------------------------

test('before anyone closes, stale is not known rather than zero', () => {
  // Zero stale is a claim about the day. Not knowing is not, and showing 0 all
  // morning would be a figure the owner could read as good news.
  const sheet = build({ closings: [] })
  assert.equal(sheet.totalStale, null)
  assert.equal(sheet.outletsClosed, 0)
  assert.equal(at(sheet, 'MAIN').stale, null)
})

test('stale counts only the outlets that have actually shut', () => {
  const sheet = build({ closings: [CLOSINGS[0]] })
  assert.equal(sheet.totalStale, 5000)
  assert.equal(sheet.outletsClosed, 1)
  assert.equal(at(sheet, 'B2').stale, null, 'a shop still trading has not counted its waste')
})

test('a day reopened is a day not counted', () => {
  const sheet = build({
    closings: [{ branchId: 'MAIN', businessDate: DATE, status: 'reopened', wasteValue: 5000 }],
  })
  assert.equal(at(sheet, 'MAIN').closed, false)
  assert.equal(sheet.totalStale, null)
})

test("yesterday's close is not today's stale", () => {
  const sheet = build({
    closings: [{ branchId: 'MAIN', businessDate: '2026-08-12', status: 'closed', wasteValue: 9999 }],
  })
  assert.equal(sheet.totalStale, null)
})

// --- production is what came out of the oven -------------------------------

test('production counts what was baked, not what was asked for', () => {
  // A short bake is a real morning. The sheet says "production", so it has to
  // say what actually came out, with the plan kept alongside to explain it.
  const short = productionValue(
    { items: PRODUCTION.items, produced: { bread: 1500 } },
    { bread: 100 },
  )
  assert.equal(short.value, 150000)
  assert.equal(short.planned, 200000)
})

test('a bake nobody has recorded yet reads as nothing recorded', () => {
  const none = productionValue({ items: PRODUCTION.items, produced: {} }, { bread: 100 })
  assert.equal(none.value, 0)
  assert.equal(none.linesRecorded, 0)
  assert.equal(none.lines, 1)
  assert.equal(none.planned, 200000, 'so a screen can say what was expected instead')
})

test('a tray nobody ordered still counts as production', () => {
  const withExtra = productionValue(
    {
      items: PRODUCTION.items,
      produced: { bread: 2000 },
      extras: { donut: { productId: 'donut', productName: 'Donut', qty: 100 } },
    },
    { bread: 100, donut: 50 },
  )
  assert.equal(withExtra.value, 205000)
})

test('an extra taken back to zero is not production', () => {
  const withdrawn = productionValue(
    {
      items: PRODUCTION.items,
      produced: { bread: 2000 },
      extras: { donut: { productId: 'donut', qty: 0 } },
    },
    { bread: 100, donut: 50 },
  )
  assert.equal(withdrawn.value, 200000)
})

// --- distribution ----------------------------------------------------------

test('the hub is distributed to from the bake, not from a delivery note', () => {
  // Nothing goes in a van to Susan Road; its share is simply the half of the
  // bake that stayed. It still belongs in the Distribution column.
  const share = distributedTo({
    branch: BRANCHES[0],
    production: PRODUCTION,
    transfers: TRANSFERS,
    prices: { bread: 100 },
  })
  assert.equal(share.value, 100000)
})

test('a delivery still being counted at the far end has still been sent', () => {
  const sheet = build({
    transfers: [
      { fromBranch: 'MAIN', toBranchId: 'B2', status: 'received', items: [{ productId: 'bread', qtySent: 500 }] },
      { fromBranch: 'MAIN', toBranchId: 'B3', status: 'dispatched', items: [{ productId: 'bread', qtySent: 500 }] },
    ],
  })
  assert.equal(at(sheet, 'B2').distributed, 50000)
  assert.equal(at(sheet, 'B3').distributed, 50000)
})

test('a note still on the bench has not been distributed', () => {
  const sheet = build({
    transfers: [
      { fromBranch: 'MAIN', toBranchId: 'B2', status: 'draft', items: [{ productId: 'bread', qtyDemanded: 500 }] },
    ],
  })
  assert.equal(at(sheet, 'B2').distributed, 0)
})

test('stock coming back to the hub is not a distribution', () => {
  const sheet = build({
    transfers: [
      ...TRANSFERS,
      {
        fromBranch: 'B2',
        toBranchId: 'MAIN',
        direction: 'return',
        status: 'received',
        items: [{ productId: 'bread', qtySent: 100 }],
      },
    ],
  })
  assert.equal(at(sheet, 'MAIN').distributed, 100000, 'unchanged by the van coming back')
})

// --- sale position ---------------------------------------------------------

test('a voided sale is not a sale position', () => {
  const sheet = build({
    sales: [...SALES, { ...sale('B2', 5000), status: 'voided' }],
  })
  assert.equal(at(sheet, 'B2').sold, 50000)
})

test('a refund comes off the day, as it does everywhere else', () => {
  const sheet = build({
    sales: [...SALES, { ...sale('B2', -2000), status: 'refund' }],
  })
  assert.equal(at(sheet, 'B2').sold, 48000)
  assert.equal(sheet.totalSale, 178000)
})

test('an outlet that sold nothing still has a line', () => {
  // A shop with no takings is a fact worth seeing — usually a delivery that
  // never arrived — and leaving it off would hide it exactly when it matters.
  const sheet = build({ sales: [sale('MAIN', 80000)] })
  assert.equal(sheet.outlets.length, 3)
  assert.equal(at(sheet, 'B2').sold, 0)
})

// --- nothing at all --------------------------------------------------------

test('a day before anything has happened reads as zeroes, not as rubbish', () => {
  const sheet = dailySheet({ products: PRODUCTS, branches: BRANCHES, businessDate: DATE })
  assert.equal(sheet.production.value, 0)
  assert.equal(sheet.totalSale, 0)
  assert.equal(sheet.distributed, 0)
  assert.equal(sheet.totalStale, null)
  assert.equal(sheet.unsold, 0)
  assert.equal(sheet.outlets.length, 3)
})

test('a product with no price set does not poison the total with NaN', () => {
  const sheet = build({ products: [{ id: 'bread', name: 'Bread Large' }] })
  assert.equal(sheet.production.value, 0)
  assert.equal(Number.isNaN(sheet.distributed), false)
})
