import { arrayUnion, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { closingDocId, closingRef } from '../lib/ids.js'
import { previousDate } from '../lib/dates.js'
import { practiceStamp } from '../lib/practice.js'

// One definition of "is this day shut?", shared with the screens.
export { isClosed, reopenCount } from '../lib/closing.js'

export function closingDoc(branchId, businessDate) {
  return doc(db, 'closings', closingDocId(businessDate, branchId))
}

/**
 * The float this day opened with, carried from yesterday's close. Without this
 * the expected-cash figure is wrong every single day.
 */
export async function openingFloatFor(branchId, businessDate) {
  try {
    const snap = await getDoc(closingDoc(branchId, previousDate(businessDate)))
    return snap.exists() ? (snap.data().nextFloat ?? 0) : 0
  } catch {
    return 0
  }
}

export function closeDay({
  branchId,
  businessDate,
  openingFloat,
  countedCash,
  nextFloat,
  summary,
  closedBy,
  waste = [],
  carry = [],
  returns = [],
  wasteValue = 0,
  late = false,
  noTrade = false,
}) {
  const record = {
    // Carries the mode it was made in. See src/lib/practice.js.
    ...practiceStamp(),
    ref: closingRef(businessDate, branchId),
    branchId,
    businessDate,
    status: noTrade ? 'no-trade' : late ? 'closed-late' : 'closed',
    openingFloat,
    countedCash,
    nextFloat,
    expectedCash: openingFloat + summary.cashTotal,
    overShort: countedCash - (openingFloat + summary.cashTotal),
    salesTotal: summary.salesTotal,
    cashTotal: summary.cashTotal,
    cardTotal: summary.cardTotal,
    // The whole split, so a close can still be read years later even if the
    // shop has stopped taking one of these ways entirely.
    digitalTotal: summary.digitalTotal,
    byMethod: summary.byMethod.map((m) => ({ id: m.id, label: m.label, total: m.total, count: m.count })),
    refundTotal: summary.refundTotal,
    txCount: summary.txCount,
    voidedCount: summary.voidedCount,
    byProduct: summary.byProduct,

    // The shelf at closing time: what was binned, what stays for tomorrow, and
    // what went back to the hub. `carry` is what tomorrow's count starts from.
    wasteItems: waste,
    carry,
    returns,
    wasteValue,
    wasteQty: waste.reduce((sum, w) => sum + w.qty, 0),

    closedBy: closedBy.id,
    closedByName: closedBy.name,
    closedAt: Timestamp.fromDate(new Date()),
    syncedAt: serverTimestamp(),
    // Append-only trail. A day closed, reopened and closed again keeps every
    // version of the count, so a corrected figure can always be told apart from
    // a quietly changed one.
    events: arrayUnion({
      action: 'closed',
      by: closedBy.id,
      byName: closedBy.name,
      at: Timestamp.fromDate(new Date()),
      countedCash,
      overShort: countedCash - (openingFloat + summary.cashTotal),
    }),
  }

  // Same reasoning as sales: the local write lands immediately, the network
  // catches up later. See the note in data/sales.js.
  // merge: a day closed, reopened and closed again keeps its event trail.
  fireAndForget(
    setDoc(closingDoc(branchId, businessDate), record, { merge: true }),
    `close of ${closingRef(businessDate, branchId)}`,
  )
  return record
}

/**
 * Undo a close. An accidental tap must never leave a shop unable to sell, so
 * the outlet that closed the day can reopen it themselves rather than waiting
 * on the owner. Nothing is erased: the figures stay, the reopen is stamped, and
 * it shows up on the owner's dashboard.
 */
export function reopenDay({ branchId, businessDate, user, reason = null }) {
  const now = Timestamp.fromDate(new Date())
  fireAndForget(
    updateDoc(closingDoc(branchId, businessDate), {
      status: 'reopened',
      reopenedBy: user.id,
      reopenedByName: user.name,
      reopenedAt: now,
      reopenReason: reason,
      events: arrayUnion({ action: 'reopened', by: user.id, byName: user.name, at: now, reason }),
    }),
    `reopen of ${closingRef(businessDate, branchId)}`,
  )
}
