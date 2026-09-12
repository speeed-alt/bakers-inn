// The price list, checked for the mistakes a typed-up price list actually makes.
//
// None of this is clever. It is the set of things that are invisible in a table
// of sixty-eight names and cost real money at the counter: two products sharing
// an id, a weighed item priced as if it were counted, a tier whose names do not
// all carry the same price.

import test from 'node:test'
import assert from 'node:assert/strict'
import { CATALOGUE, TIERS, documentFor } from './catalogue.mjs'
import { PRODUCT_CATEGORIES } from '../src/config.js'
import { DEFAULT_WEIGHT_UNIT } from '../src/lib/quantity.js'
import { findChoices } from '../src/lib/search.js'
import { byCode } from '../src/lib/order.js'

// Shuffled on purpose. Firestore hands the catalogue over in document-id
// order, not in the order of the owner's sheet, and a fixture built in sheet
// order hides every ordering fault in the code under test — as it did: the till
// listed Cadbury Caramel above Chocolate Fudge under code 2 while this file was
// green.
const products = () => {
  const rows = CATALOGUE.map((row) => ({ id: row.id, ...documentFor(row) }))
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

test('every name on the sheet is its own product', () => {
  // The whole point of the split: stock is per item, so the item is the
  // product. 68 names, not 22 price tiers.
  assert.equal(CATALOGUE.length, TIERS.reduce((n, t) => n + t.names.length, 0))
  assert.equal(CATALOGUE.length, 68)
})

test('the codes are the serial numbers on the owner’s sheet, 1 to 22', () => {
  assert.deepEqual(
    [...new Set(CATALOGUE.map((row) => row.code))],
    Array.from({ length: 22 }, (_, i) => String(i + 1)),
  )
})

test('a code is shared by its tier, and every name in it costs the same', () => {
  // What makes typing unchanged: 2 still means "the cakes at 2,000".
  for (const tier of TIERS) {
    const rows = CATALOGUE.filter((row) => row.code === tier.code)
    assert.equal(rows.length, tier.names.length, `code ${tier.code}`)
    for (const row of rows) {
      assert.equal(row.price, tier.price, `${row.name} is not at its tier price`)
      assert.equal(row.category, tier.category, `${row.name} is in the wrong category`)
    }
  }
})

test('no two products share a document id', () => {
  // A collision does not fail — it silently overwrites, and one item of the
  // price list quietly becomes another. Names repeat across tiers on purpose,
  // so the id has to carry the tier: the Oreo cake and the Oreo bun are two
  // different things that share a word.
  const seen = new Set()
  for (const row of CATALOGUE) {
    assert.ok(!seen.has(row.id), `id ${row.id} is used twice`)
    seen.add(row.id)
  }
  assert.notEqual(
    CATALOGUE.find((r) => r.code === '3' && r.name === 'Oreo').id,
    CATALOGUE.find((r) => r.code === '14' && r.name === 'Oreo').id,
  )
})

test('no name is repeated inside one code', () => {
  for (const tier of TIERS) {
    assert.equal(new Set(tier.names).size, tier.names.length, `code ${tier.code} repeats a name`)
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

test('the biscuits are the only things weighed, and priced by the portion', () => {
  const weighed = CATALOGUE.filter((row) => row.weighed)
  assert.equal(weighed.length, 6)
  assert.ok(weighed.every((row) => row.code === '19'))
  // 350 a portion is the 1,400 a kilo the sheet says. Stored as 1,400 it would
  // charge a kilo price for a quarter kilo, on a slip that looks entirely
  // normal — which is exactly what the live catalogue was doing in August.
  assert.ok(weighed.every((row) => row.price === 350))
  assert.equal(documentFor(weighed[0]).unit, DEFAULT_WEIGHT_UNIT)
  // And they are the only thing that keeps overnight.
  assert.deepEqual([...new Set(CATALOGUE.filter((r) => r.keeps).map((r) => r.code))], ['19'])
})

test('a counted product carries no weight unit', () => {
  for (const row of CATALOGUE.filter((r) => !r.weighed)) {
    assert.equal(documentFor(row).unit, null, `${row.name} has a unit`)
  }
})

test('nothing carries a list of names underneath it any more', () => {
  // A leftover variant list would have the till offer a choice under a product
  // that is now a single item.
  for (const row of CATALOGUE) assert.deepEqual(documentFor(row).variants, [])
})

// ---------------------------------------------------------------------------
// It has to work at the counter exactly as the printed sheet says.

test('typing a code lists that tier’s items, in the order they are written', () => {
  const hits = findChoices(products(), '3')
  // The tier first, in the owner's order. "3Milk Cake" matches the digit by
  // name and follows behind, which is the ranking working, not a fault: a
  // memorised code must never be beaten by a name containing its digits.
  assert.deepEqual(hits.slice(0, 4).map((c) => c.name), ['Kit Kat', 'Ferrero', 'Oreo', 'Candy'])
  assert.ok(hits.slice(0, 4).every((c) => c.product.code === '3'))
  assert.equal(hits[4].name, '3Milk Cake')
  // Each one a product in its own right, which is what gives it its own stock.
  assert.equal(new Set(hits.slice(0, 4).map((c) => c.product.id)).size, 4)
})

test('the name the customer says still finds the item', () => {
  assert.equal(findChoices(products(), 'nut')[0].name, 'Nutella')
  assert.equal(findChoices(products(), 'khajoor')[0].product.code, '19')
})

test('an exact code beats a name that happens to contain the digits', () => {
  assert.equal(findChoices(products(), '1')[0].product.code, '1')
})

test('the full list reads in code order, and by the sheet within a code', () => {
  const sorted = [...products()].sort(byCode)
  assert.deepEqual(sorted.slice(0, 2).map((p) => p.name), ['3Milk Cake', 'Lotus'])
  assert.deepEqual(
    sorted.filter((p) => p.code === '2').map((p) => p.name),
    ['Chocolate Fudge', 'Cadbury Caramel', 'Nutella', 'Red Velvet'],
  )
  assert.equal(sorted.at(-1).name, 'Sweet Candy')
  // Codes never go backwards down the list.
  const codes = sorted.map((p) => Number(p.code))
  assert.deepEqual(codes, [...codes].sort((a, b) => a - b))
})

test('the two counter additions are numbered on from the sheet, not at 35 and 54', () => {
  assert.equal(CATALOGUE.find((r) => r.name === 'Soda').code, '21')
  assert.equal(CATALOGUE.find((r) => r.name === 'Sweet Candy').code, '22')
})
