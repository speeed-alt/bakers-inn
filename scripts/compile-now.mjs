#!/usr/bin/env node
// Build today's baking list now, without waiting for 5am — and without the
// Cloud Functions, which need the Blaze plan.
//
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/compile-now.mjs [YYYY-MM-DD]
//
// This does exactly what `compileDailyOrders` does in functions/index.js, and
// deliberately shares the arithmetic: `compileDemands` is imported from
// src/lib, which is the same module the function uses through its copy in
// functions/shared. Only the plumbing differs — admin credentials here, a
// scheduler there — so the two cannot produce different baking lists.
//
// It is safe to run twice. The list is a natural key, orders already locked
// stay locked, and a delivery note already on its way is left alone.

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { compileDemands } from '../src/lib/compile.js'
import {
  demandDocId,
  demandRef,
  productionDocId,
  productionRef,
  transferDocId,
  transferRef,
} from '../src/lib/ids.js'
import { addDays, businessDateOf } from '../src/lib/dates.js'
import { HISTORY_WEEKS } from '../src/config.js'

const projectId = process.env.SEED_PROJECT || process.env.GCLOUD_PROJECT
if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set SEED_PROJECT and GOOGLE_APPLICATION_CREDENTIALS first.')
  process.exit(1)
}

initializeApp({ projectId, credential: applicationDefault() })
const db = getFirestore()

const SUBMITTED = ['submitted', 'locked']
const args = process.argv.slice(2)

// `--demo` stamps what this run creates so `demo-day.mjs --clear` can take it
// out again. Deliberately opt-in: the clear only ever removes flagged records,
// so once this system is live nothing it writes can be swept away by accident.
const DEMO = args.includes('--demo')
const demo = DEMO ? { demo: true } : {}
const targetDate = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || businessDateOf()

/** What this outlet ordered on the last same weekday it traded. */
async function lastSameWeekday(branchId, businessDate) {
  for (let week = 1; week <= HISTORY_WEEKS; week += 1) {
    const past = addDays(businessDate, -7 * week)
    const snap = await db.collection('demands').doc(demandDocId(past, branchId)).get()
    if (!snap.exists) continue
    const doc = { id: snap.id, ...snap.data() }
    if (doc.status !== 'draft' && (doc.items?.length ?? 0) > 0) return doc
  }
  return null
}

async function main() {
  const [branchesSnap, demandsSnap, existingSnap] = await Promise.all([
    db.collection('branches').get(),
    db.collection('demands').where('businessDate', '==', targetDate).get(),
    db.collection('productionOrders').doc(productionDocId(targetDate)).get(),
  ])

  const branches = branchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const demands = demandsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const existing = existingSnap.exists ? { id: existingSnap.id, ...existingSnap.data() } : null

  const fallbacks = {}
  for (const branch of branches) {
    if (demands.find((d) => d.branchId === branch.id && SUBMITTED.includes(d.status))) continue
    const past = await lastSameWeekday(branch.id, targetDate)
    if (past) fallbacks[branch.id] = past
  }

  const result = compileDemands({ branches, demands, fallbacks, existing })

  if (result.items.length === 0) {
    console.log(`Nothing to compile for ${targetDate}.`)
    if (result.missing?.length) {
      console.log(`No order and no history for: ${result.missing.join(', ')}`)
    }
    return
  }

  const knownBefore = new Set((existing?.items ?? []).map((i) => i.productId))
  const gainedLines = result.items.some((i) => !knownBefore.has(i.productId))
  const status = !existing ? 'open' : gainedLines ? 'open' : (existing.status ?? 'open')

  const batch = db.batch()

  batch.set(
    db.collection('productionOrders').doc(productionDocId(targetDate)),
    {
      ...demo,
      ref: productionRef(targetDate),
      businessDate: targetDate,
      status,
      items: result.items,
      compiledFrom: result.compiledFrom,
      autoFilled: result.autoFilled,
      missing: result.missing,
      compiledAt: FieldValue.serverTimestamp(),
      ...(existing ? {} : { produced: {}, producedBy: {} }),
    },
    { merge: true },
  )

  for (const branch of branches) {
    const own = demands.find((d) => d.branchId === branch.id && SUBMITTED.includes(d.status))
    if (own) {
      batch.update(db.collection('demands').doc(own.id), { status: 'locked' })
      continue
    }
    const fallback = fallbacks[branch.id]
    if (!fallback) continue
    batch.set(db.collection('demands').doc(demandDocId(targetDate, branch.id)), {
      ref: demandRef(targetDate, branch.id),
      branchId: branch.id,
      businessDate: targetDate,
      status: 'locked',
      auto: true,
      copiedFrom: fallback.id,
      items: fallback.items,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  const existingTransfers = await db
    .collection('transfers')
    .where('businessDate', '==', targetDate)
    .get()
  const alreadyMoving = new Set(
    existingTransfers.docs.filter((d) => d.data().status !== 'draft').map((d) => d.id),
  )

  for (const transfer of result.transfers) {
    const id = transferDocId(targetDate, transfer.toBranchId)
    if (alreadyMoving.has(id)) {
      console.log(`  ${id} is already on its way — left alone`)
      continue
    }
    batch.set(
      db.collection('transfers').doc(id),
      {
        ...demo,
        ref: transferRef(targetDate, transfer.toBranchId),
        fromBranch: result.mainId,
        toBranchId: transfer.toBranchId,
        businessDate: targetDate,
        direction: 'out',
        status: 'draft',
        poRef: productionRef(targetDate),
        items: transfer.items.map((i) => ({ ...i, qtySent: null, qtyReceived: null })),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  await batch.commit()

  console.log(`Baking list ${productionRef(targetDate)} compiled for ${targetDate}`)
  console.log(`  ${result.items.length} lines from ${result.compiledFrom.length} outlet orders`)
  if (result.autoFilled?.length) {
    console.log(`  repeated last week for: ${result.autoFilled.join(', ')}`)
  }
  if (result.missing?.length) {
    console.log(`  no order and no history: ${result.missing.join(', ')}`)
  }
  console.log(`  ${result.transfers.length} delivery notes ready on Dispatch`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('\nCompile failed.\n')
    console.error(error)
    process.exit(1)
  },
)
