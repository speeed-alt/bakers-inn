import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const {
  customLine,
  customProductId,
  isCustomItem,
  knownCustomNames,
  lastCustomPrice,
  partitionCustom,
  rememberCustomPrice,
  validCustom,
} = await import('../src/lib/custom.js')
const { summariseDay } = await import('../src/lib/report.js')
const { buildDailyReport } = await import('../src/lib/dailyReport.js')
const { soldOut } = await import('../src/lib/suggest.js')
const { findProducts } = await import('../src/lib/search.js')

// --- naming a one-off ------------------------------------------------------

test('the same thing typed twice lands on the same row', () => {
  // The owner's list of what is being sold off-catalogue is the whole point:
  // a thing rung forty times a month should stop being a one-off. Scattering
  // it across forty rows would hide exactly that.
  assert.equal(customProductId('Coke'), customProductId('coke'))
  assert.equal(customProductId(' Coke '), customProductId('Coke'))
  assert.equal(customProductId('Coke'), 'custom:coke')
})

test('two different one-offs do not collapse into one nameless row', () => {
  // What a null productId would have done.
  assert.notEqual(customProductId('Coke'), customProductId('Crisps'))
})

test('a name of nothing but punctuation still gets a usable id', () => {
  assert.equal(customProductId('???'), 'custom:item')
  assert.equal(customProductId(''), 'custom:item')
  assert.equal(customProductId(null), 'custom:item')
})

test('a one-off is recognisable from the flag or from the id alone', () => {
  // The flag is what new sales carry; the id is the fallback for anything
  // written before the flag existed, or read back from a report.
  assert.equal(isCustomItem({ custom: true, productId: 'anything' }), true)
  assert.equal(isCustomItem({ productId: 'custom:coke' }), true)
  assert.equal(isCustomItem({ productId: 'bread-small' }), false)
  assert.equal(isCustomItem({}), false)
  assert.equal(isCustomItem(null), false)
})

// --- offering the one-off at all -------------------------------------------

test('typing something the shop does not sell offers the one-off, before Enter', () => {
  // The bug this covers: the offer was stored in state that only the Enter
  // handler ever set, so the till knew nothing matched by the third letter and
  // said so only if asked. A cashier with a customer holding a bottle of Coke
  // saw "Nothing matches" and no way forward, which is the moment they take the
  // money by hand and the drawer reads over at close.
  //
  // The till computes it as `typed && results.length === 0`, so this asserts
  // the half that can actually be wrong: the search finding nothing.
  const catalogue = [
    { id: 'bread-small', code: '01', name: 'Bread Small', price: 120 },
    { id: 'rusk', code: '05', name: 'Rusk', price: 150 },
  ]

  for (const partial of ['c', 'co', 'cok', 'coke']) {
    assert.equal(findProducts(catalogue, partial).length, 0, `nothing matches "${partial}"`)
  }

  // And it must not fire when there is something to pick.
  assert.ok(findProducts(catalogue, 'bre').length > 0)
  assert.ok(findProducts(catalogue, '01').length > 0)
})

test('an empty box is the price list, not a dead end', () => {
  // With nothing typed the panel shows the whole catalogue, so an empty
  // results list must not be read as "offer a one-off".
  const catalogue = [{ id: 'bread-small', code: '01', name: 'Bread Small', price: 120 }]
  assert.equal(''.trim().length > 0, false, 'nothing typed, so nothing is offered')
  assert.ok(findProducts(catalogue, '').length > 0)
})

// --- what the till will accept ---------------------------------------------

test('a one-off needs a name', () => {
  assert.equal(validCustom({ name: '', price: 80 }), false)
  assert.equal(validCustom({ name: '   ', price: 80 }), false)
  assert.equal(validCustom({ name: 'Coke', price: 80 }), true)
})

test('free is allowed, fractions and nonsense are not', () => {
  // A replacement handed over for nothing still belongs on the slip. Paisa do
  // not exist here, so a fractional price is a mis-key every time.
  assert.equal(validCustom({ name: 'Replacement', price: 0 }), true)
  assert.equal(validCustom({ name: 'Coke', price: 80.5 }), false)
  assert.equal(validCustom({ name: 'Coke', price: -10 }), false)
  assert.equal(validCustom({ name: 'Coke', price: null }), false)
  assert.equal(validCustom({ name: 'Coke', price: NaN }), false)
})

test('the line carries everything the bill and the receipt need', () => {
  const line = customLine({ name: '  Coke ', price: 80, qty: 2 })
  assert.equal(line.name, 'Coke')
  assert.equal(line.price, 80)
  assert.equal(line.qty, 2)
  assert.equal(line.custom, true)
  assert.equal(line.productId, 'custom:coke')
  assert.equal(line.code, '')
})

// --- money in, stock out ---------------------------------------------------

const sale = (items, over = {}) => ({
  status: 'normal',
  payment: 'cash',
  total: items.reduce((s, i) => s + i.price * i.qty, 0),
  items,
  ...over,
})

