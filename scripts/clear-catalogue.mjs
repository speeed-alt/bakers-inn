#!/usr/bin/env node
// Empty the catalogue so the counter can build it again from what actually
// arrives.
//
//   node scripts/clear-catalogue.mjs                                  # emulator
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/clear-catalogue.mjs --write --i-mean-it bakers-inn-pk
//
// Archives, never deletes. A product is what every sale, count, delivery note
// and report points at, and a deleted one turns a year of history into rows
// naming nothing. Archived, it stops appearing at the till and on every sheet,
// and every record that mentions it still reads.
//
// So this is reversible in the only way that matters: setting `active` back to
// true in the catalogue screen brings an item back exactly as it was, with its
// history intact. What it is not is free — the shop has no items at all until
// somebody adds them, and the till cannot sell what is not in the catalogue.

import { initAdmin } from './admin.mjs'
import { getFirestore } from 'firebase-admin/firestore'

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
        `This empties the catalogue at '${projectId}', and the till cannot sell\n` +
        'anything until somebody adds items again.\n',
    )
    process.exit(1)
  }
  if (live && !write) console.log(`\nDRY RUN against '${projectId}'. Nothing will be archived.\n`)

  const snap = await db.collection('products').get()
  const live_ = snap.docs.filter((d) => d.data().active !== false)

  for (const doc of live_) console.log(`  ${String(doc.data().code).padStart(3)}  ${doc.data().name}`)
  console.log(`\n  ${live_.length} items on sale, ${snap.size - live_.length} already archived.`)

  if (!live || write) {
    for (const chunk of chunks(live_, 400)) {
      const batch = db.batch()
      for (const doc of chunk) batch.set(doc.ref, { active: false }, { merge: true })
      await batch.commit()
    }
  }

  console.log(
    live && !write
      ? `\nNothing archived. Add --write --i-mean-it ${projectId}\n`
      : `\n✓ ${live_.length} items archived in '${projectId}'. The catalogue is empty.\n`,
  )
}

if (process.argv[1]?.endsWith('clear-catalogue.mjs')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
