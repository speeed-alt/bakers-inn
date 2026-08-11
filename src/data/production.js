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

/**
 * Something baked that nobody ordered.
 *
 * A tray of donuts nobody asked for, a second bake because the first sold out
 * by ten. It goes on today's list as an extra rather than being edited into the
 * compiled items — the items are what the outlets asked for and that record has
 * to stay true, otherwise tomorrow's suggestion learns from a demand that was
 * never made.
 *
 * Keyed by product so a second helping lands on the same entry instead of
 * making two, and so the security rules can name one field.
 */
export function addExtra({ businessDate, product, qty, user }) {
  return updateDoc(productionDoc(businessDate), {
    [`extras.${product.id}`]: {
      productId: product.id,
      code: product.code ?? '',
      productName: product.name,
      qty,
      by: user.id,
      byName: user.name,
      at: Timestamp.fromDate(new Date()),
    },
    updatedAt: Timestamp.fromDate(new Date()),
  })
}

/** Nothing is deleted; an extra entered by mistake is set back to none. */
export function removeExtra({ businessDate, productId }) {
  return updateDoc(productionDoc(businessDate), {
    [`extras.${productId}.qty`]: 0,
    updatedAt: Timestamp.fromDate(new Date()),
  })
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
