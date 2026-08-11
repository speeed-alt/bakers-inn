import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatQuantity,
  isWeighed,
  parseQuantity,
  roundQuantity,
  stepFor,
  unitOf,
} from '../src/lib/quantity.js'
import { basketTotal, lineTotal } from '../src/lib/money.js'

const loaf = { id: 'bread-large', name: 'Bread Large', price: 220 }
const biscuits = { id: 'biscuits', name: 'Biscuits', price: 1400, soldByWeight: true }

test('counted and weighed items are told apart', () => {
  assert.equal(isWeighed(loaf), false)
  assert.equal(isWeighed(biscuits), true)
  assert.equal(unitOf(loaf), null)
  assert.equal(unitOf(biscuits), 'kg')
})

test('the arrows nudge a weight by a quarter, and a count by one', () => {
  assert.equal(stepFor(loaf), 1)
  assert.equal(stepFor(biscuits), 0.25)
})

test('a weight can be typed the way it is spoken', () => {
  assert.equal(parseQuantity('4.5', biscuits), 4.5)
  assert.equal(parseQuantity('4.5kg', biscuits), 4.5)
  assert.equal(parseQuantity('4.5 KG', biscuits), 4.5)
  assert.equal(parseQuantity('1 kilo', biscuits), 1)
})

test('grams are converted, so nobody does the division at the counter', () => {
  assert.equal(parseQuantity('450g', biscuits), 0.45)
  assert.equal(parseQuantity('300 grams', biscuits), 0.3)
})

test('a counted item is always a whole number, whatever is typed', () => {
  assert.equal(parseQuantity('3', loaf), 3)
  assert.equal(parseQuantity('3.7', loaf), 4)
})

test('an unreadable quantity returns null rather than zeroing the line', () => {
  assert.equal(parseQuantity('', biscuits), null)
  assert.equal(parseQuantity('abc', biscuits), null)
  assert.equal(parseQuantity('-2', biscuits), null)
  assert.equal(parseQuantity(null, biscuits), null)
})

test('an unrecognised unit is refused rather than guessed at', () => {
  // 'lb' is a typo here, not a unit this shop uses. Guessing would charge for
  // the wrong amount of biscuits.
  assert.equal(parseQuantity('4lb', biscuits), null)
})

test('quantities read the way they were asked for', () => {
  assert.equal(formatQuantity(4.5, biscuits), '4.5 kg')
  assert.equal(formatQuantity(4, biscuits), '4 kg')
  assert.equal(formatQuantity(0.45, biscuits), '0.45 kg')
  assert.equal(formatQuantity(3, loaf), '3')
})

test('weights are stored to the gram so two tills cannot drift apart', () => {
  assert.equal(roundQuantity(0.4500001, biscuits), 0.45)
  assert.equal(roundQuantity(2.9, loaf), 3)
})

test('a weighed line comes to a whole number of rupees', () => {
  // 4.55 kg at 1399 is 6365.45 — a fractional rupee has nowhere to live.
  assert.equal(lineTotal({ price: 1399, qty: 4.55 }), 6365)
  assert.equal(lineTotal({ price: 1400, qty: 4.5 }), 6300)
})

test('a counted line is unchanged by the rounding', () => {
  assert.equal(lineTotal({ price: 220, qty: 3 }), 660)
  assert.equal(lineTotal({ price: 0, qty: 9 }), 0)
})

test('a basket adds up the rounded lines, not the raw ones', () => {
  // Each line is what the customer sees on the slip, so the total has to be the
  // sum of those printed numbers rather than a separately rounded figure.
  const lines = [
    { price: 1399, qty: 4.55 }, // 6365.45 -> 6365
    { price: 1399, qty: 4.55 }, // 6365.45 -> 6365
  ]
  assert.equal(basketTotal(lines), 12730)
})

test('a missing price or quantity is nothing, not NaN', () => {
  assert.equal(lineTotal({}), 0)
  assert.equal(lineTotal({ price: 220 }), 0)
})
