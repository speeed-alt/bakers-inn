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
