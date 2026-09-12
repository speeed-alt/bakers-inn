#!/usr/bin/env node
// Permanently delete archived products.
//
//   node scripts/delete-archived-products.mjs                          # emulator
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/delete-archived-products.mjs --write --i-mean-it bakers-inn-pk \
//     [--backup path/to/backup.json]
//
// The rest of this system archives and never deletes, and the rules still say so
// for every client: a product is what sales, counts, delivery notes and reports
// point at. This exists because the owner asked on 2026-09-12 for the old
// catalogue to be gone, not hidden — the shop is starting its item list from
// scratch at the counter, and a list of 133 archived items with Restore buttons
// is clutter he does not want.
//
// What survives a delete: every sale line carries its own name and price, so
// receipts and takings still read. What does not: anything that looks a product
// up by id to find its name — a stock line or delivery note from before, which
// on a freshly reset shop there are none of.
//
// Only archived products. Anything active is on sale and left alone, so this
// can never empty a working till.

import { writeFileSync } from 'node:fs'
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
  const backupAt = argv.includes('--backup') ? argv[argv.indexOf('--backup') + 1] : null

  const { projectId, useEmulator } = initAdmin()
  const live = !useEmulator
  const db = getFirestore()

  if (live && write && confirmed !== projectId) {
    console.error(
      `\nRefusing: --write needs '--i-mean-it ${projectId}' as well.\n` +
        `This permanently deletes every archived product in '${projectId}', and\n` +
        'nothing in the app can bring them back.\n',
    )
    process.exit(1)
  }
  if (live && !write) console.log(`\nDRY RUN against '${projectId}'. Nothing will be deleted.\n`)

  const snap = await db.collection('products').get()
  const archived = snap.docs.filter((d) => d.data().active === false)
  const onSale = snap.size - archived.length

  console.log(`  ${archived.length} archived products to delete, ${onSale} on sale left alone.`)

  if (backupAt) {
    const copy = archived.map((d) => ({ id: d.id, ...d.data() }))
    writeFileSync(backupAt, JSON.stringify(copy, null, 2))
    console.log(`  Copy of all ${copy.length} saved to ${backupAt}`)
  }

  if (!live || write) {
    for (const chunk of chunks(archived, 400)) {
      const batch = db.batch()
      for (const doc of chunk) batch.delete(doc.ref)
      await batch.commit()
    }
  }

  console.log(
    live && !write
      ? `\nNothing deleted. Add --write --i-mean-it ${projectId}\n`
      : `\n✓ ${archived.length} archived products deleted from '${projectId}'. ${onSale} on sale.\n`,
  )
}

if (process.argv[1]?.endsWith('delete-archived-products.mjs')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
