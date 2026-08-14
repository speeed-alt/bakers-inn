// The money maths is the part that must never be wrong, so it is the part that
// is tested. Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { expectedCash, overShort, summariseDay } from '../src/lib/report.js'
import { formatMoney, parseMoney, basketTotal } from '../src/lib/money.js'
import { itemCount, itemRow, receiptModel } from '../src/lib/receipt.js'

const sale = (over) => ({
  status: 'normal',
  payment: 'cash',
  total: 1000,
  items: [{ productId: 'p1', name: 'Loaf', price: 500, qty: 2 }],
  ...over,
})

test('totals split by payment type', () => {
  const s = summariseDay([sale(), sale({ payment: 'card', total: 250, items: [] })])
  assert.equal(s.salesTotal, 1250)
  assert.equal(s.cashTotal, 1000)
  assert.equal(s.cardTotal, 250)
  assert.equal(s.txCount, 2)
})

test('a voided sale leaves every total but stays on the record', () => {
  const s = summariseDay([sale(), sale({ status: 'voided' })])
  assert.equal(s.salesTotal, 1000)
  assert.equal(s.cashTotal, 1000)
  assert.equal(s.txCount, 1)
  assert.equal(s.voidedCount, 1)
  assert.equal(s.byProduct[0].qty, 2, 'voided quantities must not count as sold')
})

test('a refund is a negative sale and reduces takings and quantities', () => {
  const s = summariseDay([
    sale(),
    sale({ status: 'refund', total: -1000, items: [{ productId: 'p1', name: 'Loaf', price: 500, qty: -2 }] }),
  ])
  assert.equal(s.salesTotal, 0)
  assert.equal(s.cashTotal, 0)
  assert.equal(s.refundTotal, -1000)
  assert.equal(s.txCount, 1)
  assert.equal(s.refundCount, 1)
  assert.equal(s.byProduct[0].qty, 0)
})

test('expected cash is the float plus cash takings only', () => {
  const s = summariseDay([sale(), sale({ payment: 'card', total: 9999, items: [] })])
  assert.equal(expectedCash(s, 5000), 6000)
  assert.equal(overShort(6000, s, 5000), 0)
  assert.equal(overShort(5950, s, 5000), -50)
  assert.equal(overShort(6100, s, 5000), 100)
})

test('rupees format as whole numbers with grouping', () => {
  assert.equal(formatMoney(0), 'Rs 0')
  assert.equal(formatMoney(250), 'Rs 250')
  assert.equal(formatMoney(1250), 'Rs 1,250')
  assert.equal(formatMoney(123456), 'Rs 123,456')
  assert.equal(formatMoney(-50), '-Rs 50')
  assert.equal(formatMoney(1800, { symbol: false }), '1,800')
})

test('typed amounts parse, including ones with separators', () => {
  assert.equal(parseMoney('250'), 250)
  assert.equal(parseMoney('1,250'), 1250)
  assert.equal(parseMoney('Rs 5,000'), 5000)
  assert.equal(parseMoney(''), null)
  assert.equal(parseMoney('abc'), null)
  // No paisa in circulation, so a typed fraction rounds to the nearest rupee.
  assert.equal(parseMoney('250.4'), 250)
  assert.equal(parseMoney('250.6'), 251)
})

// Till entry-box matching is covered in search.test.mjs.

test('a line carries its rate, its quantity and what that came to', () => {
  const row = itemRow({ name: 'Bread Small', price: 120, qty: 30 })
  assert.equal(row.name, 'Bread Small')
  assert.equal(row.rate, '120')
  assert.equal(row.qty, '30')
  assert.equal(row.amount, '3,600')
})

test('a long name is kept whole — the table wraps it, nothing truncates it', () => {
  // "Birthday Cake (1 l" on a customer's receipt reads as a fault in the till
  // rather than as a long name, so the name is never shortened here. Fitting
  // it is the table's job now, not this function's.
  const name = 'Chocolate Fudge Celebration Cake Extra Large'
  const row = itemRow({ name, price: 4500, qty: 2 })
  assert.equal(row.name, name)
  assert.equal(row.amount, '9,000')
})

test('a weighed line names its unit and keeps the quantity a bare number', () => {
  // The unit rides on the name because every printed bill here has a column of
  // bare numbers under Qty, and "4.5 kg" in it breaks that scan.
  const row = itemRow({ name: 'Biscuits', price: 1400, qty: 4.5, soldByWeight: true, unit: 'kg' })
  assert.equal(row.name, 'Biscuits (kg)')
  assert.equal(row.rate, '1,400')
  assert.equal(row.qty, '4.5')
  assert.equal(row.amount, '6,300')
})

test('a weighed quantity does not trail meaningless zeros', () => {
  const whole = itemRow({ name: 'Biscuits', price: 1400, qty: 12.5, soldByWeight: true, unit: 'kg' })
  assert.equal(whole.qty, '12.5')
  assert.equal(whole.amount, '17,500')
})

