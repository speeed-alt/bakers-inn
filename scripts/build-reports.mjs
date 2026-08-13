#!/usr/bin/env node
// Compile each outlet's closed day into its daily report.
//
//   SEED_PROJECT=… GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/build-reports.mjs [YYYY-MM-DD]
//
// Defaults to yesterday, which is what the morning run wants. Give it a date to
// rebuild a particular day.
//
// The same work as `reportOnClose` and `rebuildYesterdaysReports` in
// functions/index.js, sharing `buildDailyReport` from src/lib so the figures
// cannot differ. Until the Cloud Functions can be deployed, this is what writes
// the reports the owner's Waste and Gross margin panels read.
//
// Rebuilt rather than patched, so running it again is always safe — and it has
// to be. A till that was offline at closing time syncs its sales later, and the
// first version of a report would be missing them.
//
// It rebuilds from the closing and the raw sales, which means it only produces
// sensible figures for a day that was actually closed through the wizard. Run
// against the synthetic closings that `demo-day.mjs` writes it will overwrite
// their reports with recomputed ones and lose the waste figures — the demo's
// closings are shaped for the screens, not for this. Re-run demo-day.mjs to put
// them back.

import { initAdmin } from './admin.mjs'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { buildDailyReport, carryoverFrom } from '../src/lib/dailyReport.js'
import { closingDocId, productionDocId, reportDocId, reportRef } from '../src/lib/ids.js'
import { businessDateOf, previousDate } from '../src/lib/dates.js'
import { HUB_BRANCH_ID } from '../src/config.js'


const { projectId } = initAdmin()
const db = getFirestore()

const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
const businessDate = dateArg || previousDate(businessDateOf())

async function buildFor(branchId) {
  const [closingSnap, salesSnap, transfersSnap, productionSnap, previousSnap, productsSnap] =
    await Promise.all([
      db.collection('closings').doc(closingDocId(businessDate, branchId)).get(),
      db
        .collection('sales')
        .where('branchId', '==', branchId)
        .where('businessDate', '==', businessDate)
        .get(),
      db
        .collection('transfers')
        .where('toBranchId', '==', branchId)
        .where('businessDate', '==', businessDate)
        .get(),
      db.collection('productionOrders').doc(productionDocId(businessDate)).get(),
      db.collection('closings').doc(closingDocId(previousDate(businessDate), branchId)).get(),
      db.collection('products').get(),
    ])

  if (!closingSnap.exists) return null

  const report = buildDailyReport({
    branchId,
    businessDate,
    ref: reportRef(businessDate, branchId),
    sales: salesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    closing: closingSnap.data(),
    transfersIn: transfersSnap.docs.map((d) => d.data()).filter((t) => t.direction !== 'return'),
    production: productionSnap.exists ? productionSnap.data() : null,
    carriedIn: carryoverFrom(previousSnap.exists ? previousSnap.data() : null),
    products: productsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    mainId: HUB_BRANCH_ID,
  })

  await db
    .collection('dailyReports')
    .doc(reportDocId(businessDate, branchId))
    .set({ ...report, builtAt: FieldValue.serverTimestamp() })

  return report
}

async function main() {
  const branches = await db.collection('branches').get()
  console.log(`Building reports for ${businessDate}\n`)

  let built = 0
  for (const branch of branches.docs) {
    const report = await buildFor(branch.id)
    if (!report) {
      console.log(`  ${branch.id.padEnd(6)} not closed — nothing to report`)
      continue
    }
    built += 1
    console.log(
      `  ${branch.id.padEnd(6)} ${String(report.salesTotal).padStart(8)} takings · ` +
        `${String(report.wasteValue).padStart(6)} binned · ` +
        `${report.reconciles ? 'reconciles' : 'DOES NOT RECONCILE'}`,
    )
  }

  console.log(`\n${built} of ${branches.size} outlets reported.`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('\nReport build failed.\n')
    console.error(error)
    process.exit(1)
  },
)