const BREAD = { productId: 'bread-small', name: 'Bread Small', price: 120, qty: 3 }
const COKE = { productId: 'custom:coke', custom: true, name: 'Coke', price: 80, qty: 2 }

test('a one-off is counted in the takings like anything else', () => {
  // This is the half that must NOT be filtered. The money is in the drawer,
  // so it has to be in the figure the drawer is checked against.
  const day = summariseDay([sale([BREAD, COKE])])
  assert.equal(day.salesTotal, 360 + 160)
  assert.equal(day.cashTotal, 520)
  assert.equal(day.txCount, 1)
})

test('a one-off is kept out of the product list and named separately', () => {
  const day = summariseDay([sale([BREAD, COKE])])
  assert.deepEqual(day.byProduct.map((p) => p.productId), ['bread-small'])
  assert.deepEqual(day.customItems.map((p) => p.name), ['Coke'])
  assert.equal(day.customTotal, 160)
})

test('a day with no one-offs says so with an empty list, not a missing one', () => {
  const day = summariseDay([sale([BREAD])])
  assert.deepEqual(day.customItems, [])
  assert.equal(day.customTotal, 0)
})

test('a voided sale takes its one-off with it', () => {
  const day = summariseDay([sale([COKE], { status: 'voided' })])
  assert.equal(day.salesTotal, 0)
  assert.deepEqual(day.customItems, [])
})

test('the same one-off across several sales adds up on one row', () => {
  const day = summariseDay([sale([COKE]), sale([COKE]), sale([BREAD])])
  assert.equal(day.customItems.length, 1)
  assert.equal(day.customItems[0].qty, 4)
  assert.equal(day.customItems[0].revenue, 320)
})

// --- the bug this design exists to prevent ---------------------------------

test('selling a Coke does not put Coke on tomorrow’s baking list', () => {
  // The trap: buildDailyReport builds its rows from whatever was sold, and
  // suggest.soldOut is "sold some, none left, none binned" — which is true of
  // every one-off ever rung, because there is no shelf for one to be left on.
  // Left alone, one bottle of Coke would have been read as a product that sold
  // out, nudged up 10% for it, and put on the kitchen's list for the morning.
  const report = buildDailyReport({
    products: [{ id: 'bread-small', code: '01', name: 'Bread Small', price: 120 }],
    branchId: 'B2',
    businessDate: '2026-08-14',
    sales: [sale([BREAD, COKE])],
    closing: null,
    transfers: [],
    production: null,
    previousClosing: null,
  })

  const ids = report.byProduct.map((r) => r.productId)
  assert.ok(!ids.some((id) => String(id).startsWith('custom:')), 'no one-off in the report rows')
  assert.ok(ids.includes('bread-small'), 'the real product is still there')
})

test('the sold-out rule would have fired on it, which is why it is excluded', () => {
  // Documents the reason rather than the symptom: if this ever stops being
  // true, the exclusion above can be revisited. Until then it must stay.
  assert.equal(soldOut({ sold: 2, leftover: 0, wasted: 0 }), true)
})

// --- splitting a mixed basket ----------------------------------------------

test('a basket splits into the catalogue and the rest', () => {
  const { catalogue, custom } = partitionCustom([BREAD, COKE, BREAD])
  assert.equal(catalogue.length, 2)
  assert.equal(custom.length, 1)
  assert.equal(custom[0].name, 'Coke')
})

// --- remembering the price -------------------------------------------------

test('the price charged last time is offered back', () => {
  store.clear()
  assert.equal(lastCustomPrice('Coke'), null)
  rememberCustomPrice('Coke', 80)
  assert.equal(lastCustomPrice('Coke'), 80)
  assert.equal(lastCustomPrice('coke'), 80, 'however it was capitalised')
})

test('a changed price replaces the remembered one', () => {
  store.clear()
  rememberCustomPrice('Coke', 80)
  rememberCustomPrice('Coke', 90)
  assert.equal(lastCustomPrice('Coke'), 90)
})

test('a rubbish price is never remembered', () => {
  store.clear()
  rememberCustomPrice('Coke', 80.5)
  rememberCustomPrice('Crisps', null)
  assert.equal(lastCustomPrice('Coke'), null)
  assert.equal(lastCustomPrice('Crisps'), null)
})

test('damaged storage does not stop the till selling', () => {
  store.clear()
  store.set('bakery.customPrices', 'not json')
  assert.equal(lastCustomPrice('Coke'), null)
  rememberCustomPrice('Coke', 80)
  assert.equal(lastCustomPrice('Coke'), 80)
})

// --- the quick-pick row ----------------------------------------------------

test('what this shop keeps ringing comes back, most often first', () => {
  const sales = [
    sale([COKE]),
    sale([COKE]),
    sale([{ productId: 'custom:crisps', custom: true, name: 'Crisps', price: 50, qty: 1 }]),
    sale([BREAD]),
  ]
  assert.deepEqual(knownCustomNames(sales), ['Coke', 'Crisps'])
})

test('a voided sale does not teach the quick-pick row anything', () => {
  const sales = [sale([COKE], { status: 'voided' })]
  assert.deepEqual(knownCustomNames(sales), [])
})
