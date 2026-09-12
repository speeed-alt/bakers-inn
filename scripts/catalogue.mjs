#!/usr/bin/env node
// The shop's price list, as the owner keeps it, written into the catalogue.
//
//   node scripts/catalogue.mjs                       # emulator, writes
//
// Against the real shop, from Cloud Shell — where the owner is already signed
// in, so there is no private key to download and leave lying about:
//
//   SEED_PROJECT=bakers-inn-pk USE_ADC=1 node scripts/catalogue.mjs   # DRY RUN
//   SEED_PROJECT=bakers-inn-pk USE_ADC=1 node scripts/catalogue.mjs --write
//
// Or from a laptop, with a service-account key:
//
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/catalogue.mjs [--write]
//
// A real project needs `--write` on top of the credentials. Rebuilding a live
// catalogue is not a thing to do by pressing up-arrow and Enter in the wrong
// terminal.
//
// ---------------------------------------------------------------------------
//
// **One product per name, several products per code.**
//
// The owner prices in twenty tiers — a serial number, a price, and the things
// that cost that much — and that is how the counter works: staff know a Nutella
// and a Red Velvet are both "two thousand". The first version of this file made
// each *tier* one product, with the names as labels chosen at the moment of
// sale. It sold beautifully and counted badly: stock, the baking list, the
// delivery notes and the closing count all key on the product, so the whole
// system could say "four cakes at 2,000 left" and never which four. The owner
// asked for stock per item, which means the item has to be the product.
//
// So a name is a product now, and the code is shared by everything in its tier.
// Nothing about typing changes: an exact code still outranks every other match,
// so typing 2 lists the four cakes at 2,000 and the cashier picks one — the same
// two keystrokes as before, against four real stock lines instead of one.
//
// What it costs: every daily sheet is sixty-eight rows rather than twenty-two.
// That is the trade the owner made deliberately, on 2026-09-12.

import { initAdmin } from './admin.mjs'
import { getFirestore } from 'firebase-admin/firestore'
import { DEFAULT_WEIGHT_UNIT } from '../src/lib/quantity.js'

/**
 * The price list, one row per line of the owner's sheet.
 *
 * `code` is the serial number on that sheet, shared by every name in the tier,
 * so the printed card on the counter and the till agree with no translation in
 * anybody's head. No zero padding: the entry box takes Enter, so 1 and 12
 * cannot be confused. The old catalogue's two-digit codes (01…44) belong to
 * products that are archived now, which is why both styles show in the
 * catalogue screen and only one of them sells.
 *
 * `keeps` is whether tomorrow may sell what today did not. Everything here is
 * same-day except the biscuits, which is the safe way round: wrong that way
 * writes off good stock, wrong the other way carries stale stock forward.
 */
