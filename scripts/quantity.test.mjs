import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WEIGHT_UNIT,
  formatQuantity,
  isWeighed,
  parseQuantity,
  roundQuantity,
  stepFor,
  unitOf,
  weightOf,
} from '../src/lib/quantity.js'
import { basketTotal, lineTotal } from '../src/lib/money.js'

const loaf = { id: 'bread-large', name: 'Bread Large', price: 220 }
// Sold in 250 g portions at 350 a portion — the 1,400 a kilo the shelf says.
const biscuits = { id: 'biscuits', name: 'Biscuits', price: 350, soldByWeight: true }

test('counted and weighed items are told apart', () => {
  assert.equal(isWeighed(loaf), false)
  assert.equal(isWeighed(biscuits), true)
  assert.equal(unitOf(loaf), null)
  assert.equal(unitOf(biscuits), DEFAULT_WEIGHT_UNIT)
  assert.equal(DEFAULT_WEIGHT_UNIT, '250 g')
})

test('every arrow is worth one thing, weighed or counted', () => {
  // The old step was a quarter for weighed lines, which meant every screen that
  // did not know a product was weighed counted it in whole kilos while the till
  // counted it in quarters. One step, one answer, nothing to get wrong.
  assert.equal(stepFor(loaf), 1)
  assert.equal(stepFor(biscuits), 1)
})

test('four is a kilo', () => {
  assert.equal(lineTotal({ price: 350, qty: 4 }), 1400)
  assert.equal(weightOf(4, biscuits), '1 kg')
  assert.equal(weightOf(1, biscuits), '250 g')
  assert.equal(weightOf(2, biscuits), '500 g')
  assert.equal(weightOf(6, biscuits), '1.5 kg')
  assert.equal(weightOf(0, biscuits), '0 250 g')
})

test('a bare number is a count of portions', () => {
  assert.equal(parseQuantity('4', biscuits), 4)
  assert.equal(parseQuantity('1', biscuits), 1)
  // Not a fraction of anything: the scales cannot make half a portion.
  assert.equal(parseQuantity('1.5', biscuits), 2)
})

test('a weight can still be typed the way it is spoken', () => {
  // A cashier told "give me a kilo" should not have to work out that it is four
  // while a queue waits — that arithmetic is where mistakes come from.
  assert.equal(parseQuantity('1kg', biscuits), 4)
  assert.equal(parseQuantity('1 KG', biscuits), 4)
  assert.equal(parseQuantity('1 kilo', biscuits), 4)
  assert.equal(parseQuantity('1.5kg', biscuits), 6)
  assert.equal(parseQuantity('500g', biscuits), 2)
  assert.equal(parseQuantity('750 grams', biscuits), 3)
})

test('a weight that is not whole portions goes to the nearest one', () => {
  // Selling in portions means selling in portions. 300 g is not a thing the
  // scales can produce, so it becomes one portion rather than a quantity that
  // could never be weighed out.
  assert.equal(parseQuantity('300g', biscuits), 1)
  assert.equal(parseQuantity('400g', biscuits), 2)
  assert.equal(parseQuantity('875g', biscuits), 4)
})

test('a counted item is always a whole number, whatever is typed', () => {
  assert.equal(parseQuantity('3', loaf), 3)
  assert.equal(parseQuantity('3.7', loaf), 4)
})

test('a weight on a counted product is a typo, not a unit', () => {
  assert.equal(parseQuantity('2kg', loaf), null)
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

test('quantities are whole numbers on every screen', () => {
  assert.equal(formatQuantity(4), '4')
  assert.equal(formatQuantity(3), '3')
  assert.equal(formatQuantity(2.4), '2')
  assert.equal(formatQuantity(undefined), '0')
})

test('a quantity cannot drift into a fraction', () => {
  assert.equal(roundQuantity(4.0000001), 4)
  assert.equal(roundQuantity(2.9), 3)
})

test('every line comes to a whole number of rupees, with nothing to round', () => {
  // The point of the portion price: four of them is exactly the kilo price, so
  // a kilo can never come to 1,399 because of a division.
  assert.equal(lineTotal({ price: 350, qty: 4 }), 1400)
  assert.equal(lineTotal({ price: 350, qty: 18 }), 6300)
  assert.equal(lineTotal({ price: 220, qty: 3 }), 660)
  assert.equal(lineTotal({ price: 0, qty: 9 }), 0)
})

test('a basket adds up the printed lines', () => {
  assert.equal(basketTotal([{ price: 350, qty: 4 }, { price: 220, qty: 3 }]), 2060)
})

test('a missing price or quantity is nothing, not NaN', () => {
  assert.equal(lineTotal({}), 0)
  assert.equal(lineTotal({ price: 220 }), 0)
})
