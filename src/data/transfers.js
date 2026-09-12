import { collection, doc, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import {
  goodsInDocId,
  goodsInRef,
  sendDocId,
  sendRef,
  transferDocId,
  transferRef,
} from '../lib/ids.js'
import { businessDateOf } from '../lib/dates.js'
import { HUB_BRANCH_ID, WORKSHOP_ID } from '../config.js'
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

/**
 * Goods arriving from the workshop, counted at the counter.
 *
 * Written as an ordinary incoming note that is already `received`, because that
 * is exactly what it is: somebody stood at the counter, counted the crates, and
 * the stock is here. There is no dispatch step to wait for — nobody at the
 * workshop signs in — so a note in any other state would be stock that exists in
 * the room and not in the system.
 *
 * That also means every screen already handles it. `receivedAt` counts incoming
 * notes marked received on the day they were taken in, so the shelf, the till's
 * warning, the close and the owner's report all see the goods without a line of
 * new arithmetic.
 */
export function receiveGoods({ branchId, businessDate, items = [], user, at = new Date() }) {
  const lines = items
    .filter((item) => (item.qty ?? 0) > 0)
    .map((item) => ({
      productId: item.productId,
      code: item.code ?? '',
      productName: item.productName ?? '',
      // Both figures, as on any other note. Nobody sent these — the workshop
      // writes no paperwork — so what was counted is also what was "sent", and
      // the pair keeps the shape every other screen reads.
      qtySent: item.qty,
      qtyReceived: item.qty,
    }))
  if (lines.length === 0) return 0

  fireAndForget(
    setDoc(transferDoc(goodsInDocId(businessDate, branchId, at)), {
      ...practiceStamp(),
      ref: goodsInRef(businessDate, branchId, at),
      businessDate,
      // The day the goods were actually taken in, which is what the shelf counts
      // by — see the long note on `receivedOn` in receiveTransfer.
      receivedOn: businessDate,
      fromBranch: WORKSHOP_ID,
      toBranchId: branchId,
      direction: 'in',
      status: 'received',
      items: lines,
      receivedBy: user?.id ?? '',
      receivedByName: user?.name ?? '',
      receivedAt: Timestamp.fromDate(at),
    }),
    `goods in at ${branchId}`,
  )
  return lines.length
}

/**
 * Stock sent on to another outlet, one item at a time from the Stock screen.
 *
 * Dispatched the moment it is written: the crate has left this counter, so it
 * leaves this counter's shelf. It stays waiting to be counted in at the far end,
 * which is the honest state while the other two outlets have no till — the
 * goods are neither here nor on their shelf, and the note says so rather than
 * pretending somebody confirmed them.
 */
export function sendStock({ fromBranch, toBranchId, businessDate, items = [], user, at = new Date() }) {
  const lines = items
    .filter((item) => (item.qty ?? 0) > 0)
    .map((item) => ({
      productId: item.productId,
      code: item.code ?? '',
      productName: item.productName ?? '',
      // Nobody ordered it — this is the counter deciding what to send — so the
      // demanded figure is zero and the sent figure is the whole of the story.
      qtyDemanded: 0,
      qtySent: item.qty,
    }))
  if (lines.length === 0) return 0

  fireAndForget(
    setDoc(transferDoc(sendDocId(businessDate, toBranchId, at)), {
      ...practiceStamp(),
      ref: sendRef(businessDate, toBranchId, at),
      businessDate,
      fromBranch,
      toBranchId,
      direction: 'out',
      status: 'dispatched',
      items: lines,
      dispatchedBy: user?.id ?? '',
      dispatchedByName: user?.name ?? '',
      dispatchedAt: Timestamp.fromDate(at),
    }),
    `stock sent from ${fromBranch} to ${toBranchId}`,
  )
  return lines.length
}
