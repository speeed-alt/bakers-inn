import { arrayUnion, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { adjustmentDocId, adjustmentRef } from '../lib/ids.js'
import { practiceStamp } from '../lib/practice.js'
import { adjustmentEntry, validAdjustment } from '../lib/adjustments.js'

export { netAdjustments, entriesOf, reasonsFor, validAdjustment } from '../lib/adjustments.js'

/** The day's corrections for one outlet. Absent until the first one is made. */
export function adjustmentDoc(branchId, businessDate) {
  return doc(db, 'shelfAdjustments', adjustmentDocId(businessDate, branchId))
}

/**
 * Add one correction to the day's sheet.
 *
 * `setDoc` with merge and `arrayUnion` rather than a read-then-write: the
 * document does not exist until the first correction of the day, and two
 * corrections made seconds apart must not be able to lose one another. It also
 * makes a retry safe — `arrayUnion` compares whole objects, and the entry is
 * built once by the caller with a fixed timestamp, so the same six dropped
 * loaves sent twice over a flaky line are added once.
 *
 * Refuses silently invalid input rather than writing a zero with no reason,
 * which would be a row on the owner's sheet that explains nothing.
 */
export function recordAdjustment({ branchId, businessDate, product, delta, reason, user }) {
  const entry = adjustmentEntry({ product, delta, reason, user })
  if (!validAdjustment(entry)) return false

  fireAndForget(
    setDoc(
      adjustmentDoc(branchId, businessDate),
      {
        // Carries the mode it was made in. See src/lib/practice.js — a
        // correction made while training must never move a real shelf.
        ...practiceStamp(),
        ref: adjustmentRef(businessDate, branchId),
        branchId,
        businessDate,
        entries: arrayUnion(entry),
      },
      { merge: true },
    ),
    `shelf correction at ${branchId}`,
  )
  return true
}
