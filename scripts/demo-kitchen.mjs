#!/usr/bin/env node
// Walk today's baking list through the kitchen and out to the shops, so the
// screens show a day in progress rather than an empty one.
//
//   SEED_PROJECT=… GOOGLE_APPLICATION_CREDENTIALS=… node scripts/demo-kitchen.mjs
//
// Run scripts/compile-now.mjs first — this needs a baking list to work from.
//
// It deliberately does not go perfectly. One line comes out of the oven short,
// one delivery arrives light with a reason, and the kitchen bakes a tray nobody
// ordered. Those three are what the shortfall, the variance and the extras
// screens exist for, and a demo where everything reconciles never shows them.

import { initAdmin } from './admin.mjs'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

import { businessDateOf } from '../src/lib/dates.js'
import { productionDocId } from '../src/lib/ids.js'


initAdmin()
const db = getFirestore()

const TODAY = process.argv[2] || businessDateOf()
const BAKER = { id: 'usman', name: 'Usman' }
const AT = Timestamp.fromDate(new Date(`${TODAY}T05:40:00`))

async function main() {
  const orderRef = db.collection('productionOrders').doc(productionDocId(TODAY, true))
  const snap = await orderRef.get()
  if (!snap.exists) {
    console.error(`No baking list for ${TODAY}. Run scripts/compile-now.mjs first.`)
    process.exit(1)
  }

  const order = snap.data()
  const items = order.items ?? []

  // Everything comes out as asked, except the third line, which is short. A
  // short bake is the interesting case: it is what makes the dispatcher choose
  // who gets what.
  const produced = {}
  const producedBy = {}
  let shortLine = null
  items.forEach((item, index) => {
    const needed = item.qtyNeeded ?? 0
    const made = index === 2 ? Math.max(0, Math.round(needed * 0.72)) : needed
    produced[item.productId] = made
    producedBy[item.productId] = BAKER.id
    if (made < needed) shortLine = { name: item.productName, needed, made }
  })

  await orderRef.set(
    {
      produced,
      producedBy,
      extras: {
        'donut-large': {
          productId: 'donut-large',
          code: '07',
          productName: 'Donut Large',
          qty: 18,
          by: BAKER.id,
          byName: BAKER.name,
          at: AT,
        },
      },
      status: 'done',
      doneBy: BAKER.id,
      doneByName: BAKER.name,
      doneAt: AT,
      updatedAt: AT,
    },
    { merge: true },
  )

  console.log(`✓ ${items.length} lines baked and recorded by ${BAKER.name}`)
  if (shortLine) {
    console.log(`  short: ${shortLine.name} — ${shortLine.made} of ${shortLine.needed}`)
  }
  console.log('  plus 18 Donut Large nobody ordered, waiting on Dispatch')

  // Send the notes. What was baked short is shared out rather than one shop
  // taking the whole loss.
  const transfers = await db
    .collection('transfers')
    .where('businessDate', '==', TODAY)
    .get()

  let sentCount = 0
  let receivedCount = 0

  for (const doc of transfers.docs) {
    const transfer = doc.data()
    if (transfer.direction === 'return' || transfer.status !== 'draft') continue

    const sentItems = transfer.items.map((item) => {
      const asked = item.qtyDemanded ?? 0
      const made = produced[item.productId]
      const line = items.find((i) => i.productId === item.productId)
      const needed = line?.qtyNeeded ?? asked
      // Give this outlet its share of whatever came out of the oven.
      const share = needed > 0 && made < needed ? Math.floor((asked * made) / needed) : asked
      return { ...item, qtySent: share, qtyReceived: null }
    })

    await doc.ref.set(
      {
        items: sentItems,
        status: 'dispatched',
        dispatchedBy: BAKER.id,
        dispatchedByName: BAKER.name,
        dispatchedAt: Timestamp.fromDate(new Date(`${TODAY}T06:30:00`)),
      },
      { merge: true },
    )
    sentCount += 1

    // Gulberg counts one line light. Both numbers are kept, and the reason with
    // them — a short delivery is never quietly turned into that shop's waste.
    const isGulberg = transfer.toBranchId === 'B2'
    const countedItems = sentItems.map((item, index) => {
      const light = isGulberg && index === 0 && item.qtySent > 2
      return {
        ...item,
        qtyReceived: light ? item.qtySent - 2 : item.qtySent,
        ...(light ? { shortReason: 'Damaged in transit' } : {}),
      }
    })

    await doc.ref.set(
      {
        items: countedItems,
        status: 'received',
        receivedBy: transfer.toBranchId === 'B2' ? 'bilal' : 'hina',
        receivedByName: transfer.toBranchId === 'B2' ? 'Bilal' : 'Hina',
        receivedAt: Timestamp.fromDate(new Date(`${TODAY}T07:15:00`)),
      },
      { merge: true },
    )
    receivedCount += 1
  }

  console.log(`✓ ${sentCount} delivery notes sent, ${receivedCount} counted in at the shops`)
  console.log('  Gulberg counted one line two short — reason recorded, both figures kept')
  console.log('\nThe Stock screen should now show real quantities, worth and sold.')
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('\nKitchen run failed.\n')
    console.error(error)
    process.exit(1)
  },
)
