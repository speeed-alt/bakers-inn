import { doc, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { productionDocId } from '../lib/ids.js'

// The baking list itself is written only by the scheduled compile. The kitchen
// adds one thing to it: how many actually came out of the oven. Keeping those
// counts in their own `produced` map (rather than inside the items array) is
// what lets the security rules say "specialists may touch this and nothing
// else" — a rule cannot reach inside an array to protect one field of it.

export function productionDoc(businessDate) {
  return doc(db, 'productionOrders', productionDocId(businessDate))
}

export function recordProduced({ businessDate, productId, qty, user }) {
  updateDoc(productionDoc(businessDate), {
    [`produced.${productId}`]: qty,
    [`producedBy.${productId}`]: user.id,
    updatedAt: Timestamp.fromDate(new Date()),
  }).catch((error) => console.error('[bakery] produced count failed to sync', error))
}

export function markOrderDone({ businessDate, user }) {
  updateDoc(productionDoc(businessDate), {
    status: 'done',
    doneBy: user.id,
    doneByName: user.name,
    doneAt: Timestamp.fromDate(new Date()),
  }).catch((error) => console.error('[bakery] order completion failed to sync', error))
}

export function reopenOrder({ businessDate }) {
  updateDoc(productionDoc(businessDate), { status: 'open' }).catch((error) =>
    console.error('[bakery] order reopen failed to sync', error),
  )
}
