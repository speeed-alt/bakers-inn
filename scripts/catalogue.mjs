#!/usr/bin/env node
// The shop's price list, as the owner keeps it, written into the catalogue.
//
//   node scripts/catalogue.mjs                       # emulator, writes
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/catalogue.mjs                     # real project, DRY RUN
//   … node scripts/catalogue.mjs --write             # real project, for real
//
// A real project needs `--write` on top of the credentials. Rebuilding a live
// catalogue is not a thing to do by pressing up-arrow and Enter in the wrong
// terminal.
//
// ---------------------------------------------------------------------------
//
// The owner keeps prices as twenty tiers, not as sixty products: a serial
// number, a price, and the list of things that cost that much. That is not a
// simplification of his catalogue — it *is* his catalogue, and it is how the
// counter already works. Staff know that a Nutella and a Red Velvet are both
// "two thousand".
//
// The system already had the shape for it. A product carries `variants`, the
// cashier types one code and picks which one, and the chosen name is copied
// onto the sale line — so the stock sheet says "12 cakes at 2,000 left" while
// the customer's receipt still says Nutella. What the merge card in the
// catalogue screen does two products at a time, this does for the whole list.
//
// What it costs, said plainly: once four cakes share an id the system knows
// four sold and cannot say which four. For a shop that prices them identically
// and bakes them to order, that is a trade the owner has already made on paper.

import { initAdmin } from './admin.mjs'
import { getFirestore } from 'firebase-admin/firestore'
import { DEFAULT_WEIGHT_UNIT } from '../src/lib/quantity.js'

/**
 * The price list. One row per serial number on the owner's sheet.
 *
 * `code` is what the cashier types — the serial number itself, so the sheet on
 * the counter and the till agree with no translation in anybody's head. No
 * zero padding: the entry box takes Enter, so `1` and `12` cannot be confused.
 *
 * `id` is the document id and must never change once the shop is trading,
 * because every sale, stock count and delivery note points at it. It is built
 * from category and price rather than from the serial, so renumbering the
 * printed sheet cannot orphan a year of history.
 *
 * `keeps` is whether tomorrow may sell what today did not. Wrong one way it
 * carries stale stock forward; wrong the other it writes off good stock as
 * waste. Everything here is same-day except the biscuits, which is the safe
 * way round — see the notes on rows 11 and 16.
 */
