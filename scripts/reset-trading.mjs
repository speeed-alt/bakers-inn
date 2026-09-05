#!/usr/bin/env node
// Take a shop back to day one, keeping everything that is not a day's trading.
//
//   node scripts/reset-trading.mjs                                   # emulator
//   SEED_PROJECT=bakers-inn-pk USE_ADC=1 node scripts/reset-trading.mjs
//   SEED_PROJECT=bakers-inn-pk USE_ADC=1 node scripts/reset-trading.mjs \
//     --write --i-mean-it bakers-inn-pk
//
// A real project needs `--write` **and** the project id typed out after
// `--i-mean-it`. Two flags for one command is usually a smell; here it is the
// point. Everything else in this repo either adds or archives, and can be undone
// by running it again. This deletes a shop's books and there is no undo, so it
// should not be reachable by pressing up-arrow in the wrong terminal.
//
// ---------------------------------------------------------------------------
//
// What this is for: a shop that has been practising, or has been set up and
// poked at, and now wants to open on Monday with nothing behind it. Trial sales
// left in place are not harmless. `lib/suggest.js` reads old reports to decide
// how much to bake, the P&L reads expenses, the days-left figure reads the
// material counts, and the close wizard reads yesterday's closing to know what
// the shelf opened with. Every one of those turns a fortnight of invented
// trading into a real decision, weeks later, with nothing on screen to say so.
//
// It deletes regardless of the practice or demo flag. Records made in practice
// mode are already invisible to the app, but a shop starting fresh wants them
// gone too, and the accidental ones — rung up before anybody thought to turn
// practice on — carry no flag at all and are exactly what this is for.
//
// What it keeps: the catalogue, the outlets, the staff and their PINs, and the
// raw material *definitions*. What it resets: the running counters on those
// materials, because an on-hand figure is a day's trading wearing a definition's
// clothes.

import { initAdmin } from './admin.mjs'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

/**
 * Everything that is a record of trading rather than a description of the shop.
 *
 * Adding a collection to the system means adding it here. Missing one does not
 * fail — it leaves a quiet residue that outlives the reset and gets read as
 * fact. `expenses` was missing from the equivalent list in demo-day.mjs until
 * August, which left about Rs 346,000 of fabricated wages in the owner's profit
 * figure after a clear that reported success.
 */
const TRADING = [
  'sales',
  'closings',
  'transfers',
  'demands',
  'productionOrders',
  'dailyReports',
  'dailyRates',
  'purchases',
  'expenses',
  'stockMovements',
  'shelfAdjustments',
  'clientErrors',
]

/** Kept, and named here so the list is a decision rather than an omission. */
const KEPT = ['products', 'branches', 'users', 'rawMaterials (definitions only)']

function chunks(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const confirmed = argv[argv.indexOf('--i-mean-it') + 1]

  const { projectId, useEmulator } = initAdmin()
  const live = !useEmulator
  const db = getFirestore()

  if (live && write && confirmed !== projectId) {
    console.error(
      `\nRefusing: --write needs '--i-mean-it ${projectId}' as well.\n` +
        'This deletes every sale, close, delivery note, order and report in\n' +
        `'${projectId}', and there is no undo.\n`,
    )
    process.exit(1)
  }
  if (live && !write) console.log(`\nDRY RUN against '${projectId}'. Nothing will be deleted.\n`)

  let total = 0
  for (const name of TRADING) {
    const snap = await db.collection(name).get()
    if (snap.empty) {
      console.log(`  ${name.padEnd(18)} already empty`)
      continue
    }
    console.log(`  ${name.padEnd(18)} ${String(snap.size).padStart(5)} to remove`)
    total += snap.size
    if (!live || write) {
      for (const chunk of chunks(snap.docs, 400)) {
        const batch = db.batch()
        for (const d of chunk) batch.delete(d.ref)
        await batch.commit()
      }
    }
  }

  // Definitions stay, counters go. An on-hand figure is a day's trading wearing
  // a definition's clothes, and leaving it means the first real stock count is
  // measured against a number somebody invented while testing.
  const materials = await db.collection('rawMaterials').get()
  console.log(`  ${'rawMaterials'.padEnd(18)} ${String(materials.size).padStart(5)} counters reset`)
  if (!live || write) {
    for (const chunk of chunks(materials.docs, 400)) {
      const batch = db.batch()
      for (const d of chunk) {
        batch.set(
          d.ref,
          {
            onHand: 0,
            receivedSinceCount: 0,
            spoiledSinceCount: 0,
            lastCountQty: 0,
            lastCountAt: FieldValue.delete(),
            usagePerDay: FieldValue.delete(),
          },
          { merge: true },
        )
      }
      await batch.commit()
    }
  }

  console.log(`\n  Kept: ${KEPT.join(', ')}.`)
  console.log(
    live && !write
      ? `\n${total} records would be deleted. Add --write --i-mean-it ${projectId}\n`
      : `\n✓ ${total} trading records removed from '${projectId}'. Day one.\n`,
  )
}

if (process.argv[1]?.endsWith('reset-trading.mjs')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

export { TRADING }
