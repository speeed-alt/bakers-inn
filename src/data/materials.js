import {
  addDoc,
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { businessDateOf, compactDate } from '../lib/dates.js'
import { applyMovement, purchaseTotal, usageBetweenCounts, COUNT, RECEIVED, SPOILAGE } from '../lib/materials.js'

// Raw materials are the owner's alone — see firestore.rules.

export function materialsQuery() {
  return collection(db, 'rawMaterials')
}

export function purchasesQuery(limitTo) {
  return query(collection(db, 'purchases'), orderBy('businessDate', 'desc'), ...(limitTo ? [limitTo] : []))
}

export function movementsFor(materialId) {
  return query(collection(db, 'stockMovements'), where('materialId', '==', materialId))
}

export function saveMaterial(id, data) {
  if (id) return updateDoc(doc(db, 'rawMaterials', id), data)
  return addDoc(collection(db, 'rawMaterials'), {
    active: true,
    onHand: 0,
    receivedSinceCount: 0,
    spoiledSinceCount: 0,
    ...data,
  })
}

/**
 * A purchase, and the stock it puts on the shelf, written together.
 *
 * The owner types the delivery once. Everything else — the ledger entries, the
 * new on-hand figures — follows from it in the same batch, so there is never a
 * purchase recorded without the stock, or stock without the purchase.
 */
export function recordPurchase({ items, businessDate = businessDateOf(), supplier = null, user }) {
  const batch = writeBatch(db)
  const purchaseRef = doc(collection(db, 'purchases'))
  const total = purchaseTotal(items)
  const now = Timestamp.fromDate(new Date())

  batch.set(purchaseRef, {
    ref: `P-${compactDate(businessDate)}-${purchaseRef.id.slice(0, 4).toUpperCase()}`,
    businessDate,
    supplier,
    items: items.map((i) => ({
      materialId: i.materialId,
      materialName: i.materialName,
      unit: i.unit ?? '',
      qty: i.qty,
      unitCost: i.unitCost,
      lineTotal: Math.round(i.qty * i.unitCost),
    })),
    total,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: now,
    syncedAt: serverTimestamp(),
  })

  for (const item of items) {
    const movement = doc(collection(db, 'stockMovements'))
    batch.set(movement, {
      materialId: item.materialId,
      materialName: item.materialName,
      type: RECEIVED,
      qty: item.qty,
      unitCost: item.unitCost,
      businessDate,
      purchaseRef: purchaseRef.id,
      by: user.id,
      byName: user.name,
      at: now,
    })
    batch.update(doc(db, 'rawMaterials', item.materialId), {
      onHand: applyMovement(item.onHandBefore ?? 0, { type: RECEIVED, qty: item.qty }),
      receivedSinceCount: (item.receivedSinceCountBefore ?? 0) + item.qty,
      costPerUnit: item.unitCost,
      lastPurchaseAt: now,
    })
  }

  batch.commit().catch((error) => console.error('[bakery] purchase failed to sync', error))
  return { id: purchaseRef.id, total }
}

/**
 * A single ledger entry. A count is the interesting one: it is the moment the
 * shelf gets to correct the paperwork, and the gap between the two counts is
 * what tells us how fast the material is actually being used.
 */
export function recordMovement({ material, type, qty, note = null, user, businessDate = businessDateOf() }) {
  const now = new Date()
  const batch = writeBatch(db)

  batch.set(doc(collection(db, 'stockMovements')), {
    materialId: material.id,
    materialName: material.name,
    type,
    qty,
    note,
    businessDate,
    by: user.id,
    byName: user.name,
    at: Timestamp.fromDate(now),
  })

  const onHand = applyMovement(material.onHand ?? 0, { type, qty })
  const patch = { onHand }

  if (type === RECEIVED) {
    patch.receivedSinceCount = (material.receivedSinceCount ?? 0) + qty
  } else if (type === SPOILAGE) {
    patch.spoiledSinceCount = (material.spoiledSinceCount ?? 0) + qty
  } else if (type === COUNT) {
    const previousAt = material.lastCountAt?.toDate?.()
    const days = previousAt ? (now - previousAt) / 86400000 : null
    const usage = usageBetweenCounts({
      previousCount: material.lastCountQty ?? null,
      receivedSince: material.receivedSinceCount ?? 0,
      spoiledSince: material.spoiledSinceCount ?? 0,
      countedNow: qty,
      days: days && days >= 0.5 ? days : null,
    })
    if (usage) patch.usagePerDay = Math.round(usage.perDay * 100) / 100
    patch.lastCountAt = Timestamp.fromDate(now)
    patch.lastCountQty = qty
    patch.receivedSinceCount = 0
    patch.spoiledSinceCount = 0
  }

  batch.update(doc(db, 'rawMaterials', material.id), patch)
  batch.commit().catch((error) => console.error('[bakery] stock movement failed to sync', error))
  return { onHand, ...patch }
}

export function archiveMaterial(id, archived) {
  return updateDoc(doc(db, 'rawMaterials', id), { active: !archived })
}

export { setDoc }
