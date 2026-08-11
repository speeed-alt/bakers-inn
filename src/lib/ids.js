import { compactDate, shortDate } from './dates.js'

// Human-readable ids with no global counter — global counters and offline
// devices do not mix. Ids are either natural keys (one per outlet per day) or
// come from a counter with exactly one writer.

const DEVICE_KEY = 'bakery.deviceLetter'
const SEQ_KEY = 'bakery.saleSeq'

/**
 * One letter per till, set once at setup. A second till at the same outlet
 * becomes 'B' and the two can never collide, with no coordination between them.
 */
export function deviceLetter() {
  let letter = localStorage.getItem(DEVICE_KEY)
  if (!letter) {
    letter = 'A'
    localStorage.setItem(DEVICE_KEY, letter)
  }
  return letter
}

export function setDeviceLetter(letter) {
  localStorage.setItem(DEVICE_KEY, letter.toUpperCase().slice(0, 1))
}

/** Per-device, per-day counter. Survives reloads; resets itself each day. */
export function nextSaleSeq(businessDate) {
  let state
  try {
    state = JSON.parse(localStorage.getItem(SEQ_KEY) ?? 'null')
  } catch {
    state = null
  }
  if (!state || state.date !== businessDate) state = { date: businessDate, n: 0 }
  state.n += 1
  localStorage.setItem(SEQ_KEY, JSON.stringify(state))
  return state.n
}

export function saleRef(branchId, businessDate, seq, letter = deviceLetter()) {
  return `S-${branchId}-${shortDate(businessDate)}-${letter}${String(seq).padStart(3, '0')}`
}

/**
 * Deterministic document id: the same sale written twice (a retry after a flaky
 * connection) lands on the same document instead of duplicating takings.
 */
export function saleDocId(branchId, businessDate, seq, letter = deviceLetter()) {
  return `S-${compactDate(businessDate)}-${branchId}-${letter}${String(seq).padStart(3, '0')}`
}

export function closingDocId(businessDate, branchId) {
  return `C-${compactDate(businessDate)}-${branchId}`
}

export function closingRef(businessDate, branchId) {
  return `C-${shortDate(businessDate)}-${branchId}`
}

// --- the daily cycle -------------------------------------------------------
//
// Natural keys, not counters: there is exactly one order per outlet per day and
// one baking list per day, so the id can be worked out from the date and the
// outlet alone. No coordination, no counter to clash over, and re-running the
// compile lands on the same documents instead of duplicating them.

export function demandDocId(businessDate, branchId) {
  return `D-${compactDate(businessDate)}-${branchId}`
}

export function demandRef(businessDate, branchId) {
  return `D-${shortDate(businessDate)}-${branchId}`
}

export function productionDocId(businessDate) {
  return `PO-${compactDate(businessDate)}`
}

export function productionRef(businessDate) {
  return `PO-${shortDate(businessDate)}`
}

/**
 * Transfers are the one record that can legitimately repeat in a day — a second
 * top-up run, or goods going back to the hub — so they carry a suffix.
 * `seq` 1 is the day's main delivery; 'R' marks a return to the hub.
 */
export function transferDocId(businessDate, branchId, seq = 1) {
  const suffix = seq === 1 ? '' : `-${seq}`
  return `T-${compactDate(businessDate)}-${branchId}${suffix}`
}

/**
 * One rate sheet per day, for the whole business. A natural key again: the
 * morning's rates are a single fact, so setting them twice lands on the same
 * document instead of leaving two disagreeing answers.
 */
export function rateDocId(businessDate) {
  return `RATE-${compactDate(businessDate)}`
}

export function reportDocId(businessDate, branchId) {
  return `R-${compactDate(businessDate)}-${branchId}`
}

export function reportRef(businessDate, branchId) {
  return `R-${shortDate(businessDate)}-${branchId}`
}

export function transferRef(businessDate, branchId, seq = 1) {
  const suffix = seq === 1 ? '' : `-${seq}`
  return `T-${shortDate(businessDate)}-${branchId}${suffix}`
}
