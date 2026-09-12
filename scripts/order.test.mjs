// Every list of items reads in the order of the code sheet.
//
// The owner asked for it after the order form listed Biscuits (19) above Buns
// (14) above Pastry (18): each screen sorted its own way, and the ones that did
// sort by code compared codes as text, which puts 10 ahead of 2.

import test from 'node:test'
import assert from 'node:assert/strict'
import { byCode } from '../src/lib/order.js'
import { CATALOGUE, documentFor } from './catalogue.mjs'
import { buildLeftovers } from '../src/lib/leftovers.js'
import { findChoices, findProducts } from '../src/lib/search.js'
import { dailyRateProducts } from '../src/lib/rates.js'

const codes = (list) => list.map((item) => item.code)

test('codes sort as numbers, not as text', () => {
  const items = ['10', '2', '1', '20', '3', '11'].map((code) => ({ code, name: `item ${code}` }))
  assert.deepEqual(codes([...items].sort(byCode)), ['1', '2', '3', '10', '11', '20'])
})

test('a zero-padded code sits with its number', () => {
  const items = ['10', '02', '1', '3'].map((code) => ({ code, name: code }))
  assert.deepEqual(codes([...items].sort(byCode)), ['1', '02', '3', '10'])
})

test('an item with no code goes to the end', () => {
  const items = [{ code: '', name: 'Loose' }, { code: '5', name: 'Five' }, { name: 'None' }, { code: '1', name: 'One' }]
  assert.deepEqual([...items].sort(byCode).map((i) => i.name), ['One', 'Five', 'Loose', 'None'])
})

test('ties fall back to the name, for products and for sheet lines alike', () => {
  const products = [{ code: '4', name: 'Coffee' }, { code: '4', name: 'Apple' }]
  assert.deepEqual([...products].sort(byCode).map((p) => p.name), ['Apple', 'Coffee'])
  const lines = [{ code: '4', productName: 'Zeta' }, { code: '4', productName: 'Beta' }]
  assert.deepEqual([...lines].sort(byCode).map((l) => l.productName), ['Beta', 'Zeta'])
})

test('something that is not a code at all does not break the sort', () => {
  const items = [{ code: 'B', name: 'b' }, { code: '2', name: 'two' }, { code: null, name: 'n' }, { code: 'A', name: 'a' }]
  assert.doesNotThrow(() => [...items].sort(byCode))
  assert.equal([...items].sort(byCode).at(-1).name, 'n')
})

test('the owner\'s price list comes out 1 to 22, however it arrives', () => {
  const shuffled = CATALOGUE.map((row) => ({ id: row.id, ...documentFor(row) })).reverse()
  const sorted = shuffled.sort(byCode)
  // Several items share a code now, so the list is longer than the sheet —
  // what matters is that it never goes backwards, and that it starts and ends
  // where the sheet does.
  assert.deepEqual([...new Set(codes(sorted))], Array.from({ length: 22 }, (_, i) => String(i + 1)))
  const numbers = sorted.map((p) => Number(p.code))
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b))
})

test('items sharing a code keep the order they are written on the sheet', () => {
  // Alphabetically this tier would read Cadbury Caramel, Chocolate Fudge,
  // Nutella, Red Velvet — which is not the order the counter reads.
  const tier = CATALOGUE.filter((row) => row.code === '2').map((row) => ({ id: row.id, ...documentFor(row) }))
  assert.deepEqual(
    [...tier].reverse().sort(byCode).map((p) => p.name),
    ['Chocolate Fudge', 'Cadbury Caramel', 'Nutella', 'Red Velvet'],
  )
})

test('the shelf, the close and the owner\'s report list lines in code order', () => {
  const products = [
    { id: 'a', code: '10', name: 'Simple & Fruit Cake' },
    { id: 'b', code: '2', name: 'Fudge & Velvet Cake' },
    { id: 'c', code: '19', name: 'Biscuits' },
  ]
  const lines = buildLeftovers({ products, received: { a: 1, b: 1, c: 1 } })
  assert.deepEqual(codes(lines), ['2', '10', '19'])
})

test('the till\'s full list starts at code 1', () => {
  const products = [
    { id: 'c', code: '19', name: 'Biscuits', category: 'Bakery' },
    { id: 'a', code: '2', name: 'Fudge & Velvet Cake', category: 'Cakes', variants: ['Nutella', 'Red Velvet'] },
    { id: 'b', code: '14', name: 'Buns & Oreo', category: 'Bakery' },
  ]
  assert.deepEqual(codes(findProducts(products, '')), ['2', '14', '19'])
  // And the names under one code keep the owner's order, not the alphabet's.
  assert.deepEqual(findChoices(products, '').map((c) => c.name), ['Nutella', 'Red Velvet', 'Buns & Oreo', 'Biscuits'])
})

test('the morning rate sheet lists its items in code order too', () => {
  const products = [
    { id: 'x', code: '12', name: 'Big Bread', dailyRate: true },
    { id: 'y', code: '3', name: 'Eggs', dailyRate: true },
  ]
  assert.deepEqual(codes(dailyRateProducts(products)), ['3', '12'])
})
