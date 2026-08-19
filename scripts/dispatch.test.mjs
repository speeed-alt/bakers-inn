// What a delivery note says after somebody has acted on it.
//
// The first test here is the one that matters: a tray of something nobody
// ordered went out as zero, every single time, from the day extras shipped.

import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchedItems, receivedItems } from '../src/lib/dispatch.js'

const note = () => [
  { productId: 'bread', productName: 'Bread', qtyDemanded: 40, qtySent: null, qtyReceived: null },
  { productId: 'rusk', productName: 'Rusk', qtyDemanded: 12, qtySent: null, qtyReceived: null },
]

// The compile writes drafts with qtySent null, so a note nobody adjusted must
// still go out as the outlet ordered.
test('an untouched note goes out as it was ordered', () => {
  const items = dispatchedItems(note(), { bread: 40, rusk: 12 })
  assert.deepEqual(items.map((i) => i.qtySent), [40, 12])
})

test('the dispatcher’s adjustment wins over what was ordered', () => {
  const items = dispatchedItems(note(), { bread: 33, rusk: 12 })
  assert.equal(items[0].qtySent, 33)
})

test('sending none of a line is not the same as not adjusting it', () => {
  // `0 ?? x` is 0, and it has to stay 0: a dispatcher who deliberately sends
  // nothing of a line must not have the full order restored behind them.
  const items = dispatchedItems(note(), { bread: 0, rusk: 12 })
  assert.equal(items[0].qtySent, 0)
})

test('an extra keeps the quantity it was given', () => {
  // The one that was broken. An extra is added to the note as a line with
  // qtyDemanded 0 and its quantity already on it, and it can never appear in
  // `sent` — `sent` is seeded from the note's own lines, and the picker only
  // ever offers extras that are not among them. Falling straight through to
  // qtyDemanded resolved every extra to zero while the button said "1 extra".
  const withExtra = [
    ...note(),
    { productId: 'donut', productName: 'Donut', qtyDemanded: 0, qtySent: 20, extra: true },
  ]
  const items = dispatchedItems(withExtra, { bread: 40, rusk: 12 })
  assert.equal(items[2].qtySent, 20, 'twenty donuts left in the van and the note said none')
  assert.equal(items[2].qtyDemanded, 0, 'nobody ordered them, and that stays true')
})

test('a line with nothing to go on sends nothing rather than undefined', () => {
  const items = dispatchedItems([{ productId: 'ghost', productName: 'Ghost' }], {})
  assert.equal(items[0].qtySent, 0)
})

// --- counting it in at the far end ------------------------------------------

test('a delivery that all arrived needs no reason and keeps both figures', () => {
  const sentOut = dispatchedItems(note(), { bread: 40, rusk: 12 })
  const items = receivedItems(sentOut, {})
  assert.deepEqual(items.map((i) => i.qtyReceived), [40, 12])
  assert.equal(items[0].shortReason, undefined)
})

test('a short line keeps what was sent as well as what arrived', () => {
  const sentOut = dispatchedItems(note(), { bread: 40, rusk: 12 })
  const items = receivedItems(sentOut, { bread: 36 }, { bread: 'Damaged in transit' })
  assert.equal(items[0].qtySent, 40, 'what the hub says it sent is never overwritten')
  assert.equal(items[0].qtyReceived, 36)
  assert.equal(items[0].shortReason, 'Damaged in transit')
})

test('a line that does not match gets a reason even if nobody picked one', () => {
  const sentOut = dispatchedItems(note(), { bread: 40, rusk: 12 })
  const items = receivedItems(sentOut, { rusk: 10 }, {})
  assert.equal(items[1].shortReason, 'Other')
})

test('an extra can be counted in at the quantity it was actually sent', () => {
  // Downstream of the fix above: because the note now records 20, the shop
  // taps once and the donuts land as 20 received, with no reason demanded and
  // no invented miscount against the shop's name.
  const withExtra = [
    ...note(),
    { productId: 'donut', productName: 'Donut', qtyDemanded: 0, qtySent: 20, extra: true },
  ]
  const sentOut = dispatchedItems(withExtra, { bread: 40, rusk: 12 })
  const items = receivedItems(sentOut, {})
  assert.equal(items[2].qtyReceived, 20)
  assert.equal(items[2].shortReason, undefined)
})
