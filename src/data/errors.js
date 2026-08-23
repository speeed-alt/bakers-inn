import { addDoc, collection, limit, orderBy, query, Timestamp } from 'firebase/firestore'
import { auth, db } from '../firebase.js'
import { deviceBranchId } from '../auth.jsx'
import { businessDateOf } from '../lib/dates.js'

// When the till breaks at eight in the evening in Model Town, the cashier goes
// back to paper and nobody tells anyone. The fault is found days later, from the
// numbers not adding up, if at all. This turns that silence into a line on the
// owner's dashboard.
//
// Two rules govern everything here:
//
//   1. Reporting a fault must never cause one. Every path swallows its own
//      errors — a failed report is strictly less bad than a crash inside the
//      crash handler, which would take the screen down for good.
//   2. It must never become the fault. A render loop can throw hundreds of
//      times a second, and each report is a document write; without a cap, one
//      bad screen would bury the collection and the bill along with it.

const MAX_PER_SESSION = 20

// Reported already this session. Keyed by place and message, so a fault that
// repeats every render is written once, not once per frame.
const alreadySent = new Set()
let sentCount = 0

/**
 * Record that something went wrong, for the owner to see. Fire-and-forget by
 * design: this is called from crash handlers, including ones that ran because
 * the network is misbehaving, so it must not wait for anything.
 *
 * @param error  the thrown value — an Error, or whatever was actually thrown
 * @param where  a short tag for the origin ('render', 'window', 'promise')
 */
export function reportClientError(error, where = 'app') {
  try {
    if (sentCount >= MAX_PER_SESSION) return

    const message = String(error?.message ?? error ?? 'Unknown error').slice(0, 300)
    const key = `${where}:${message}`
    if (alreadySent.has(key)) return

    // Errors before sign-in cannot be stored: the rules require a signed-in
    // member of staff, and relaxing that would let anyone on the internet write
    // to the database. Those faults stay in the browser console only.
    const user = auth.currentUser
    if (!user) return

    alreadySent.add(key)
    sentCount += 1

    addDoc(collection(db, 'clientErrors'), {
      message,
      // Enough stack to identify the code, not so much that a document balloons.
      stack: String(error?.stack ?? '').slice(0, 2000),
      where,
      userId: user.uid,
      branchId: deviceBranchId() ?? null,
      businessDate: businessDateOf(),
      // Device clock, like sales: this has to be written offline too, and a
      // serverTimestamp would read as null until the till reconnects.
      at: Timestamp.fromDate(new Date()),
      path: String(window.location?.pathname ?? '').slice(0, 120),
      agent: String(navigator.userAgent ?? '').slice(0, 200),
    }).catch(() => {
      // Nothing useful to do. The console already has the original error.
    })
  } catch {
    // Reporting must never throw.
  }
}

/**
 * Start a write and get on with it, but do not lose the answer.
 *
 * Every write in `src/data/` is deliberately un-awaited — see the note atop
 * `data/sales.js` for why awaiting freezes the till exactly when the internet
 * drops. Being offline does not land in the catch: those writes sit in
 * Firestore's queue and settle on reconnect. What lands here is a write the
 * server actually *refused* — wrong claims, a rule violation, an id that
 * already exists — and that means the screen showed a cashier one thing while
 * the database kept another.
 *
 * Every one of these used to end in `console.error` on a tablet nobody will
 * ever open the console of. This puts it on the owner's dashboard instead.
 *
 * @param promise  the un-awaited write
 * @param what     what was being written, in the owner's words, for the card
 */
export function fireAndForget(promise, what) {
  promise.catch((error) => {
    console.error(`[bakery] ${what} failed to sync`, error)
    reportClientError(error, `sync:${what}`)
  })
}

/** Recent faults across every tablet. Owner-only — see firestore.rules. */
export function recentErrorsQuery(count = 20) {
  return query(collection(db, 'clientErrors'), orderBy('at', 'desc'), limit(count))
}
