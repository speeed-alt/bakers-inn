import test from 'node:test'
import assert from 'node:assert/strict'
import { inDrawer, labelOf, methodOf, referenceLabel, splitByMethod } from '../src/lib/payments.js'
import { summariseDay } from '../src/lib/report.js'

// One question decides everything downstream: is this money in the drawer
// tonight? Get it wrong and every till reads short by the day's transfers, and
// a cashier gets accused of it.

test('only cash is in the drawer', () => {
  assert.equal(inDrawer('cash'), true)
  assert.equal(inDrawer('card'), false)
  assert.equal(inDrawer('jazzcash'), false)
  assert.equal(inDrawer('easypaisa'), false)
  assert.equal(inDrawer('bank'), false)
})

test('a method this build has never heard of is not counted into the drawer', () => {
  // Sales are kept for good, so a method retired from config still turns up in
  // last year's records. Guessing "cash" would inflate an old expected-cash
  // figure; not-in-the-drawer is the safe side to be wrong on.
  assert.equal(inDrawer('sadapay'), false)
  assert.equal(inDrawer(undefined), false)
  assert.equal(methodOf('sadapay').label, 'sadapay')
})

test('methods are named, not shown as stored ids', () => {
  // "jazzcash" on a receipt looks like a fault in the till.
  assert.equal(labelOf('jazzcash'), 'JazzCash')
  assert.equal(labelOf('easypaisa'), 'Easypaisa')
  assert.equal(labelOf('bank'), 'Bank transfer')
})

test('the wallets and the bank ask for a reference; cash and card do not', () => {
  // A line reading "JazzCash Rs 5,000" with no transaction id cannot be
  // matched against the account statement, so it proves nothing.
  assert.equal(referenceLabel('jazzcash'), 'Transaction ID')
  assert.equal(referenceLabel('easypaisa'), 'Transaction ID')
  assert.equal(referenceLabel('bank'), 'Reference')
  assert.equal(referenceLabel('cash'), null)
  assert.equal(referenceLabel('card'), null)
})

// --- the day's split --------------------------------------------------------

const sale = (payment, total, over = {}) => ({ status: 'normal', payment, total, items: [], ...over })

test('a wallet payment is takings, and is not in the drawer', () => {
  // The whole point. Before this the code said `if cash … else card`, so a
  // JazzCash sale was filed as a card sale — the drawer figure happened to be
  // right and the owner's figures were fiction.
  const day = summariseDay([sale('cash', 1000), sale('jazzcash', 5000), sale('card', 800)])
  assert.equal(day.salesTotal, 6800)
  assert.equal(day.cashTotal, 1000, 'only cash is counted against the till')
  assert.equal(day.cardTotal, 800, 'card is card, not everything-that-is-not-cash')
  assert.equal(day.digitalTotal, 5800)
})

test('the expected drawer does not move when a customer pays by phone', () => {
  const cashOnly = summariseDay([sale('cash', 1000)])
  const withWallet = summariseDay([sale('cash', 1000), sale('easypaisa', 9000)])
  assert.equal(cashOnly.cashTotal, withWallet.cashTotal)
})

test('every method used gets a row, in the order they are offered', () => {
  const day = summariseDay([sale('bank', 300), sale('cash', 100), sale('jazzcash', 200)])
  assert.deepEqual(day.byMethod.map((m) => m.id), ['cash', 'jazzcash', 'bank'])
  assert.deepEqual(day.byMethod.map((m) => m.total), [100, 200, 300])
})

test('a method nobody used today is not listed', () => {
  // Five ways to pay with four of them at zero is four lines of nothing.
  const day = summariseDay([sale('cash', 100)])
  assert.deepEqual(day.byMethod.map((m) => m.id), ['cash'])
})

test('a method the build does not recognise is still shown, at the end', () => {
  // A figure with a strange name against it is a question worth asking. A
  // figure silently dropped is not.
  const day = summariseDay([sale('cash', 100), sale('sadapay', 700)])
  assert.deepEqual(day.byMethod.map((m) => m.id), ['cash', 'sadapay'])
  assert.equal(day.digitalTotal, 700)
})

test('a voided sale is in nobody’s column', () => {
  const day = summariseDay([sale('jazzcash', 5000, { status: 'voided' })])
  assert.deepEqual(day.byMethod, [])
  assert.equal(day.digitalTotal, 0)
})

test('a refund comes off the method it was refunded to', () => {
  const day = summariseDay([sale('jazzcash', 5000), sale('jazzcash', -1000, { status: 'refund' })])
  assert.equal(day.byMethod[0].total, 4000)
  assert.equal(day.digitalTotal, 4000)
})

test('splitByMethod counts transactions as well as money', () => {
  const rows = splitByMethod([sale('cash', 100), sale('cash', 250), sale('card', 400)])
  assert.equal(rows[0].count, 2)
  assert.equal(rows[0].total, 350)
  assert.equal(rows[1].count, 1)
})

test('a day with only wallet sales still expects an empty drawer', () => {
  // The float is all that should be in the till, and the close screen adds it.
  const day = summariseDay([sale('easypaisa', 4000), sale('bank', 6000)])
  assert.equal(day.cashTotal, 0)
  assert.equal(day.salesTotal, 10000)
})