export const CATALOGUE = [
  { code: '1', id: 'cakes-2200', name: 'Premium Cake', category: 'Cakes', price: 2200, keeps: false,
    variants: ['3Milk Cake', 'Lotus'] },

  { code: '2', id: 'cakes-2000', name: 'Fudge & Velvet Cake', category: 'Cakes', price: 2000, keeps: false,
    variants: ['Chocolate Fudge', 'Cadbury Caramel', 'Nutella', 'Red Velvet'] },

  { code: '3', id: 'cakes-1800', name: 'Kit Kat & Oreo Cake', category: 'Cakes', price: 1800, keeps: false,
    variants: ['Kit Kat', 'Ferrero', 'Oreo', 'Candy'] },

  { code: '4', id: 'cakes-1600', name: 'Coffee & Choc Stick Cake', category: 'Cakes', price: 1600, keeps: false,
    variants: ['Coffee', 'Chocolate Stick'] },

  // The six biscuit names printed on this row of the sheet are not here. They
  // are row 19, priced by weight. Leaving them on both rows would give the shop
  // two codes for one biscuit, one of them charging a kilo price for a single
  // cookie. CONFIRM WITH THE OWNER: if "Biscuit Candy" and the rest really are
  // cakes at 1,400 each rather than the loose biscuits written down twice, add
  // them back here.
  { code: '5', id: 'cakes-1400', name: 'Regular Cake', category: 'Cakes', price: 1400, keeps: false,
    variants: ['Chocolate Chip', 'Black Forest', 'Pineapple Mix Fruit', 'Dry Chocolate Fudge'] },

  { code: '6', id: 'cakes-1200', name: 'Almond Cake', category: 'Cakes', price: 1200, keeps: false,
    variants: ['Almond Simple', 'Almond Honey', 'Lemon Pista'] },

  { code: '7', id: 'cakes-1000', name: 'Caramel & Brownie 1 lb', category: 'Cakes', price: 1000, keeps: false,
    variants: ['Caramel 1 Pound', 'Brownie'] },

  { code: '8', id: 'cakes-700', name: 'Regular Cake 1 lb', category: 'Cakes', price: 700, keeps: false,
    variants: ['Chocolate Chip 1 Pound', 'Black Forest 1 Pound', 'Pineapple Mix Fruit 1 Pound',
      'Dry Chocolate Fudge 1 Pound'] },

  { code: '9', id: 'cakes-600', name: 'Almond Cake 1 lb', category: 'Cakes', price: 600, keeps: false,
    variants: ['Almond Simple 1 Pound', 'Almond Honey 1 Pound', 'Lemon Pista 1 Pound'] },

  { code: '10', id: 'cakes-400', name: 'Simple & Fruit Cake', category: 'Cakes', price: 400, keeps: false,
    variants: ['Simple Cake', 'Fruit Cake'] },

  // Carries Special Rusk, which does keep, merged with breads that do not. The
  // group is set to same day, so a leftover rusk is written off rather than
  // carried forward as stock that may not be there. That is the honest way
  // round, and it is a real cost of merging by price.
  { code: '11', id: 'bread-300', name: 'Chicken & Grain Bread', category: 'Bread', price: 300, keeps: false,
    variants: ['Chicken Bread', 'Multi Grain Bread', 'Special Rusk', 'Lotus'] },

  { code: '12', id: 'bread-220', name: 'Big Bread & Tikka Sandwich', category: 'Bread', price: 220, keeps: false,
    variants: ['Big Bread', 'Tikka Sandwich'] },

  { code: '13', id: 'cakes-200', name: 'Special Pastry', category: 'Cakes', price: 200, keeps: false,
    variants: ['Special Pastry Caramel', 'Brownie Kit Kat', 'Red Velvet', 'Candy'] },

  { code: '14', id: 'bakery-200', name: 'Buns & Oreo', category: 'Bakery', price: 200, keeps: false,
    variants: ['Oreo', 'Mini Burger Bun', 'Large Burger Bun'] },

  { code: '15', id: 'savoury-170', name: 'Sandwich', category: 'Savoury', price: 170, keeps: false,
    variants: ['Club Sandwich', 'Chicken Sandwich'] },

  // Carries Rusk — same note as row 11.
  { code: '16', id: 'bakery-150', name: 'Muffin, Rusk & Dry Pastry', category: 'Bakery', price: 150, keeps: false,
    variants: ['Muffin Cup', 'Sundae Cup', 'Rusk', 'Dry Pastry', 'Fry Sandwich'] },

  { code: '17', id: 'savoury-120', name: 'Small Bread & Chicken Roll', category: 'Savoury', price: 120, keeps: false,
    variants: ['Small Bread', 'Chicken Roll', 'Chicken Pie'] },

  { code: '18', id: 'bakery-100', name: 'Pastry & Patties', category: 'Bakery', price: 100, keeps: false,
    variants: ['Pineapple Pastry', 'Chocolate Ball', 'Chicken Patties', 'Chicken Pastry', 'Large Donut',
      'Lemon Tat'] },

  // Sold loose off the scales. The sheet says 1,400, which is the price of a
  // kilo — nobody here pays 1,400 for one cookie. The till counts 250 g
  // portions, so the stored price is a quarter of it and four portions ring up
  // as exactly the 1,400 the shelf says.
  //
  // The id is kept from the old catalogue deliberately: this is the one product
  // with sales and stock already behind it, and a new id would cut them off
  // from the thing they were sold as.
  { code: '19', id: 'biscuits', name: 'Biscuits', category: 'Bakery', price: 350, keeps: true, weighed: true,
    variants: ['Candy', 'Peanut', 'Brown Sugar Cookie', 'Badam Special', 'Khajoor', 'Gol Badam Cookie'] },

  // One thing, so no variants: a picker with a single choice is a keystroke
  // that asks the cashier a question with one answer.
  { code: '20', id: 'savoury-50', name: 'Chicken Samosa', category: 'Savoury', price: 50, keeps: false,
    variants: [] },
]

/** What a row becomes in Firestore. */
export function documentFor(row) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    price: row.price,
    sellsNextDay: Boolean(row.keeps),
    soldByWeight: Boolean(row.weighed),
    unit: row.weighed ? DEFAULT_WEIGHT_UNIT : null,
    // One name is not a choice. Written as an empty list rather than left out,
    // so a product that used to have variants loses them cleanly.
    variants: row.variants.length > 1 ? row.variants : [],
    active: true,
  }
}

async function main() {
  const write = process.argv.includes('--write')
  const { projectId, useEmulator } = initAdmin()
  const live = !useEmulator
  const db = getFirestore()

  if (live && !write) console.log(`\nDRY RUN against '${projectId}'. Add --write to do it for real.\n`)

  const keep = new Set(CATALOGUE.map((row) => row.id))
  const existing = await db.collection('products').get()
  const retiring = existing.docs.filter((d) => !keep.has(d.id) && d.data().active !== false)

  for (const row of CATALOGUE) {
    console.log(
      `  ${row.code.padStart(2)}  ${row.name} · Rs ${row.price}` +
        (row.weighed ? ` per ${DEFAULT_WEIGHT_UNIT}` : '') +
        (row.variants.length > 1 ? ` · ${row.variants.length} names` : ''),
    )
    // merge:true, because the owner may have set things from the app that this
    // table has no opinion about, and a plain set would drop them silently.
    if (!live || write) await db.collection('products').doc(row.id).set(documentFor(row), { merge: true })
  }

  console.log(`\n  ${retiring.length} products are no longer on the price list:`)
  for (const doc of retiring) console.log(`    ${doc.data().code}  ${doc.data().name}`)
  console.log(
    '  Archived, never deleted — every sale ever rung against them still has to\n' +
      '  make sense, and each carries its own name and price.',
  )
  if (!live || write) for (const doc of retiring) await doc.ref.set({ active: false }, { merge: true })

  console.log(
    live && !write
      ? '\nNothing written. Add --write.\n'
      : `\n✓ ${CATALOGUE.length} products, ${retiring.length} archived, in '${projectId}'.\n`,
  )
}

if (process.argv[1]?.endsWith('catalogue.mjs')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
