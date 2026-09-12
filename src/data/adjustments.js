import { arrayUnion, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { adjustmentDocId, adjustmentRef } from '../lib/ids.js'
import { practiceStamp } from '../lib/practice.js'
import { adjustmentEntry, validAdjustment } from '../lib/adjustments.js'

export {
  COUNT_REASON,
  countBaseline,
  countEntries,
  entriesOf,
  netAdjustments,
  parseCount,
  reasonsFor,
  validAdjustment,
} from '../lib/adjustments.js'

/** The day's corrections for one outlet. Absent until the first one is made. */
export function adjustmentDoc(branchId, businessDate) {
  return doc(db, 'shelfAdjustments', adjustmentDocId(businessDate, branchId))
}

/**
 * Add corrections to the day's sheet — one, or a whole shelf count.
 *
 * All of them in a single write. A count of twenty lines is one thing the
 * cashier did, and it must land as one: twenty separate writes over a shop's
 * connection is twenty chances for the count to arrive half-saved, with the
 * shelf showing some of her figures and not others and nothing to say which.
 *
 * `setDoc` with merge and `arrayUnion` rather than a read-then-write: the
 * document does not exist until the first correction of the day, and two
 * devices adding at once must not lose each other's entries. It also makes a
 * retry safe — `arrayUnion` compares whole objects, and each entry is built
 * once with a fixed timestamp, so the same count sent twice is added once.
 *
 * Invalid entries are dropped rather than written, since a zero with no reason
 * is a row on the owner's sheet that explains nothing. Returns how many landed.
 */
export function recordAdjustments({ branchId, businessDate, entries = [] }) {
  const valid = entries.filter((entry) => validAdjustment(entry))
  if (valid.length === 0) return 0

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
        entries: arrayUnion(...valid),
      },
      { merge: true },
    ),
    valid.length === 1 ? `shelf correction at ${branchId}` : `shelf count at ${branchId}`,
  )
  return valid.length
}

/** One correction, from the one-item dialogue. */
export function recordAdjustment({ branchId, businessDate, product, delta, reason, user }) {
  const entry = adjustmentEntry({ product, delta, reason, user })
  return recordAdjustments({ branchId, businessDate, entries: [entry] }) > 0
}
