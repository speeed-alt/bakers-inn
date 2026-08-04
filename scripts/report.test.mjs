// The money maths is the part that must never be wrong, so it is the part that
// is tested. Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { expectedCash, overShort, summariseDay } from '../src/lib/report.js'
import { formatMoney, parseMoney, basketTotal } from '../src/lib/money.js'
import { itemLines, receiptText, row, wrap } from '../src/lib/receipt.js'
import { RECEIPT_WIDTH } from '../src/config.js'
import { fontSizeFor } from '../src/lib/paper.js'

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

test('a receipt line never loses the end of a product name', () => {
  const line = itemLines({ name: 'Birthday Cake (1 lb)', price: 1800, qty: 1 })
  assert.equal(line.length, 1)
  assert.match(line[0], /Birthday Cake \(1 lb\)/)
  assert.match(line[0], /1,800$/)
  assert.equal(line[0].length, RECEIPT_WIDTH)
})

test('a name too wide for the roll wraps instead of truncating', () => {
  const name = 'Chocolate Fudge Celebration Cake Extra Large'
  const lines = itemLines({ name, price: 4500, qty: 2 })
  assert.ok(lines.length > 1, 'should spill onto more than one line')
  // Every word survives somewhere, and nothing overflows the roll.
  const joined = lines.join(' ')
  for (const word of name.split(' ')) assert.ok(joined.includes(word), `lost "${word}"`)
  for (const l of lines) assert.ok(l.length <= RECEIPT_WIDTH, `too wide: "${l}"`)
  assert.match(lines.at(-1), /2 x 4,500\s+9,000$/)
})

test('wrapping breaks a single unbroken word rather than overflowing', () => {
  const lines = wrap('A'.repeat(70), RECEIPT_WIDTH)
  assert.ok(lines.every((l) => l.length <= RECEIPT_WIDTH))
  assert.equal(lines.join('').length, 70)
})

test('amounts sit flush to the right edge of the roll', () => {
  assert.equal(row('TOTAL', 'Rs 3,030').length, RECEIPT_WIDTH)
  assert.ok(row('TOTAL', 'Rs 3,030').endsWith('Rs 3,030'))
})

test('a full receipt fits the roll and shows the money', () => {
  const text = receiptText(
    {
      ref: 'S-MAIN-0728-A001',
      branchId: 'MAIN',
      businessDate: '2026-07-28',
      status: 'normal',
      payment: 'cash',
      cashierName: 'Ayesha',
      total: 3030,
      cashGiven: 5000,
      changeGiven: 1970,
      items: [
        { name: 'Birthday Cake (1 lb)', price: 1800, qty: 1 },
        { name: 'Vegetable Samosa', price: 70, qty: 1 },
      ],
    },
    'Main Outlet',
  )
  for (const l of text.split('\n')) assert.ok(l.length <= RECEIPT_WIDTH, `too wide: "${l}"`)
  assert.match(text, /TOTAL\s+Rs 3,030/)
  assert.match(text, /Change\s+1,970/)
  assert.match(text, /Served by Ayesha/)
})

test('type size makes the slip span the paper, whatever the paper is', () => {
  // A slip that lands as a small block in the corner is what forces people to
  // wind the scale up in the print dialog.
  const roll = fontSizeFor(74)
  const a5 = fontSizeFor(132)
  const a4 = fontSizeFor(186)

  // Sanity: bigger paper needs bigger type to fill the same 32 characters.
  assert.ok(roll < a5 && a5 < a4)
  // A thermal roll wants ordinary receipt-sized type.
  assert.ok(roll > 8 && roll < 14, `80mm roll got ${roll}pt`)
  // A5 lands near the doubling the owner had to dial in by hand.
  assert.ok(a5 / roll > 1.6 && a5 / roll < 2.1, `A5 is ${(a5 / roll).toFixed(2)}x the roll`)

  // The characters really do span the paper, give or take a millimetre.
  const spanMm = (pt) => RECEIPT_WIDTH * 0.6 * pt * (25.4 / 72)
  assert.ok(Math.abs(spanMm(a5) - 132) < 1)
  assert.ok(Math.abs(spanMm(roll) - 74) < 1)
})

test('a long basket stays exact', () => {
  const lines = Array.from({ length: 7 }, () => ({ price: 333, qty: 3 }))
  assert.equal(basketTotal(lines), 6993)
  assert.equal(formatMoney(basketTotal(lines)), 'Rs 6,993')
})
