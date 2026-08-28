// The till's entry box decides what gets rung up, so its ranking is tested.
import test from 'node:test'
import assert from 'node:assert/strict'
import { exactCodeMatch, findProducts } from '../src/lib/search.js'

const CATALOG = [
  { id: 'a', code: '101', name: 'Milk Bread', category: 'Bread', price: 220 },
  { id: 'b', code: '102', name: 'Bran Bread', category: 'Bread', price: 260 },
  { id: 'c', code: '201', name: 'Cake Rusk (500g)', category: 'Bakery', price: 480 },
  { id: 'd', code: '401', name: 'Chicken Patty', category: 'Savoury', price: 180 },
  { id: 'e', code: '402', name: 'Chicken Roll', category: 'Savoury', price: 200 },
  { id: 'f', code: '101B', name: 'Bread Crumbs 101', category: 'Bakery', price: 150 },
]

const names = (list) => list.map((p) => p.name)

test('an empty box lists the whole catalog', () => {
  assert.equal(findProducts(CATALOG, '').length, CATALOG.length)
  assert.equal(findProducts(CATALOG, '   ').length, CATALOG.length)
})

test('an exact code wins over a name that merely contains those digits', () => {
  assert.equal(findProducts(CATALOG, '101')[0].name, 'Milk Bread')
  assert.equal(exactCodeMatch(CATALOG, '101').id, 'a')
})

test('a partial code narrows to that group', () => {
  assert.deepEqual(names(findProducts(CATALOG, '40')), ['Chicken Patty', 'Chicken Roll'])
})

test('typing a name matches, and a leading word beats a mid-string hit', () => {
  const hits = names(findProducts(CATALOG, 'bread'))
  assert.equal(hits[0], 'Bread Crumbs 101', 'starts-with should rank first')
  assert.ok(hits.includes('Milk Bread') && hits.includes('Bran Bread'))
})

test('matching is case-insensitive and ignores stray spaces', () => {
  assert.equal(findProducts(CATALOG, '  CHICKEN  ').length, 2)
  assert.equal(findProducts(CATALOG, 'MiLk')[0].name, 'Milk Bread')
})

test('nothing matches an unknown code, and no exact match is invented', () => {
  assert.deepEqual(findProducts(CATALOG, '999'), [])
  assert.equal(exactCodeMatch(CATALOG, '999'), null)
  assert.equal(exactCodeMatch(CATALOG, ''), null)
})

test('products with no code still match by name and never claim an exact code', () => {
  const noCode = [{ id: 'x', name: 'Loose Item', category: 'Other', price: 50 }]
  assert.equal(findProducts(noCode, 'loose').length, 1)
  assert.equal(exactCodeMatch(noCode, ''), null)
})

// ---------------------------------------------------------------------------
// Choices — a product plus which of its names.
//
// Once the shop prices in tiers, "the thing the cashier is looking for" and
// "the product" stop being the same object. Four cakes at 1,800 are one
// product and four things a customer can ask for.

import { choicesOf, findChoices } from '../src/lib/search.js'

const tiered = [
  { id: 'cakes-1800', code: '3', name: 'Kit Kat & Oreo Cake', category: 'Cakes', price: 1800,
    variants: ['Kit Kat', 'Ferrero', 'Oreo', 'Candy'] },
  { id: 'cakes-2000', code: '2', name: 'Fudge & Velvet Cake', category: 'Cakes', price: 2000,
    variants: ['Chocolate Fudge', 'Cadbury Caramel', 'Nutella', 'Red Velvet'] },
  { id: 'savoury-50', code: '20', name: 'Chicken Samosa', category: 'Savoury', price: 50, variants: [] },
]

test('a product with no variants is one choice, itself', () => {
  const [only, ...rest] = choicesOf(tiered[2])
  assert.equal(rest.length, 0)
  assert.equal(only.name, 'Chicken Samosa')
  assert.equal(only.variant, null)
})

test('a tier is one choice per name', () => {
  const choices = choicesOf(tiered[0])
  assert.deepEqual(choices.map((c) => c.name), ['Kit Kat', 'Ferrero', 'Oreo', 'Candy'])
  // Same product underneath: one stock line, one code, one row on the baking
  // list. Only the name on the slip differs.
  assert.ok(choices.every((c) => c.product.id === 'cakes-1800'))
})

test('the name the customer says is the name that can be typed', () => {
  // The regression this exists for. After merging, "Nutella" is not a product
  // name any more — it is a variant of "Fudge & Velvet Cake" — so a cashier
  // typing what the customer actually said found nothing at all.
  const hits = findChoices(tiered, 'nut')
  assert.equal(hits[0].name, 'Nutella')
  assert.equal(hits[0].product.code, '2')
})

test('typing the code lists that tier’s names in the owner’s order', () => {
  // His sheet says Kit Kat, Ferrero, Oreo, Candy. Alphabetical would be tidier
  // and slower to read, because the eye already knows the printed order.
  const hits = findChoices(tiered, '3')
  assert.deepEqual(hits.map((c) => c.name), ['Kit Kat', 'Ferrero', 'Oreo', 'Candy'])
})

test('an exact code still beats a name that happens to contain it', () => {
  const withDecoy = [...tiered, { id: 'x', code: '77', name: 'Cake number 3', price: 100, variants: [] }]
  assert.equal(findChoices(withDecoy, '3')[0].product.code, '3')
})

test('the group is searchable too, for whoever thinks in tiers', () => {
  const hits = findChoices(tiered, 'fudge')
  // "Chocolate Fudge" is a name; "Fudge & Velvet Cake" is the tier. Both find
  // the same rows, which is the point — two people describing one cake.
  assert.ok(hits.length > 0)
  assert.ok(hits.every((c) => c.product.code === '2'))
})

test('an empty box lists every name, not every product', () => {
  const all = findChoices(tiered, '')
  assert.equal(all.length, 9) // 4 + 4 + 1
  // Category first, so the panel reads as a menu rather than a jumble.
  assert.equal(all.at(-1).name, 'Chicken Samosa')
})

test('a missing or empty catalogue is empty, not a crash', () => {
  assert.deepEqual(findChoices([], 'x'), [])
  assert.deepEqual(findChoices(undefined, 'x'), [])
})

test('one variant is not a choice worth offering', () => {
  // A picker with a single option is a question with one answer. The product's
  // own name is what goes on the slip.
  const lone = { id: 'z', code: '9', name: 'Lone Cake', price: 100, variants: ['Lone Cake'] }
  assert.deepEqual(choicesOf(lone).map((c) => c.name), ['Lone Cake'])
  assert.equal(choicesOf(lone)[0].variant, null)
})
