import { collection, doc, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { transferDocId, transferRef } from '../lib/ids.js'
import { businessDateOf } from '../lib/dates.js'
import { HUB_BRANCH_ID } from '../config.js'
import { practiceStamp } from '../lib/practice.js'
import { dispatchedItems, receivedItems } from '../lib/dispatch.js'

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

/**
 * Hub sends the goods. `sent` overrides only the lines that were adjusted.
 *
 * The fallback runs through `item.qtySent` before `item.qtyDemanded`, and that
 * middle step is not decoration. A tray of something nobody ordered is added to
 * the note as a line with `qtyDemanded: 0` and its quantity already in
 * `qtySent` — it cannot be in `sent`, because `sent` is seeded from the note's
 * own lines and an extra is by definition not one of them. Falling straight to
 * `qtyDemanded` therefore wrote every single extra out as zero: the van left
 * with twenty donuts in it, the note said none had been sent, the shop could
 * not count them in without recording a miscount, and the day's paperwork
 * valued them at nothing. It happened every time, and the button said "Send —
 * 1 extra" while it did it.
 */
export function dispatchTransfer({ transfer, sent = {}, user }) {
  const items = dispatchedItems(transfer.items, sent)

  fireAndForget(
    updateDoc(transferDoc(transfer.id), {
      items,
      status: 'dispatched',
      dispatchedBy: user.id,
      dispatchedByName: user.name,
      dispatchedAt: Timestamp.fromDate(new Date()),
    }),
    `dispatch of ${transfer.ref}`,
  )
}

/**
 * Outlet counts what arrived. A line that does not match what was sent needs a
 * reason, and both numbers are kept side by side for good — a short delivery is
 * never quietly turned into the outlet's waste.
 */
export function receiveTransfer({ transfer, counted = {}, reasons = {}, user }) {
  const items = receivedItems(transfer.items, counted, reasons)

  fireAndForget(
    updateDoc(transferDoc(transfer.id), {
      items,
      status: 'received',
      receivedBy: user.id,
      receivedByName: user.name,
      receivedAt: Timestamp.fromDate(new Date()),
      // Which trading day the goods actually landed on, which is not the day
      // written on the note. A note carries the day it was *made for* — the
      // baker bakes tomorrow's bread tonight, an outlet sends its leftovers
      // back under the day that just ended — and the shop has the crates from
      // the moment it counts them, not from the date on the paperwork. Without
      // this the close wizard read a shop that had taken in seventy-two items
      // as having taken in none.
      receivedOn: businessDateOf(),
    }),
    `receipt of ${transfer.ref}`,
  )
}

/**
 * Start a delivery note for an outlet that has not got one.
 *
 * Notes normally come pre-filled from the compile, one per outlet that ordered.
 * That left nowhere at all to put a bake nobody asked for when nobody had
 * ordered — and on a bakery whose hub is also its busiest shop, a day where the
 * only order is the hub's own is a completely ordinary day. The baker could
 * record a second tray of rusks on the Bake screen, watch it counted as
 * production, and then find the Dispatch screen empty with no way to send a
 * single one of them anywhere.
 *
 * Created empty and in draft, which is exactly the state the compile leaves its
 * own notes in, so everything downstream — adding extras, adjusting, sending,
 * counting in at the far end — is the same path as any other delivery. The
 * natural key means starting one twice lands on the same note rather than
 * making a second.
 */
export function startTransfer({ businessDate, fromBranch, toBranchId, user }) {
  const record = {
    ...practiceStamp(),
    ref: transferRef(businessDate, toBranchId),
    fromBranch,
    toBranchId,
    businessDate,
    direction: 'out',
    status: 'draft',
    items: [],
    startedBy: user.id,
    startedByName: user.name,
    createdAt: Timestamp.fromDate(new Date()),
  }
  return setDoc(transferDoc(transferDocId(businessDate, toBranchId)), record, { merge: true })
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
    // Carries the mode it was made in. See src/lib/practice.js.
    ...practiceStamp(),
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

  fireAndForget(setDoc(transferDoc(id), record, { merge: true }), `return ${record.ref}`)
  return record
}
