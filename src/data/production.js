import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { compileDemands } from '../lib/compile.js'
import { addDays } from '../lib/dates.js'
import { HISTORY_WEEKS } from '../config.js'
import { practiceStamp } from '../lib/practice.js'
import {
  demandDocId,
  demandRef,
  productionDocId,
  productionRef,
  transferDocId,
  transferRef,
} from '../lib/ids.js'

// The kitchen adds one thing to the baking list: how many actually came out of
// the oven. Keeping those counts in their own `produced` map (rather than
// inside the items array) is what lets the security rules say "specialists may
// touch this and nothing else" — a rule cannot reach inside an array to protect
// one field of it.
//
// The list itself is normally written by the 05:00 job. `compileNow` below is
// the same compile, run from the app, for the mornings when it has not.

export function productionDoc(businessDate) {
  return doc(db, 'productionOrders', productionDocId(businessDate))
}

export function recordProduced({ businessDate, productId, qty, user }) {
  fireAndForget(
    updateDoc(productionDoc(businessDate), {
      [`produced.${productId}`]: qty,
      [`producedBy.${productId}`]: user.id,
      updatedAt: Timestamp.fromDate(new Date()),
    }),
    `baked count on ${productionRef(businessDate)}`,
  )
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
  fireAndForget(
    updateDoc(productionDoc(businessDate), {
      status: 'done',
      doneBy: user.id,
      doneByName: user.name,
      doneAt: Timestamp.fromDate(new Date()),
    }),
    `finishing ${productionRef(businessDate)}`,
  )
}

export function reopenOrder({ businessDate }) {
  fireAndForget(
    updateDoc(productionDoc(businessDate), { status: 'open' }),
    `reopening ${productionRef(businessDate)}`,
  )
}

/**
 * Build today's baking list now, from the app.
 *
 * The same compile the 05:00 job runs, and deliberately the same module:
 * `compileDemands` is imported from src/lib here and from functions/shared
 * there, so a list built by hand at 05:15 is the list the job would have built
 * at 05:00. Two implementations of "what should we bake" would eventually give
 * two answers, and the kitchen would be the last to find out.
 *
 * Safe to run twice, and safe to run after the job has already run: the list is
 * a natural key so a second compile lands on the same document, orders already
 * locked stay locked, and a delivery note already on its way is left alone.
 *
 * Returns what it built, so the screen can say what happened rather than just
 * going quiet.
 */
export async function compileNow({ businessDate, user }) {
  const [branchesSnap, demandsSnap, existingSnap] = await Promise.all([
    getDocs(collection(db, 'branches')),
    getDocs(query(collection(db, 'demands'), where('businessDate', '==', businessDate))),
    getDoc(productionDoc(businessDate)),
  ])

  const branches = branchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const demands = demandsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const existing = existingSnap.exists() ? { id: existingSnap.id, ...existingSnap.data() } : null

  // An outlet that did not order gets its own last same weekday repeated.
  // Stepping back in whole weeks rather than matching weekday names sidesteps
  // locales entirely: seven days before a Tuesday is a Tuesday everywhere.
  const submitted = ['submitted', 'locked']
  const fallbacks = {}
  for (const branch of branches) {
    if (demands.find((d) => d.branchId === branch.id && submitted.includes(d.status))) continue
    for (let week = 1; week <= HISTORY_WEEKS; week += 1) {
      const past = addDays(businessDate, -7 * week)
      const snap = await getDoc(doc(db, 'demands', demandDocId(past, branch.id)))
      if (!snap.exists()) continue
      const previous = { id: snap.id, ...snap.data() }
      if (previous.status !== 'draft' && (previous.items?.length ?? 0) > 0) {
        fallbacks[branch.id] = previous
        break
      }
    }
  }

  const result = compileDemands({ branches, demands, fallbacks, existing })
  if (result.items.length === 0) {
    return { items: 0, missing: result.missing ?? [], transfers: 0 }
  }

  // A list that gained a line has to be open again — a kitchen that had marked
  // itself done cannot be left "finished" with something new on the sheet.
  const knownBefore = new Set((existing?.items ?? []).map((i) => i.productId))
  const gained = result.items.some((i) => !knownBefore.has(i.productId))
  const status = !existing ? 'open' : gained ? 'open' : (existing.status ?? 'open')

  const batch = writeBatch(db)

  batch.set(
    productionDoc(businessDate),
    {
      ...practiceStamp(),
      ref: productionRef(businessDate),
      businessDate,
      status,
      items: result.items,
      compiledFrom: result.compiledFrom,
      autoFilled: result.autoFilled,
      missing: result.missing,
      // Stamped, and required by the rules to be the person actually pressing
      // the button. Nobody has to approve a compile — but the owner can always
      // see it was built by hand, and by whom.
      compiledBy: user.id,
      compiledByName: user.name,
      compiledAt: serverTimestamp(),
      ...(existing ? {} : { produced: {}, producedBy: {} }),
    },
    { merge: true },
  )

  for (const branch of branches) {
    const own = demands.find((d) => d.branchId === branch.id && submitted.includes(d.status))
    if (own) {
      if (own.status !== 'locked') batch.update(doc(db, 'demands', own.id), { status: 'locked' })
      continue
    }
    const fallback = fallbacks[branch.id]
    if (!fallback) continue
    batch.set(doc(db, 'demands', demandDocId(businessDate, branch.id)), {
      ...practiceStamp(),
      ref: demandRef(businessDate, branch.id),
      branchId: branch.id,
      businessDate,
      status: 'locked',
      auto: true,
      copiedFrom: fallback.id,
      items: fallback.items,
      updatedAt: Timestamp.fromDate(new Date()),
    })
  }

  // A note already dispatched is somebody's van. Never overwrite one.
  const movingSnap = await getDocs(
    query(collection(db, 'transfers'), where('businessDate', '==', businessDate)),
  )
  const moving = new Set(
    movingSnap.docs.filter((d) => d.data().status !== 'draft').map((d) => d.id),
  )

  let notes = 0
  for (const transfer of result.transfers) {
    const id = transferDocId(businessDate, transfer.toBranchId)
    if (moving.has(id)) continue
    notes += 1
    batch.set(
      doc(db, 'transfers', id),
      {
        ...practiceStamp(),
        ref: transferRef(businessDate, transfer.toBranchId),
        fromBranch: result.mainId,
        toBranchId: transfer.toBranchId,
        businessDate,
        direction: 'out',
        status: 'draft',
        poRef: productionRef(businessDate),
        items: transfer.items.map((i) => ({ ...i, qtySent: null, qtyReceived: null })),
        createdAt: Timestamp.fromDate(new Date()),
      },
      { merge: true },
    )
  }

  // Awaited, unlike the selling path: nobody is standing at a till, and the
  // kitchen needs to know whether it worked before it starts weighing flour.
  await batch.commit()

  return {
    items: result.items.length,
    fromOutlets: result.compiledFrom?.length ?? 0,
    autoFilled: result.autoFilled ?? [],
    missing: result.missing ?? [],
    transfers: notes,
  }
}
