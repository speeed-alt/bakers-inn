import { collection, doc, limit, orderBy, query, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase.js'
import { rateDocId } from '../lib/ids.js'

// This morning's rates for the items that have one — see lib/rates.js for why
// some products have a rate rather than a price.

export function rateDoc(businessDate) {
  return doc(db, 'dailyRates', rateDocId(businessDate))
}

/** Recent rate sheets, newest first — what the owner looks back through. */
export function recentRatesQuery(days = 30) {
  return query(collection(db, 'dailyRates'), orderBy('businessDate', 'desc'), limit(days))
}

/**
 * Set today's rates.
 *
 * Two writes in one batch. The rate sheet is the record of what was decided on
 * a given morning; the product's own `price` is updated to match so that a till
 * which has not yet seen today's sheet — a tablet that has been off, an outlet
 * with no signal — charges the most recent known rate rather than one from
 * whenever the catalogue was last edited. One of those is a day out of date;
 * the other could be a month.
 *
 * Written as a batch so the two can never disagree.
 */
export function saveRates({ businessDate, prices, user }) {
  const batch = writeBatch(db)

  batch.set(
    rateDoc(businessDate),
    {
      businessDate,
      prices,
      setBy: user.id,
      setByName: user.name,
      setAt: serverTimestamp(),
    },
    { merge: true },
  )

  for (const [productId, price] of Object.entries(prices)) {
    if (!Number.isFinite(price)) continue
    batch.update(doc(db, 'products', productId), { price })
  }

  return batch.commit()
}

export { setDoc }
