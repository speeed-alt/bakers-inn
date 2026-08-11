import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dailyRateProducts,
  priceOf,
  rateChanges,
  ratesNotSet,
  ratesOf,
} from '../src/lib/rates.js'

const bread = { id: 'bread-large', name: 'Bread Large', price: 220, dailyRate: true }
const eggs = { id: 'eggs', name: 'Eggs', price: 350, dailyRate: true }
const cake = { id: 'vip-cake', name: 'VIP Cake', price: 1800 }

test('a fixed-price item ignores the rate sheet entirely', () => {
  assert.equal(priceOf(cake, { 'vip-cake': 99 }), 1800)
})

test("a daily-rate item takes this morning's rate", () => {
  assert.equal(priceOf(bread, { 'bread-large': 240 }), 240)
})

test('with no rate set today it falls back to the last one, so the till keeps selling', () => {
  assert.equal(priceOf(bread, {}), 220)
})

test('a rate of zero is a real answer and is not treated as missing', () => {
  // A giveaway is a decision somebody made. `??` would have kept it too, but
  // only because 0 is not nullish — the point is that a *missing* rate must
  // still fall through, and both cases have to work.
  assert.equal(priceOf(bread, { 'bread-large': 0 }), 0)
  assert.equal(priceOf(bread, { 'bread-large': undefined }), 220)
  assert.equal(priceOf(bread, { 'bread-large': null }), 220)
})

test('a product with nothing at all is worth nothing, not NaN', () => {
  assert.equal(priceOf(null), 0)
  assert.equal(priceOf({ id: 'x', dailyRate: true }, {}), 0)
})

test('rates come out of the day document, or empty when there is none', () => {
  assert.deepEqual(ratesOf({ prices: { eggs: 380 } }), { eggs: 380 })
  assert.deepEqual(ratesOf(null), {})
  assert.deepEqual(ratesOf({}), {})
})

test('only flagged, active items are priced each morning', () => {
  const archived = { id: 'old', name: 'Old', dailyRate: true, active: false }
  const list = dailyRateProducts([cake, bread, eggs, archived])
  assert.deepEqual(list.map((p) => p.id), ['bread-large', 'eggs'])
})

test('the ones nobody has priced today are named', () => {
  const missing = ratesNotSet([bread, eggs, cake], { 'bread-large': 240 })
  assert.deepEqual(missing.map((p) => p.id), ['eggs'])
})

test('everything priced means nothing to chase', () => {
  assert.deepEqual(ratesNotSet([bread, eggs], { 'bread-large': 240, eggs: 380 }), [])
})

test('changes name what moved, and stay quiet about what did not', () => {
  const changes = rateChanges(
    [bread, eggs, cake],
    { 'bread-large': 220, eggs: 350 },
    { 'bread-large': 240, eggs: 350 },
  )
  assert.deepEqual(changes, [
    { productId: 'bread-large', name: 'Bread Large', was: 220, now: 240 },
  ])
})

test('a rate set for the first time reports no previous figure rather than zero', () => {
  const changes = rateChanges([eggs], {}, { eggs: 380 })
  assert.deepEqual(changes, [{ productId: 'eggs', name: 'Eggs', was: null, now: 380 }])
})
