import { businessDateOf } from './dates.js'

// Practice mode: a tablet you can teach somebody on, wired to the real system,
// where nothing that happens counts.
//
// Two rules make it safe, and neither is optional.
//
// **Everything a practice tablet writes is stamped `demo: true`, and nothing
// live will ever show it again.** Not hidden by a screen — filtered at the one
// place every read passes through (`useSnapshot`). A practice sale cannot reach
// the owner's takings, the daily report, the P&L, or tomorrow's baking
// suggestion, because the query that would have to find it drops it first.
//
// **It cannot survive into the next trading day.** The mode is stored with the
// business date it was switched on, and read back against today's. A tablet
// left in practice overnight is live again by morning, on its own, with nobody
// having to remember. The failure this exists to prevent is a shop trading all
// day into records that were never real — which would look completely normal
// until the drawer was counted, and would be unrecoverable.
//
// Going live is a flip, not a delete. Practice records stay in the database and
// simply stop being visible, so there is no path anywhere in this app that
// destroys a record — the owner's rule that nothing is ever deleted holds
// exactly as it did before this file existed. It also means a training world
// survives being switched away from and back to.

const KEY = 'bakery.practice'

/**
 * Collections where practice and real records must never be seen together.
 *
 * These are the transactional ones — the day's events. Everything else
 * (products, branches, users, raw materials) is shared reference data, and a
 * trainee should be looking at the real catalogue at the real prices. Teaching
 * somebody on an invented product list teaches them the wrong list.
 *
 * `clientErrors` is deliberately absent, and it matters: a fault thrown during
 * a practice session is a real fault in real code. Those are never stamped and
 * never filtered, so a crash while training still reaches the owner's screen.
 */
export const PRACTICE_COLLECTIONS = new Set([
  'sales',
  'closings',
  'transfers',
  'demands',
  'productionOrders',
  'dailyReports',
  'purchases',
  'stockMovements',
  'expenses',
])

/** What this tablet has stored, or null. Never throws — storage can be gone. */
function stored() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Is this tablet practising right now?
 *
 * The date check is the whole safety net. Anything other than "switched on, and
 * switched on today" reads as live, including storage that has been damaged or
 * half-written — the answer when we are not certain has to be the one where
 * real sales are recorded as real.
 */
export function isPractising(today = businessDateOf()) {
  const value = stored()
  return value?.on === true && value.businessDate === today
}

/** Spread into any record being written, so it carries the mode it was made in. */
export function practiceStamp(today = businessDateOf()) {
  return isPractising(today) ? { demo: true } : {}
}

/**
 * Should this record be shown, given the mode?
 *
 * Live drops every practice record, in every collection, with no exceptions —
 * that direction is the dangerous one, because a practice sale appearing in a
 * real total is invented money in the owner's hands. It is also what finally
 * hides the fortnight of demo trading already sitting in the live project.
 *
 * Practice only narrows the transactional collections, so the trainee gets the
 * real catalogue with a practice day's worth of events on top of it.
 */
export function visibleInMode(record, collectionName, practising) {
  const isPracticeRecord = record?.demo === true
  if (!practising) return !isPracticeRecord
  if (!PRACTICE_COLLECTIONS.has(collectionName)) return true
  return isPracticeRecord
}

/**
 * Switch this tablet into practice, or back to live.
 *
 * Both reload the page, deliberately. Every Firestore listener on screen was
 * subscribed under the old mode and is holding records filtered under it; the
 * reload is what guarantees there is no moment where half the screen is
 * practising and half of it is not. Switching modes is rare and it is worth two
 * seconds to be certain.
 */
export function startPractice(today = businessDateOf()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ on: true, businessDate: today }))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function goLive() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do. A read that cannot find the key answers "live" anyway,
    // which is the side to fail on.
  }
  window.location.reload()
}
