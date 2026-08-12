import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupKey,
  lineNameFor,
  mergeSuggestions,
  planMerge,
  variantsOf,
} from '../src/lib/grouping.js'

const cakes = [
  { id: 'vip-cake', code: '14', name: 'VIP Cake', category: 'Cakes', price: 2000 },
  { id: 'lotus-cake', code: '18', name: 'Lotus Cake', category: 'Cakes', price: 2000 },
  { id: 'special-cake', code: '15', name: 'Special Cake', category: 'Cakes', price: 2000 },
]

const others = [
  { id: 'reg-pastry', code: '20', name: 'Reg. Pastry', category: 'Cakes', price: 100 },
  { id: 'samosi', code: '28', name: 'Samosi', category: 'Savoury', price: 100 },
  { id: 'bread-large', code: '02', name: 'Bread Large', category: 'Bread', price: 220 },
]

test('two things group only when the category and the price both match', () => {
  assert.equal(groupKey(cakes[0]), groupKey(cakes[1]))
  // Same price, different category — a pastry and a samosa are not one item.
  assert.notEqual(groupKey(others[0]), groupKey(others[1]))
})

test('a group needs more than one member to be worth making', () => {
  const groups = mergeSuggestions([...cakes, ...others])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].category, 'Cakes')
  assert.equal(groups[0].price, 2000)
  assert.equal(groups[0].members.length, 3)
})

test('the lowest code survives, being the one staff have read longest', () => {
  const [group] = mergeSuggestions(cakes)
  assert.equal(group.keepCode, '14')
  assert.deepEqual(group.variants, ['VIP Cake', 'Special Cake', 'Lotus Cake'])
})

test('archived products are left out', () => {
  const groups = mergeSuggestions([...cakes, { ...cakes[0], id: 'old', active: false }])
  assert.equal(groups[0].members.length, 3)
})

test('weighed items are never merged into a counted one', () => {
  // A price per kilo and a price each are not the same kind of number.
  const weighed = { id: 'biscuits', code: '35', name: 'Biscuits', category: 'Bakery', price: 2000, soldByWeight: true }
  const other = { id: 'box', code: '04', name: 'Biscuit Box', category: 'Bakery', price: 2000 }
  assert.deepEqual(mergeSuggestions([weighed, other]), [])
})

test('a merge keeps one product and archives the rest', () => {
  const [group] = mergeSuggestions(cakes)
  const plan = planMerge(group, { name: 'Cake — 2,000' })

  assert.equal(plan.keep.id, 'vip-cake')
  assert.equal(plan.keep.code, '14')
  assert.equal(plan.keep.name, 'Cake — 2,000')
  assert.deepEqual(plan.keep.variants, ['VIP Cake', 'Special Cake', 'Lotus Cake'])
  assert.deepEqual(plan.archive.map((a) => a.id), ['special-cake', 'lotus-cake'])
})

test('if any of them keeps overnight, the merged one keeps', () => {
  // Getting this wrong the other way would bin stock that was fine.
  const [group] = mergeSuggestions([
    { ...cakes[0], sellsNextDay: false },
    { ...cakes[1], sellsNextDay: true },
  ])
  assert.equal(planMerge(group).keep.sellsNextDay, true)
})

test('a group of one cannot be merged', () => {
  assert.equal(planMerge({ members: [cakes[0]] }), null)
  assert.equal(planMerge(null), null)
})

test('a product with one name or none has nothing to pick between', () => {
  assert.deepEqual(variantsOf({ variants: ['Only one'] }), [])
  assert.deepEqual(variantsOf({}), [])
  assert.deepEqual(variantsOf({ variants: ['A', 'B'] }), ['A', 'B'])
})

test('the bill shows the variant the customer asked for, not the group', () => {
  const merged = { name: 'Cake — 2,000', variants: ['VIP Cake', 'Lotus Cake'] }
  assert.equal(lineNameFor(merged, 'Lotus Cake'), 'Lotus Cake')
  // Nothing chosen falls back to the product's own name.
  assert.equal(lineNameFor(merged, null), 'Cake — 2,000')
})
