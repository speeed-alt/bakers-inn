import {
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { businessDateOf } from '../lib/dates.js'
import { deviceLetter, nextSaleSeq, saleDocId, saleRef } from '../lib/ids.js'
import { basketTotal } from '../lib/money.js'
import { practiceStamp } from '../lib/practice.js'

// IMPORTANT — never `await` a Firestore write on the selling path.
//
// Offline, the returned promise does not settle until the write reaches the
// server, which may be hours later. Firestore applies the write to the local
// cache synchronously either way, so listeners update at once and the queue
// drains on reconnect. Awaiting here would freeze the till the moment the
// internet drops, which is exactly when it must not.
//
// Not awaiting is not the same as not looking: `fireAndForget` puts a refused
// write on the owner's dashboard. On this path a refusal means money was taken
// and never recorded, which is otherwise found days later, from a drawer that
// read over at close with nothing to explain it.

export function salesForDay(branchId, businessDate) {
  return query(
    collection(db, 'sales'),
    where('branchId', '==', branchId),
    where('businessDate', '==', businessDate),
    orderBy('localAt', 'desc'),
  )
}

export function recordSale({ branchId, cashier, lines, payment, cashGiven = null }) {
  const businessDate = businessDateOf()
  const letter = deviceLetter()
  const seq = nextSaleSeq(businessDate)
  const id = saleDocId(branchId, businessDate, seq, letter)
  const total = basketTotal(lines)

  const sale = {
    // Carries the mode it was made in. See src/lib/practice.js.
    ...practiceStamp(),
    ref: saleRef(branchId, businessDate, seq, letter),
    branchId,
    businessDate,
    cashierId: cashier.id,
    cashierName: cashier.name,
    device: letter,
    payment,
    status: 'normal',
    items: lines.map((l) => ({
      productId: l.productId,
      // Name and price are copied in at the moment of sale, so history never
      // changes when the owner edits the catalog, and receipts render offline.
      name: l.name,
      price: l.price,
      qty: l.qty,
    })),
    total,
    cashGiven,
    changeGiven: payment === 'cash' && cashGiven != null ? Math.max(0, cashGiven - total) : null,
    localAt: Timestamp.fromDate(new Date()),
    createdAt: serverTimestamp(),
  }

  fireAndForget(setDoc(doc(db, 'sales', id), sale), `sale ${sale.ref}`)
  return { id, ...sale }
}

/** Same-day correction. The sale is kept and marked, never removed. */
export function voidSale(sale, reason, user) {
  fireAndForget(
    updateDoc(doc(db, 'sales', sale.id), {
      status: 'voided',
      voidReason: reason,
      voidedBy: user.id,
      // Device clock, not serverTimestamp — this has to work with no internet.
      voidedAt: Timestamp.fromDate(new Date()),
    }),
    `void of ${sale.ref}`,
  )
}

/** A refund is a new negative sale pointing at the original. */
export function recordRefund({ original, cashier, payment }) {
  const businessDate = businessDateOf()
  const letter = deviceLetter()
  const seq = nextSaleSeq(businessDate)
  const id = saleDocId(original.branchId, businessDate, seq, letter)

  const refund = {
    // Carries the mode it was made in. See src/lib/practice.js.
    ...practiceStamp(),
    ref: saleRef(original.branchId, businessDate, seq, letter),
    branchId: original.branchId,
    businessDate,
    cashierId: cashier.id,
    cashierName: cashier.name,
    device: letter,
    payment: payment ?? original.payment,
    status: 'refund',
    refundOf: original.ref,
    items: original.items.map((i) => ({ ...i, qty: -i.qty })),
    total: -original.total,
    cashGiven: null,
    changeGiven: null,
    localAt: Timestamp.fromDate(new Date()),
    createdAt: serverTimestamp(),
  }

  fireAndForget(setDoc(doc(db, 'sales', id), refund), `refund ${refund.ref}`)
  return { id, ...refund }
}

/** One stamped tap to correct a mis-keyed payment type. */
export function changePaymentType(sale, payment, user) {
  fireAndForget(
    updateDoc(doc(db, 'sales', sale.id), {
      payment,
      paymentChangedBy: user.id,
      paymentChangedAt: Timestamp.fromDate(new Date()),
    }),
    `payment fix on ${sale.ref}`,
  )
}
