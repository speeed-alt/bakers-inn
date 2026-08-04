import { collection, doc, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { transferDocId, transferRef } from '../lib/ids.js'
import { HUB_BRANCH_ID } from '../config.js'

// A delivery note. Created as a draft by the compile, pre-filled with what the
// outlet asked for, so the hub only confirms or adjusts and the outlet only
// counts what turned up.
//
// The two sides never write at the same moment: the hub writes while the note is
// a draft, the receiving outlet writes only once it has been dispatched. The
// status is what keeps them apart — see firestore.rules.

export function transferDoc(id) {
  return doc(db, 'transfers', id)
}

// Both of these pin a branch on purpose. Firestore rules are not filters — a
// query is refused outright unless its constraints prove the read rule — so a
// query for "every transfer today" would be denied for anyone but the owner.

/** Deliveries this outlet is sending out (the hub's view). */
export function transfersFrom(branchId, businessDate) {
  return query(
    collection(db, 'transfers'),
    where('fromBranch', '==', branchId),
    where('businessDate', '==', businessDate),
  )
}

export function transfersTo(branchId, businessDate) {
  return query(
    collection(db, 'transfers'),
    where('toBranchId', '==', branchId),
    where('businessDate', '==', businessDate),
  )
}

/** Hub sends the goods. `sent` overrides only the lines that were adjusted. */
export function dispatchTransfer({ transfer, sent = {}, user }) {
  const items = transfer.items.map((item) => ({
    ...item,
    qtySent: sent[item.productId] ?? item.qtyDemanded,
  }))

  updateDoc(transferDoc(transfer.id), {
    items,
    status: 'dispatched',
    dispatchedBy: user.id,
    dispatchedByName: user.name,
    dispatchedAt: Timestamp.fromDate(new Date()),
  }).catch((error) => console.error(`[bakery] dispatch of ${transfer.ref} failed to sync`, error))
}

/**
 * Outlet counts what arrived. A line that does not match what was sent needs a
 * reason, and both numbers are kept side by side for good — a short delivery is
 * never quietly turned into the outlet's waste.
 */
export function receiveTransfer({ transfer, counted = {}, reasons = {}, user }) {
  const items = transfer.items.map((item) => {
    const got = counted[item.productId] ?? item.qtySent
    const short = got !== item.qtySent
    return {
      ...item,
      qtyReceived: got,
      ...(short ? { shortReason: reasons[item.productId] ?? 'Other' } : {}),
    }
  })

  updateDoc(transferDoc(transfer.id), {
    items,
    status: 'received',
    receivedBy: user.id,
    receivedByName: user.name,
    receivedAt: Timestamp.fromDate(new Date()),
  }).catch((error) => console.error(`[bakery] receipt of ${transfer.ref} failed to sync`, error))
}

/**
 * Stock going back to the hub at the end of the day.
 *
 * The one delivery note an outlet creates itself — everything else is written
 * by the compile. It starts already dispatched, because the goods are going in
 * the van now; the hub confirms what actually turns up in the morning.
 */
export function sendReturn({ fromBranch, businessDate, items, user, toBranch = HUB_BRANCH_ID }) {
  const id = transferDocId(businessDate, fromBranch, 'R')
  const record = {
    ref: transferRef(businessDate, fromBranch, 'R'),
    fromBranch,
    toBranchId: toBranch,
    businessDate,
    direction: 'return',
    status: 'dispatched',
    items: items.map((i) => ({
      productId: i.productId,
      code: i.code ?? '',
      productName: i.productName,
      qtyDemanded: i.qty,
      qtySent: i.qty,
      qtyReceived: null,
    })),
    dispatchedBy: user.id,
    dispatchedByName: user.name,
    dispatchedAt: Timestamp.fromDate(new Date()),
  }

  setDoc(transferDoc(id), record, { merge: true }).catch((error) =>
    console.error(`[bakery] return ${record.ref} failed to sync`, error),
  )
  return record
}

export function transferVariance(transfer) {
  return (transfer.items ?? []).reduce(
    (sum, i) => sum + Math.max(0, (i.qtySent ?? 0) - (i.qtyReceived ?? i.qtySent ?? 0)),
    0,
  )
}
