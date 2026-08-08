// Tomorrow's order is suggested from the shop's own closing reports. If this
// maths is wrong the kitchen bakes the wrong amount, so it is worth pinning down
// precisely — especially the two judgement calls: what counts as having sold
// out, and how a product missing from a day's report is treated.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sameWeekdayReports, soldOut, suggestOrder } from '../src/lib/suggest.js'

// 2026-08-11 is a Tuesday; the four Tuesdays before it are the ones that count.
const TUESDAY = '2026-08-11'

const report = (businessDate, rows) => ({ businessDate, byProduct: rows })
const row = (productId, sold, { leftover = 0, wasted = 0 } = {}) => ({
  productId,
  sold,
  leftover,
  wasted,
})

test('only the same weekday is looked at, most recent first', () => {
  const reports = [
    report('2026-08-04', []),
    report('2026-08-05', []),
    report('2026-08-10', []),
    report('2026-07-28', []),
    report('2026-07-21', []),
    report('2026-07-14', []),
    report('2026-07-07', []),
  ]
  const picked = sameWeekdayReports(reports, TUESDAY).map((r) => r.businessDate)
  // Four weeks back, and 07-07 is the fifth Tuesday so it falls outside.
  assert.deepEqual(picked, ['2026-08-04', '2026-07-28', '2026-07-21', '2026-07-14'])
})

test('selling every last one with nothing binned means it ran out', () => {
  assert.equal(soldOut(row('a', 40)), true)
  assert.equal(soldOut(row('a', 40, { leftover: 3 })), false)
  assert.equal(soldOut(row('a', 40, { wasted: 2 })), false)
  // Nothing sold is not the same as selling out.
  assert.equal(soldOut(row('a', 0)), false)
})

test('no history suggests nothing at all', () => {
  assert.deepEqual(suggestOrder([]), { days: 0, items: {} })
})

test('a steady seller is suggested at its average', () => {
  const history = [
    report('2026-08-04', [row('bread', 40, { leftover: 4 })]),
    report('2026-07-28', [row('bread', 38, { leftover: 2 })]),
    report('2026-07-21', [row('bread', 42, { leftover: 6 })]),
    report('2026-07-14', [row('bread', 44, { leftover: 1 })]),
  ]
  const { days, items } = suggestOrder(history)
  assert.equal(days, 4)
  assert.equal(items.bread.qty, 41) // (40+38+42+44)/4
  assert.equal(items.bread.ranOut, 0)
  assert.deepEqual(items.bread.sold, [40, 38, 42, 44])
})

test('a product that sold out is nudged up, because demand was never measured', () => {
  const soldOutDay = [row('cake', 30)]
  const history = [
    report('2026-08-04', soldOutDay),
    report('2026-07-28', soldOutDay),
    report('2026-07-21', soldOutDay),
    report('2026-07-14', soldOutDay),
  ]
  const { items } = suggestOrder(history)
  // ceil(30 * 1.1) = 33 on every day, so the average is 33 — more than the 30
  // that a naive reading of the sales figures would have ordered forever.
  assert.equal(items.cake.qty, 33)
  assert.equal(items.cake.ranOut, 4)
})

test('a day a product does not appear counts as zero, not as missing', () => {
  const history = [
    report('2026-08-04', [row('cake', 40, { leftover: 5 })]),
    report('2026-07-28', []),
    report('2026-07-21', []),
    report('2026-07-14', []),
  ]
  const { items } = suggestOrder(history)
  // 40 across four weeks is ten a week, not forty. Averaging only over the days
  // it appeared would order forty every Tuesday off a single good one.
  assert.equal(items.cake.qty, 10)
})

test('a trickle is dropped rather than rounded up to one forever', () => {
  const history = [
    report('2026-08-04', [row('novelty', 1, { leftover: 2 })]),
    report('2026-07-28', []),
    report('2026-07-21', []),
    report('2026-07-14', []),
  ]
  const { items } = suggestOrder(history)
  assert.equal(items.novelty, undefined)
})

test('waste is carried through so the screen can show why a number fell', () => {
  const history = [
    report('2026-08-04', [row('rusk', 10, { leftover: 0, wasted: 8 })]),
    report('2026-07-28', [row('rusk', 12, { leftover: 0, wasted: 6 })]),
    report('2026-07-21', [row('rusk', 10, { leftover: 0, wasted: 10 })]),
    report('2026-07-14', [row('rusk', 8, { leftover: 0, wasted: 12 })]),
  ]
  const { items } = suggestOrder(history)
  assert.equal(items.rusk.qty, 10)
  assert.equal(items.rusk.wasted, 36)
  // Heavy waste every week, so none of these count as having sold out.
  assert.equal(items.rusk.ranOut, 0)
})
