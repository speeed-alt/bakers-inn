// The accountant opens these files directly, so a stray comma or quote in a
// product name must not shift a column.
import test from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, dailySummaryCsv, monthRange, purchasesCsv, salesCsv, toCsv } from '../src/lib/csv.js'

test('only awkward values get quoted, and quotes inside are doubled', () => {
  assert.equal(csvCell('Milk Bread'), 'Milk Bread')
  assert.equal(csvCell(12), '12')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell('Cake, large'), '"Cake, large"')
  assert.equal(csvCell('6" Cake'), '"6"" Cake"')
  assert.equal(csvCell('two\nlines'), '"two\nlines"')
})

test('rows join with CRLF, which is what spreadsheets expect', () => {
  assert.equal(toCsv([['a', 'b'], ['c', 'd']]), 'a,b\r\nc,d')
})

test('a sale becomes one row per line, with money unformatted', () => {
  const csv = salesCsv([
    {
      ref: 'S-B2-0728-A001',
      businessDate: '2026-07-28',
      branchId: 'B2',
      cashierName: 'Bilal',
      payment: 'cash',
      status: 'normal',
      items: [
        { name: 'Milk Bread', price: 220, qty: 2 },
        { name: 'Cake, large', price: 1800, qty: 1 },
      ],
    },
  ])
  const rows = csv.split('\r\n')
  assert.equal(rows.length, 3, 'header plus two lines')
  // Payment, then its reference — empty for cash, a transaction id for a
  // wallet transfer.
  assert.match(rows[1], /^S-B2-0728-A001,2026-07-28,B2,Bilal,cash,,normal,Milk Bread,2,220,440$/)
  assert.equal(rows[0].split(',').length, rows[1].split(',').length, 'header matches the rows')
  assert.match(rows[2], /"Cake, large",1,1800,1800$/, 'a comma in a name does not shift columns')
})

test('a wallet payment exports the reference that proves it', () => {
  // "JazzCash Rs 5,000" with nothing beside it cannot be matched against the
  // account statement, which is the only reason the accountant wants the row.
  const csv = salesCsv([
    {
      ref: 'S-B2-0814-A004',
      businessDate: '2026-08-14',
      branchId: 'B2',
      cashierName: 'Bilal',
      payment: 'jazzcash',
      paymentRef: 'TID9931204',
      status: 'normal',
      items: [{ name: 'Bread Small', price: 120, qty: 5 }],
    },
  ])
  assert.match(csv, /,jazzcash,TID9931204,normal,/)
})

test('purchases export their lines with the cost that was paid', () => {
  const csv = purchasesCsv([
    {
      ref: 'P-20260728-AB12',
      businessDate: '2026-07-28',
      supplier: null,
      items: [{ materialName: 'Flour', unit: 'kg', qty: 50, unitCost: 180, lineTotal: 9000 }],
    },
  ])
  const rows = csv.split('\r\n')
  assert.match(rows[1], /^P-20260728-AB12,2026-07-28,,Flour,kg,50,180,9000$/)
})

test('the daily summary carries the figures the accountant asks about', () => {
  const csv = dailySummaryCsv([
    {
      businessDate: '2026-07-28', branchId: 'B2', salesTotal: 4520, cashTotal: 3140,
      cardTotal: 1380, txCount: 3, countedCash: 8140, overShort: 0,
      wasteQty: 4, wasteValue: 800, wastePct: 14, sellThroughPct: 71, reconciles: true,
    },
  ])
  const rows = csv.split('\r\n')
  assert.match(rows[1], /^2026-07-28,B2,4520,3140,1380,3,8140,0,4,800,14,71,yes$/)
})

test('a month range covers the whole month, leap years included', () => {
  assert.deepEqual(monthRange('2026-07-28'), { from: '2026-07-01', to: '2026-07-31' })
  assert.deepEqual(monthRange('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthRange('2028-02-10'), { from: '2028-02-01', to: '2028-02-29' })
})
