import { compactDate, shortDate } from './dates.js'
import { isPractising } from './practice.js'

/**
 * Practice records get their own ids, and this is not cosmetic.
 *
 * Most ids in this file are natural keys — one close per outlet per day, one
 * baking list per day — which is what makes a re-run land on the same document
 * instead of duplicating it. It also means a practice close and the real close
 * for the same shop on the same day are the *same document id*. Without a
 * suffix, teaching a cashier to close the day would overwrite the shop's real
 * close with a practice one, and the practice stamp on it would then hide the
 * result from every live screen. The day's takings would simply be gone.
 *
 * Every builder below defaults to asking whether this tablet is practising, so
 * no caller has to remember. The scripts pass their own flag, because they run
 * in Node where there is no tablet to ask.
 */
const PRACTICE_SUFFIX = '-P'

function forMode(id, practising) {
  return practising ? `${id}${PRACTICE_SUFFIX}` : id
}

// Human-readable ids with no global counter — global counters and offline
// devices do not mix. Ids are either natural keys (one per outlet per day) or
// come from a counter with exactly one writer.

const INSTALL_KEY = 'bakery.installId'
const SEQ_KEY = 'bakery.saleSeq'

// No I, L, O or U: this never has to be read aloud, but it does end up in a
// document id someone may one day be comparing against another on a screen.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function mintInstallId() {
  const bytes = new Uint8Array(5)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // Nothing on a shop tablet lacks Web Crypto over https, but a sale must not
    // depend on that being true.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * A token unique to this installation, minted once and shown to nobody.
 *
 * Neither half of a sale id is safe on its own. The till letter is chosen by a
 * person, so two tablets at one outlet both left on the default 'A' mint the
 * same ids; and the sequence lives in localStorage, so clearing this browser's
 * storage — which "Reset this till" does — restarts it at 1 over ids that
 * already exist.
 *
 * Either way the second write lands on an existing document. `setDoc` with no
 * merge reads as an update, the rules allow only a void or a payment fix to
 * change a sale, so it is refused — and Firestore rolls the *new* sale back out
 * of the local cache. The earlier sale survives; the one just rung up vanishes
 * from the till's own list and from the close. Cash in the drawer, no record of
 * it anywhere, and the drawer reads over at close with nothing to explain it.
 *
 * This token is what makes that impossible. A wipe mints a new one, so even a
 * restarted counter cannot land on an id this tablet has already used.
 */
export function installId() {
  let id = localStorage.getItem(INSTALL_KEY)
  if (!id) {
    id = mintInstallId()
    localStorage.setItem(INSTALL_KEY, id)
  }
  return id
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

/**
 * The reference a customer sees, and the one somebody reads back over a phone.
 *
 * There used to be a till letter in here — `S-B2-0819-A005` — for telling two
 * tills at one shop apart on a receipt. Each shop has one, so the letter was a
 * label for a distinction that does not exist, and it cost a question at setup
 * that had only one right answer. `installId` on the document id is what
 * actually keeps records apart, and it always was.
 */
export function saleRef(branchId, businessDate, seq) {
  return `S-${branchId}-${shortDate(businessDate)}-${String(seq).padStart(4, '0')}`
}

/**
 * Deterministic document id: the same sale written twice (a retry after a flaky
 * connection) lands on the same document instead of duplicating takings.
 *
 * The install token on the end is what stops a *different* sale doing the same
 * thing by accident — see `installId`. Pass '' for it where the ids are being
 * generated outside a browser, as the demo and backfill scripts do.
 */
export function saleDocId(branchId, businessDate, seq, install = installId()) {
  const tail = install ? `-${install}` : ''
  return `S-${compactDate(businessDate)}-${branchId}-${String(seq).padStart(4, '0')}${tail}`
}

export function closingDocId(businessDate, branchId, practising = isPractising()) {
  return forMode(`C-${compactDate(businessDate)}-${branchId}`, practising)
}

export function closingRef(businessDate, branchId) {
  return `C-${shortDate(businessDate)}-${branchId}`
}

/**
 * One sheet of shelf corrections per outlet per day.
 *
 * A natural key, like the close, rather than a document per correction. Six
 * loaves dropped and a tray arriving from the kitchen are two entries on one
 * sheet, which is how they are written down on paper and how they are read back
 * — and it means there is no counter for two devices to fight over.
 */
export function adjustmentDocId(businessDate, branchId, practising = isPractising()) {
  return forMode(`ADJ-${compactDate(businessDate)}-${branchId}`, practising)
}

export function adjustmentRef(businessDate, branchId) {
  return `ADJ-${shortDate(businessDate)}-${branchId}`
}

// --- the daily cycle -------------------------------------------------------
//
// Natural keys, not counters: there is exactly one order per outlet per day and
// one baking list per day, so the id can be worked out from the date and the
// outlet alone. No coordination, no counter to clash over, and re-running the
// compile lands on the same documents instead of duplicating them.

export function demandDocId(businessDate, branchId, practising = isPractising()) {
  return forMode(`D-${compactDate(businessDate)}-${branchId}`, practising)
}

export function demandRef(businessDate, branchId) {
  return `D-${shortDate(businessDate)}-${branchId}`
}

export function productionDocId(businessDate, practising = isPractising()) {
  return forMode(`PO-${compactDate(businessDate)}`, practising)
}

export function productionRef(businessDate) {
  return `PO-${shortDate(businessDate)}`
}

/**
 * Transfers are the one record that can legitimately repeat in a day — a second
 * top-up run, or goods going back to the hub — so they carry a suffix.
 * `seq` 1 is the day's main delivery; 'R' marks a return to the hub.
 */
export function transferDocId(businessDate, branchId, seq = 1, practising = isPractising()) {
  const suffix = seq === 1 ? '' : `-${seq}`
  return forMode(`T-${compactDate(businessDate)}-${branchId}${suffix}`, practising)
}

/**
 * One rate sheet per day, for the whole business. A natural key again: the
 * morning's rates are a single fact, so setting them twice lands on the same
 * document instead of leaving two disagreeing answers.
 */
export function rateDocId(businessDate, practising = isPractising()) {
  return forMode(`RATE-${compactDate(businessDate)}`, practising)
}

export function reportDocId(businessDate, branchId, practising = isPractising()) {
  return forMode(`R-${compactDate(businessDate)}-${branchId}`, practising)
}

export function reportRef(businessDate, branchId) {
  return `R-${shortDate(businessDate)}-${branchId}`
}

export function transferRef(businessDate, branchId, seq = 1) {
  const suffix = seq === 1 ? '' : `-${seq}`
  return `T-${shortDate(businessDate)}-${branchId}${suffix}`
}