const TIERS = [
  { code: '1', price: 2200, category: 'Cakes', names: ['3Milk Cake', 'Lotus'] },
  { code: '2', price: 2000, category: 'Cakes', names: ['Chocolate Fudge', 'Cadbury Caramel', 'Nutella', 'Red Velvet'] },
  { code: '3', price: 1800, category: 'Cakes', names: ['Kit Kat', 'Ferrero', 'Oreo', 'Candy'] },
  { code: '4', price: 1600, category: 'Cakes', names: ['Coffee', 'Chocolate Stick'] },
  { code: '5', price: 1400, category: 'Cakes', names: ['Chocolate Chip', 'Black Forest', 'Pineapple Mix Fruit', 'Dry Chocolate Fudge'] },
  { code: '6', price: 1200, category: 'Cakes', names: ['Almond Simple', 'Almond Honey', 'Lemon Pista'] },
  { code: '7', price: 1000, category: 'Cakes', names: ['Caramel 1 Pound', 'Brownie'] },
  { code: '8', price: 700, category: 'Cakes', names: ['Chocolate Chip 1 Pound', 'Black Forest 1 Pound', 'Pineapple Mix Fruit 1 Pound', 'Dry Chocolate Fudge 1 Pound'] },
  { code: '9', price: 600, category: 'Cakes', names: ['Almond Simple 1 Pound', 'Almond Honey 1 Pound', 'Lemon Pista 1 Pound'] },
  { code: '10', price: 400, category: 'Cakes', names: ['Simple Cake', 'Fruit Cake'] },
  // Carries Special Rusk, which keeps, among breads that do not. Set same-day:
  // a rusk written off is a small loss, a rusk carried forward that is not
  // there is a shelf figure nobody can trust.
  { code: '11', price: 300, category: 'Bread', names: ['Chicken Bread', 'Multi Grain Bread', 'Special Rusk', 'Lotus'] },
  { code: '12', price: 220, category: 'Bread', names: ['Big Bread', 'Tikka Sandwich'] },
  { code: '13', price: 200, category: 'Cakes', names: ['Special Pastry Caramel', 'Brownie Kit Kat', 'Red Velvet', 'Candy'] },
  { code: '14', price: 200, category: 'Bakery', names: ['Oreo', 'Mini Burger Bun', 'Large Burger Bun'] },
  { code: '15', price: 170, category: 'Savoury', names: ['Club Sandwich', 'Chicken Sandwich'] },
  { code: '16', price: 150, category: 'Bakery', names: ['Muffin Cup', 'Sundae Cup', 'Rusk', 'Dry Pastry', 'Fry Sandwich'] },
  { code: '17', price: 120, category: 'Savoury', names: ['Small Bread', 'Chicken Roll', 'Chicken Pie'] },
  { code: '18', price: 100, category: 'Bakery', names: ['Pineapple Pastry', 'Chocolate Ball', 'Chicken Patties', 'Chicken Pastry', 'Large Donut', 'Lemon Tat'] },
  // Sold loose off the scales. The sheet says 1,400, which is the price of a
  // kilo — nobody here pays 1,400 for one cookie. The till counts 250 g
  // portions, so the stored price is a quarter of it and four portions ring up
  // as exactly the 1,400 the shelf says.
  { code: '19', price: 350, category: 'Bakery', weighed: true, keeps: true, names: ['Candy', 'Peanut', 'Brown Sugar Cookie', 'Badam Special', 'Khajoor', 'Gol Badam Cookie'] },
  { code: '20', price: 50, category: 'Savoury', names: ['Chicken Samosa'] },
  // Added at the counter after the sheet was printed, and given codes 35 and 54
  // by hand — which is why they sat below 20 in every list, since the lists read
  // in code order. Numbered on from 20 instead.
  { code: '21', price: 120, category: 'Other', names: ['Soda'] },
  { code: '22', price: 200, category: 'Other', names: ['Sweet Candy'] },
]

const slug = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * One product per name.
 *
 * The document id carries the tier as well as the name, because names repeat
 * across tiers on purpose: an Oreo cake at 1,800 and an Oreo bun at 200 are
 * different things that share a word, and so are the three Candys. The id must
 * never change once the shop is trading — every sale, count and delivery note
 * points at it.
 *
 * `seq` is the position on the owner's sheet. Ties on code sort by it, so the
 * four cakes at 2,000 read in the order he wrote them rather than alphabetically.
 */
export const CATALOGUE = TIERS.flatMap((tier) =>
  tier.names.map((name, index) => ({
    code: tier.code,
    id: `t${tier.code}-${slug(name)}`,
    name,
    category: tier.category,
    price: tier.price,
    keeps: Boolean(tier.keeps),
    weighed: Boolean(tier.weighed),
    seq: Number(tier.code) * 100 + index,
  })),
)

export { TIERS }

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
    seq: row.seq,
    // Emptied rather than left out. These documents are new, but a catalogue
    // rebuilt over an older one must not keep a list of names underneath a
    // product that is now a single item — the till would offer a choice that no
    // longer means anything.
    variants: [],
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

  let lastCode = null
  for (const row of CATALOGUE) {
    const head = row.code === lastCode ? '    ' : `  ${row.code.padStart(2)}`
    lastCode = row.code
    console.log(
      `${head}  ${row.name} · Rs ${row.price}${row.weighed ? ` per ${DEFAULT_WEIGHT_UNIT}` : ''}`,
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
      : `\n✓ ${CATALOGUE.length} products under ${TIERS.length} codes, ${retiring.length} archived, in '${projectId}'.\n`,
  )
}

if (process.argv[1]?.endsWith('catalogue.mjs')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
