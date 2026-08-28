// The price list, checked for the mistakes a typed-up price list actually makes.
//
// None of this is clever. It is the set of things that are invisible in a table
// of sixty names and cost real money at the counter: two rows claiming the same
// code, a weighed item priced as if it were counted, the same biscuit written
// down twice at two different prices.

import test from 'node:test'
import assert from 'node:assert/strict'
import { CATALOGUE, documentFor } from './catalogue.mjs'
import { PRODUCT_CATEGORIES } from '../src/config.js'
import { DEFAULT_WEIGHT_UNIT } from '../src/lib/quantity.js'
import { exactCodeMatch, findProducts } from '../src/lib/search.js'
import { lineNameFor, variantsOf } from '../src/lib/grouping.js'

test('the codes are the serial numbers on the owner’s sheet, 1 to 20', () => {
  // The whole point of the exercise: the printed sheet on the counter and the
  // till agree, with no translation in anybody's head.
  assert.deepEqual(
    CATALOGUE.map((row) => row.code),
    Array.from({ length: 20 }, (_, i) => String(i + 1)),
  )
})

test('no two products answer to the same code', () => {
  const seen = new Set()
  for (const row of CATALOGUE) {
    assert.ok(!seen.has(row.code), `code ${row.code} is used twice`)
    seen.add(row.code)
  }
})

test('no two products share a document id', () => {
  // A collision here does not fail — it silently overwrites, and one tier of
  // the price list quietly becomes another.
  const seen = new Set()
  for (const row of CATALOGUE) {
    assert.ok(!seen.has(row.id), `id ${row.id} is used twice`)
    seen.add(row.id)
  }
})

test('every price is a whole number of rupees above zero', () => {
  for (const row of CATALOGUE) {
    assert.ok(Number.isInteger(row.price), `${row.name} has a fractional price`)
    assert.ok(row.price > 0, `${row.name} is free`)
  }
})

test('every category is one the app knows', () => {
  for (const row of CATALOGUE) {
    assert.ok(PRODUCT_CATEGORIES.includes(row.category), `${row.name}: ${row.category}`)
  }
})

test('the biscuits are the only thing weighed, and priced by the portion', () => {
  const weighed = CATALOGUE.filter((row) => row.weighed)
  assert.equal(weighed.length, 1)
  assert.equal(weighed[0].id, 'biscuits')
  // 350 a portion is the 1,400 a kilo the sheet says. Stored as 1,400 it would
  // charge a kilo price for a quarter kilo, on a slip that looks entirely
  // normal — which is exactly what the live catalogue was doing.
  assert.equal(weighed[0].price, 350)
  assert.equal(documentFor(weighed[0]).unit, DEFAULT_WEIGHT_UNIT)
})

test('a counted product carries no weight unit', () => {
  for (const row of CATALOGUE.filter((r) => !r.weighed)) {
    assert.equal(documentFor(row).unit, null, `${row.name} has a unit`)
  }
})

test('no name is repeated inside its own group', () => {
  for (const row of CATALOGUE) {
    assert.equal(
      new Set(row.variants).size,
      row.variants.length,
      `${row.name} lists the same variant twice`,
    )
  }
})

test('a lone item gets no variant picker', () => {
  // A picker with one choice is a keystroke that asks a question with one
  // answer. `documentFor` drops it rather than the caller having to remember.
  const samosa = CATALOGUE.find((row) => row.id === 'savoury-50')
  assert.deepEqual(documentFor(samosa).variants, [])
  const cakes = CATALOGUE.find((row) => row.id === 'cakes-2200')
  assert.deepEqual(documentFor(cakes).variants, ['3Milk Cake', 'Lotus'])
})

test('the names that appear under more than one code are only the intended ones', () => {
  // This is the test that matters. The owner's sheet listed the six loose
  // biscuit names twice — once on row 5 at 1,400 and again on row 19 at 1,400 —
  // and the two mean completely different things: 1,400 for one cookie, or
  // 1,400 for a kilo of them. Written into the catalogue as printed, the shop
  // would have had two codes for one biscuit and no way to see it from the till.
  //
  // Four names genuinely do belong to more than one tier, because an Oreo cake
  // at 1,800 and an Oreo bun at 200 are different things that share a word.
  // Listing them here is what lets the check be strict about everything else.
  const seen = new Map()
  for (const row of CATALOGUE) {
    for (const variant of row.variants) {
      seen.set(variant, [...(seen.get(variant) ?? []), row.code])
    }
  }
  const shared = [...seen.entries()]
    .filter(([, codes]) => codes.length > 1)
    .map(([name, codes]) => `${name}: ${codes.join(',')}`)
    .sort()

  assert.deepEqual(shared, [
    'Candy: 3,13,19',
    'Lotus: 1,11',
    'Oreo: 3,14',
    'Red Velvet: 2,13',
  ])
})

test('a merged product still has a name of its own for the stock sheet', () => {
  // The baking list and the closing count read this, not the variants. An empty
  // one leaves a blank row on a sheet somebody has to fill in by hand.
  for (const row of CATALOGUE) {
    assert.ok(row.name.trim().length > 0, `${row.code} has no name`)
  }
})

// ---------------------------------------------------------------------------
// The serial numbers have to work as till codes, not just as row labels.

test('typing a serial number finds that tier and nothing else', () => {
  const products = CATALOGUE.map((row) => ({ id: row.id, ...documentFor(row) }))

  // The worry with unpadded codes: does `1` pull in 12 through 19? It cannot,
  // because the entry box commits on Enter and an exact code outranks every
  // other kind of match — but that is worth pinning down rather than assuming.
  assert.equal(exactCodeMatch(products, '1').name, 'Premium Cake')
  assert.equal(exactCodeMatch(products, '12').name, 'Big Bread & Tikka Sandwich')
  assert.equal(exactCodeMatch(products, '19').name, 'Biscuits')
  assert.equal(exactCodeMatch(products, '21'), null)

  // And the exact match is first in the list the cashier sees, ahead of the
  // eight other codes that begin with a 1.
  assert.equal(findProducts(products, '1')[0].name, 'Premium Cake')
})

test('every tier with more than one name offers the cashier a choice', () => {
  // The whole bargain of merging: one code to type, then which cake. If this
  // list came back empty the receipt would say "Fudge & Velvet Cake" instead of
  // Nutella, and the merge would have cost the shop its product names.
  for (const row of CATALOGUE) {
    const picks = variantsOf({ ...documentFor(row) })
    assert.equal(picks.length, row.variants.length > 1 ? row.variants.length : 0, row.name)
  }
  assert.deepEqual(variantsOf(documentFor(CATALOGUE[1])), [
    'Chocolate Fudge', 'Cadbury Caramel', 'Nutella', 'Red Velvet',
  ])
})

test('the name that reaches the receipt is the one the customer asked for', () => {
  const cake = documentFor(CATALOGUE[1])
  assert.equal(lineNameFor(cake, 'Nutella'), 'Nutella')
  // Nothing picked — a single-name product — falls back to the product itself.
  assert.equal(lineNameFor(documentFor(CATALOGUE[19]), null), 'Chicken Samosa')
})
