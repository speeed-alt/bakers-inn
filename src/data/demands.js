import { collection, doc, getDoc, query, setDoc, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { demandDocId, demandRef } from '../lib/ids.js'
import { addDays } from '../lib/dates.js'
import { HISTORY_WEEKS } from '../config.js'

// One order per outlet per day, so the document id is the date and the outlet.
// Nothing to coordinate, and the compile lands on the same documents if it runs
// twice.

export function demandDoc(branchId, businessDate) {
  return doc(db, 'demands', demandDocId(businessDate, branchId))
}

export function demandsForDate(businessDate) {
  return query(collection(db, 'demands'), where('businessDate', '==', businessDate))
}

/**
 * What this outlet ordered on the last same weekday. Bakery trade is weekly, so
 * that — not yesterday — is what tomorrow's order starts from. Returns null when
 * there is no history yet, which is the honest answer in a shop's first week:
 * the order starts blank rather than pretending to know.
 */
export async function lastSameWeekdayDemand(branchId, businessDate) {
  for (let week = 1; week <= HISTORY_WEEKS; week += 1) {
    try {
      const snap = await getDoc(demandDoc(branchId, addDays(businessDate, -7 * week)))
      if (!snap.exists()) continue
      const past = { id: snap.id, ...snap.data() }
      if (past.status !== 'draft' && (past.items?.length ?? 0) > 0) return past
    } catch {
      // Offline with nothing cached: fall through and start blank.
      return null
    }
  }
  return null
}

export function saveDemand({ branchId, businessDate, items, user, submit = false }) {
  const now = Timestamp.fromDate(new Date())
  const record = {
    ref: demandRef(businessDate, branchId),
    branchId,
    businessDate,
    status: submit ? 'submitted' : 'draft',
    items: items
      .filter((i) => i.qty > 0)
      .map((i) => ({
        productId: i.productId,
        code: i.code ?? '',
        productName: i.name ?? i.productName,
        qty: i.qty,
      })),
    updatedBy: user.id,
    updatedByName: user.name,
    updatedAt: now,
    ...(submit ? { submittedAt: now } : {}),
  }

  // merge: the compile adds its own fields (status, flags) and this must not
  // wipe them. See the note in data/sales.js on why this is not awaited.
  fireAndForget(
    setDoc(demandDoc(branchId, businessDate), record, { merge: true }),
    `order ${record.ref}`,
  )
  return record
}
