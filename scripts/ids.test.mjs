import test from 'node:test'
import assert from 'node:assert/strict'

// ids.js reads localStorage at module scope through its default arguments, so
// it needs one before the import. A Map is enough: nothing here tests eviction.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const {
  closingDocId,
  demandDocId,
  installId,
  nextSaleSeq,
  productionDocId,
  rateDocId,
  saleDocId,
  saleRef,
  transferDocId,
} = await import('../src/lib/ids.js')

// --- the human-readable reference ------------------------------------------
//
// This one is printed on a receipt a customer may bring back, so its shape is
// fixed by what has already been handed out.

test('the reference on the receipt is the outlet, the day and the count', () => {
  // The till letter came out when the shops settled on one till each: it was a
  // label for a distinction that does not exist, and it cost a question at
  // setup with only one right answer. Nothing had been handed to a customer at
  // the time, so there is no published shape to keep.
  assert.equal(saleRef('B2', '2026-08-08', 1), 'S-B2-0808-0001')
  assert.equal(saleRef('B2', '2026-08-08', 17), 'S-B2-0808-0017')
  assert.equal(saleRef('MAIN', '2026-12-31', 402), 'S-MAIN-1231-0402')
  // Four digits, so a busy Eid does not roll over into five.
  assert.equal(saleRef('MAIN', '2026-12-31', 1200), 'S-MAIN-1231-1200')
})

// --- the document id -------------------------------------------------------

test('the same sale asked for twice lands on the same document', () => {
  // What makes a retry after a flaky connection safe: it must overwrite the
  // sale it already wrote rather than take the money a second time.
  const once = saleDocId('B2', '2026-08-08', 4, 'K3F9Q')
  const again = saleDocId('B2', '2026-08-08', 4, 'K3F9Q')
  assert.equal(once, again)
})

test('two machines at one shop do not mint the same id', () => {
  // The bug this file exists for. Same outlet, same day, same counter — two
  // machines that have never heard of each other. Before the install token
  // these were one id, the second write was refused as an illegal edit, and the
  // sale just rung up was rolled back out of the cache. This matters more now
  // that there is no till letter to tell them apart: the token is the only
  // thing keeping them separate, which is what it was always doing.
  const one = saleDocId('B2', '2026-08-08', 1, 'K3F9Q')
  const two = saleDocId('B2', '2026-08-08', 1, 'X72MB')
  assert.notEqual(one, two)
})

test('a till whose storage was cleared does not reuse its old ids', () => {
  // "Reset this till" clears localStorage, so the counter restarts at 1 over
  // ids that already exist. A fresh install token is what makes that harmless.
  const before = saleDocId('B2', '2026-08-08', 1, 'K3F9Q')
  const afterWipe = saleDocId('B2', '2026-08-08', 1, 'P04WD')
  assert.notEqual(before, afterWipe)
})

test('the scripts can still mint ids with no browser to mint a token from', () => {
  assert.equal(saleDocId('B2', '2026-08-08', 1, ''), 'S-20260808-B2-0001')
})

test('the id carries the date, the outlet and the count', () => {
  // Not cosmetic: this is what someone reads when comparing the app against
  // the paper sheet, so each part has to stay findable.
  const id = saleDocId('B2', '2026-08-08', 17, 'K3F9Q')
  assert.match(id, /^S-20260808-B2-0017-/)
})

// --- the install token -----------------------------------------------------

test('the install token is minted once and then kept', () => {
  store.clear()
  const first = installId()
  assert.equal(installId(), first, 'a second call must not mint a new one')
  assert.equal(store.get('bakery.installId'), first)
})

test('a cleared tablet mints a different token', () => {
  store.clear()
  const before = installId()
  store.clear()
  const after = installId()
  assert.notEqual(before, after)
})

test('the token avoids the characters that get misread', () => {
  // I/L/O/U against 1, 0 and V. Nobody reads this aloud, but somebody will
  // one day compare two of them on a screen.
  store.clear()
  for (let i = 0; i < 200; i += 1) {
    store.clear()
    assert.match(installId(), /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/)
  }
})

test('tokens do not repeat across a shop-sized number of tablets', () => {
  const seen = new Set()
  for (let i = 0; i < 500; i += 1) {
    store.clear()
    seen.add(installId())
  }
  assert.equal(seen.size, 500)
})

// --- the per-day counter ---------------------------------------------------

test('the counter climbs through the day and restarts the next one', () => {
  store.clear()
  assert.equal(nextSaleSeq('2026-08-08'), 1)
  assert.equal(nextSaleSeq('2026-08-08'), 2)
  assert.equal(nextSaleSeq('2026-08-08'), 3)
  assert.equal(nextSaleSeq('2026-08-09'), 1, 'a new business date starts again at 1')
})

test('damaged counter storage does not stop the till selling', () => {
  // A till that throws here cannot take money. Starting the count over is a
  // duplicate id at worst, and the install token has already made that safe.
  store.clear()
  store.set('bakery.saleSeq', 'not json')
  assert.equal(nextSaleSeq('2026-08-08'), 1)
})

// --- the natural keys ------------------------------------------------------
//
// One per outlet per day, so a re-run overwrites instead of duplicating. These
// have no counter and no token by design.

test('one order, one baking list, one close and one rate sheet per day', () => {
  assert.equal(demandDocId('2026-08-08', 'B2'), 'D-20260808-B2')
  assert.equal(productionDocId('2026-08-08'), 'PO-20260808')
  assert.equal(closingDocId('2026-08-08', 'B2'), 'C-20260808-B2')
  assert.equal(rateDocId('2026-08-08'), 'RATE-20260808')
})

test('a second delivery run is a different document from the first', () => {
  assert.equal(transferDocId('2026-08-08', 'B2'), 'T-20260808-B2')
  assert.equal(transferDocId('2026-08-08', 'B2', 1), 'T-20260808-B2')
  assert.equal(transferDocId('2026-08-08', 'B2', 2), 'T-20260808-B2-2')
  assert.equal(transferDocId('2026-08-08', 'B2', 'R'), 'T-20260808-B2-R')
})
