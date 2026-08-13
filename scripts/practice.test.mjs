import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const { isPractising, practiceStamp, visibleInMode } = await import('../src/lib/practice.js')
const { closingDocId, demandDocId, productionDocId, rateDocId, transferDocId } = await import(
  '../src/lib/ids.js'
)

const TODAY = '2026-08-13'
const TOMORROW = '2026-08-14'

const practising = (businessDate = TODAY) =>
  store.set('bakery.practice', JSON.stringify({ on: true, businessDate }))

// --- when a tablet is practising, and when it is not -----------------------

test('a tablet with nothing stored is live', () => {
  store.clear()
  assert.equal(isPractising(TODAY), false)
})

test('practice switched on today is practice today', () => {
  store.clear()
  practising(TODAY)
  assert.equal(isPractising(TODAY), true)
})

test('practice cannot survive into the next trading day', () => {
  // The safety net this whole file exists for. A tablet left in practice
  // overnight is live again by morning, with nobody having to remember — the
  // alternative is a shop trading all day into records that were never real,
  // which looks completely normal until the drawer is counted.
  store.clear()
  practising(TODAY)
  assert.equal(isPractising(TOMORROW), false)
})

test('damaged storage reads as live, not as practice', () => {
  // Every uncertain answer has to fall on the side where real sales are
  // recorded as real.
  for (const junk of ['not json', '{}', 'null', '[]', '{"on":true}', '{"on":"yes"}']) {
    store.clear()
    store.set('bakery.practice', junk)
    assert.equal(isPractising(TODAY), false, `for ${junk}`)
  }
})

test('the stamp says which mode a record was made in', () => {
  store.clear()
  assert.deepEqual(practiceStamp(TODAY), {})
  practising(TODAY)
  assert.deepEqual(practiceStamp(TODAY), { demo: true })
})

// --- what each mode is allowed to see --------------------------------------

const real = { id: 'r' }
const practice = { id: 'p', demo: true }

test('a live screen never shows a practice record, in any collection', () => {
  // The dangerous direction: a practice sale in a real total is invented money
  // in the owner's hands. No collection is exempt.
  for (const where of ['sales', 'closings', 'products', 'branches', 'dailyRates', 'anything']) {
    assert.equal(visibleInMode(practice, where, false), false, where)
    assert.equal(visibleInMode(real, where, false), true, where)
  }
})

test('this is what finally hides the demo data already in the live project', () => {
  // ~1,681 of 1,682 sales on bakers-inn-pk carry demo:true. Nothing filtered
  // them before, so every figure the owner saw was fiction.
  const demoSale = { id: 'S-20260804-MAIN-A001', demo: true, total: 4200 }
  assert.equal(visibleInMode(demoSale, 'sales', false), false)
})

test('a practice tablet sees practice events and the real catalogue', () => {
  // Teaching somebody on an invented product list teaches them the wrong list,
  // so reference data is shared. The day's events are not.
  assert.equal(visibleInMode(practice, 'sales', true), true)
  assert.equal(visibleInMode(real, 'sales', true), false)

  assert.equal(visibleInMode(real, 'products', true), true)
  assert.equal(visibleInMode(real, 'branches', true), true)
  assert.equal(visibleInMode(real, 'rawMaterials', true), true)
})

test('a fault thrown while practising is still a real fault', () => {
  // clientErrors is deliberately not split. A crash during training is a crash
  // in real code, and stamping it would hide it from the owner for good.
  assert.equal(visibleInMode(real, 'clientErrors', true), true)
  assert.equal(visibleInMode(real, 'clientErrors', false), true)
})

// --- the natural keys ------------------------------------------------------

test('a practice close cannot land on the real close', () => {
  // The worst bug this design could have had. One close per outlet per day
  // means the ids are the same document — so teaching a cashier to close the
  // day would have overwritten the shop's real close with a practice one, and
  // the stamp on it would then have hidden the result from every live screen.
  // The day's takings would simply have been gone.
  assert.equal(closingDocId(TODAY, 'B2', false), 'C-20260813-B2')
  assert.equal(closingDocId(TODAY, 'B2', true), 'C-20260813-B2-P')
  assert.notEqual(closingDocId(TODAY, 'B2', true), closingDocId(TODAY, 'B2', false))
})

test('every natural key keeps practice and real apart', () => {
  const pairs = [
    [demandDocId(TODAY, 'B2', false), demandDocId(TODAY, 'B2', true)],
    [productionDocId(TODAY, false), productionDocId(TODAY, true)],
    [transferDocId(TODAY, 'B2', 1, false), transferDocId(TODAY, 'B2', 1, true)],
    [rateDocId(TODAY, false), rateDocId(TODAY, true)],
  ]
  for (const [live, prac] of pairs) {
    assert.notEqual(live, prac)
    assert.equal(prac, `${live}-P`)
  }
})

test('a practice rate cannot overwrite the morning rate the shops are selling at', () => {
  assert.equal(rateDocId(TODAY, false), 'RATE-20260813')
  assert.equal(rateDocId(TODAY, true), 'RATE-20260813-P')
})

test('the builders ask the tablet when nobody tells them', () => {
  store.clear()
  assert.equal(closingDocId(TODAY, 'B2'), 'C-20260813-B2')
  practising(TODAY)
  assert.equal(closingDocId(TODAY, 'B2'), 'C-20260813-B2-P')
  store.clear()
})

test('a script running in Node is never accidentally practising', () => {
  // The scripts import these builders where there is no tablet to ask. The
  // localStorage read throws and is swallowed, and the answer has to be live.
  const saved = globalThis.localStorage
  delete globalThis.localStorage
  try {
    assert.equal(isPractising(TODAY), false)
    assert.equal(closingDocId(TODAY, 'B2'), 'C-20260813-B2')
  } finally {
    globalThis.localStorage = saved
  }
})