test('two lines of the same thing get different keys', () => {
  // Two one-offs can share a name and a price, and two variants of a merged
  // product share an id. Position is what keeps them apart.
  const a = itemRow({ productId: 'custom:coke', name: 'Coke', price: 80, qty: 1 }, 0)
  const b = itemRow({ productId: 'custom:coke', name: 'Coke', price: 80, qty: 1 }, 1)
  assert.notEqual(a.key, b.key)
})

test('items counts what was bought, not how many lines it took', () => {
  assert.equal(itemCount([{ qty: 9 }, { qty: 9 }, { qty: 30 }, { qty: 15 }]), 63)
  assert.equal(itemCount([]), 0)
})

test('a weighed line counts as one thing, not as its weight', () => {
  // 63 loaves plus 4.5 kg of biscuits is 64 things, not 67.5 of anything.
  const items = [{ qty: 63 }, { qty: 4.5, soldByWeight: true }]
  assert.equal(itemCount(items), 64)
})

test('the slip carries everything a customer would check', () => {
  const r = receiptModel(
    {
      ref: 'S-MAIN-0728-A001',
      branchId: 'MAIN',
      businessDate: '2026-07-28',
      status: 'normal',
      payment: 'cash',
      cashierName: 'Ayesha',
      device: 'A',
      total: 3030,
      cashGiven: 5000,
      changeGiven: 1970,
      items: [
        { name: 'Birthday Cake (1 lb)', price: 1800, qty: 1 },
        { name: 'Vegetable Samosa', price: 70, qty: 1 },
      ],
    },
    'Susan Road',
  )

  assert.equal(r.outlet, 'Susan Road')
  assert.equal(r.cashier, 'Ayesha')
  assert.equal(r.till, 'A')
  assert.equal(r.itemCount, 2)
  assert.equal(r.rows.length, 2)
  assert.equal(r.total, 'Rs 3,030')
  assert.equal(r.cashGiven, 'Rs 5,000')
  assert.equal(r.changeGiven, 'Rs 1,970')
  assert.equal(r.isRefund, false)
  // The figure spelled out, which is what stops a pen changing it.
  assert.match(r.words, /THREE THOUSAND THIRTY/i)
})

test('a card sale prints how it was paid and no cash lines', () => {
  // Nothing to imply the payment type, so it has to be said outright.
  const r = receiptModel(
    { businessDate: '2026-07-28', status: 'normal', payment: 'card', total: 800, items: [] },
    'Gulberg',
  )
  assert.equal(r.payment, 'card')
  assert.equal(r.cashGiven, null)
  assert.equal(r.changeGiven, null)
})

test('a cash sale does not repeat the payment type it already shows', () => {
  const r = receiptModel(
    {
      businessDate: '2026-07-28',
      status: 'normal',
      payment: 'cash',
      total: 800,
      cashGiven: 1000,
      changeGiven: 200,
      items: [],
    },
    'Gulberg',
  )
  assert.equal(r.payment, null, 'the cash and change lines already say it')
})

test('a refund says so, because a refund slip that reads like a bill gets paid twice', () => {
  const r = receiptModel(
    { businessDate: '2026-07-28', status: 'refund', payment: 'cash', total: -500, items: [] },
    'Gulberg',
  )
  assert.equal(r.isRefund, true)
  assert.equal(r.payment, null)
})

test('the slip carries the address of the counter the customer stood at', () => {
  // Three shops in three places cannot share one address. The first version of
  // this printed the shop's name directly above a different shop's address.
  const r = receiptModel(
    { businessDate: '2026-07-28', total: 0, items: [] },
    { name: 'Gulberg', address: 'Kohinoor Plaza, Faisalabad', phone: '0300-1234567' },
  )
  assert.equal(r.outlet, 'Gulberg')
  assert.equal(r.address, 'Kohinoor Plaza, Faisalabad')
  assert.equal(r.phone, '0300-1234567')
})

test('an outlet with no address of its own falls back rather than printing none', () => {
  const r = receiptModel({ businessDate: '2026-07-28', total: 0, items: [] }, { name: 'Gulberg' })
  assert.equal(r.outlet, 'Gulberg')
  assert.ok(r.address.length > 0, 'falls back to BUSINESS_ADDRESS')
})

test('a caller with only the name still gets a slip', () => {
  const r = receiptModel({ businessDate: '2026-07-28', total: 0, items: [] }, 'Susan Road')
  assert.equal(r.outlet, 'Susan Road')
  assert.ok(r.business.length > 0)
})

test('a long basket stays exact', () => {
  const lines = Array.from({ length: 7 }, () => ({ price: 333, qty: 3 }))
  assert.equal(basketTotal(lines), 6993)
  assert.equal(formatMoney(basketTotal(lines)), 'Rs 6,993')
})
