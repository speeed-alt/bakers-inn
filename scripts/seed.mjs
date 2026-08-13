#!/usr/bin/env node
// Seed the local emulators with the three outlets, the starting staff, and a
// realistic product list. Safe to run repeatedly — every write is by a fixed id.
//
//   npm run emulators     (in one terminal)
//   npm run seed          (in another)

// Which project to seed. A 'demo-' id means the emulators; anything else is a
// real cloud project, and the emulator hosts must stay unset or every write
// would go to a local emulator that isn't running.
//
//   npm run seed                                    the emulators
//   SEED_PROJECT=bakers-inn-pk npm run seed         the real project
//
// Seeding a real project needs admin credentials, because the Admin SDK bypasses
// the security rules. Point GOOGLE_APPLICATION_CREDENTIALS at a service-account
// key JSON downloaded from Firebase console -> Project settings -> Service
// accounts. That file is a genuine secret: keep it outside the repo.
const projectId = process.env.SEED_PROJECT || process.env.GCLOUD_PROJECT || 'demo-bakery'
const useEmulator = projectId.startsWith('demo-')

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
} else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    `\nRefusing to seed '${projectId}': GOOGLE_APPLICATION_CREDENTIALS is not set.\n` +
      'Download a service-account key from the Firebase console and point that\n' +
      'variable at it, or leave SEED_PROJECT unset to seed the emulators.\n',
  )
  process.exit(1)
}

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { isValidPin, pinPassword, staffEmail } from '../src/lib/pin.js'

initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() })
const db = getFirestore()
const auth = getAuth()

// The real shops, off the owner's own daily sheet. Susan Road is the hub — it
// is the one that keeps half the bake rather than being delivered to.
//
// The ids never change. They are written into every document id in the system
// (S-20260813-B2-…, C-20260813-MAIN, T-20260813-B3) so renaming a shop is a
// display change and nothing more, but re-lettering one would orphan its
// history. If a shop moves or is renamed, change `name` and leave `id` alone.
const BRANCHES = [
  { id: 'MAIN', name: 'Susan Road', isMain: true },
  { id: 'B2', name: 'Gulberg', isMain: false },
  { id: 'B3', name: 'Gulistan Colony', isMain: false },
]

// `devPin` is a development convenience and nothing more. It is used only
// against the emulators, where the whole database is a throwaway on this
// machine. A real project refuses to seed unless every PIN is supplied through
// the environment:
//
//   PIN_OWNER=**** PIN_AYESHA=**** ... SEED_PROJECT=bakers-inn-pk npm run seed
//
// The stars are not coyness. A four-digit number written in an example here
// reads exactly like a real one to the next person who opens the file, and this
// file is on GitHub.
//
// Real PINs are never written into this file. Changing one later would not help:
// git keeps every version of every file, so a PIN committed once stays readable
// in the history for as long as the repository exists.
const STAFF = [
  { uid: 'owner', name: 'Owner', role: 'owner', branchId: 'MAIN', devPin: '1111' },
  { uid: 'ayesha', name: 'Ayesha', role: 'cashier', branchId: 'MAIN', devPin: '2222' },
  { uid: 'bilal', name: 'Bilal', role: 'cashier', branchId: 'B2', devPin: '3333' },
  { uid: 'hina', name: 'Hina', role: 'cashier', branchId: 'B3', devPin: '4444' },
  { uid: 'usman', name: 'Usman', role: 'specialist', branchId: 'MAIN', devPin: '5555' },
]

/** The PIN to seed for one person: the environment first, dev default second. */
function pinFor({ uid, devPin }) {
  return process.env[`PIN_${uid.toUpperCase()}`] || (useEmulator ? devPin : undefined)
}

/**
 * Refuse the whole seed before writing anything if any PIN is missing or
 * malformed. Half-seeded staff would be worse than none: some people able to
 * sign in, others not, and no obvious reason why.
 */
function checkPins() {
  const problems = []
  for (const person of STAFF) {
    const pin = pinFor(person)
    const variable = `PIN_${person.uid.toUpperCase()}`
    if (!pin) problems.push(`${variable} is not set (for ${person.name})`)
    else if (!isValidPin(pin)) problems.push(`${variable} must be exactly 4 digits`)
  }
  if (problems.length > 0) {
    console.error(`\nRefusing to seed '${projectId}':\n`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nSupply a PIN for each person in the environment. Do not put real')
    console.error('PINs in scripts/seed.mjs — git would keep them forever.\n')
    process.exit(1)
  }
}

// The real catalogue, taken from The Baker's Inn's own Daily Closing Report.
//
// [id, code, name, category, price, keepsTillTomorrow]
//
// `code` is deliberately the SR number already printed on that sheet, so the
// cashier types the number they have been reading off paper for years. Prices
// are whole rupees. The last flag drives the default at the daily close: false
// means unsold stock is counted as stale, true means it carries over.
const PRODUCTS = [
  ['bread-small', '01', 'Bread Small', 'Bread', 120, false],
  ['bread-large', '02', 'Bread Large', 'Bread', 220, false],
  ['vip-bread', '03', 'VIP Bread', 'Bread', 350, false],
  ['biscuit-box', '04', 'Biscuit Box', 'Bakery', 300, true],
  ['rusk', '05', 'Rusk', 'Bakery', 150, true],
  ['donut-small', '06', 'Donut Small', 'Bakery', 50, false],
  ['donut-large', '07', 'Donut Large', 'Bakery', 100, false],
  ['dry-cake-small', '08', 'Dry Cake Small', 'Cakes', 600, true],
  ['dry-cake-large', '09', 'Dry Cake Large', 'Cakes', 1200, true],
  ['dry-cake-small-spec', '10', 'Dry Cake Small Spec.', 'Cakes', 700, true],
  ['dry-cake-large-spec', '11', 'Dry Cake Large Spec.', 'Cakes', 1400, true],
  ['mini-pastry', '12', 'Mini Pastry', 'Cakes', 50, false],
  ['lemon-tat', '13', 'Lemon Tat', 'Cakes', 100, false],
  ['vip-cake', '14', 'VIP Cake', 'Cakes', 1800, false],
  ['special-cake', '15', 'Special Cake', 'Cakes', 1600, false],
  ['reg-small-cake', '16', 'Reg. Small Cake', 'Cakes', 700, false],
  ['reg-large-cake', '17', 'Reg. Large Cake', 'Cakes', 1400, false],
  ['lotus-cake', '18', 'Lotus Cake', 'Cakes', 2200, false],
  ['spec-pastry', '19', 'Spec. Pastry', 'Cakes', 200, false],
  ['reg-pastry', '20', 'Reg. Pastry', 'Cakes', 100, false],
  ['cream-roll', '21', 'Cream Roll', 'Cakes', 100, false],

  ['chocolate-ball', '22', 'Chocolate Ball', 'Bakery', 100, false],
  ['muffin-cup', '23', 'Muffin Cup', 'Bakery', 150, false],
  ['paties', '24', 'Paties', 'Savoury', 100, false],
  ['pizza', '25', 'Pizza', 'Savoury', 250, false],
  ['chicken-bread', '26', 'Chicken Bread', 'Savoury', 300, false],
  ['chicken-roll', '27', 'Chicken Roll', 'Savoury', 120, false],
  ['samosi', '28', 'Samosi', 'Savoury', 50, false],
  ['samoli-burger', '29', 'Samoli Burger', 'Savoury', 150, false],
  ['cheese-cutless', '30', 'Cheese Cutless', 'Savoury', 100, false],
  ['dhaka-stick', '31', 'Dhaka Stick', 'Savoury', 150, false],
  ['chicken-sandwich', '32', 'Chicken Sandwich', 'Savoury', 150, false],
  ['club-sandwich', '33', 'Club Sandwich', 'Savoury', 150, false],
  ['special-sandwich', '34', 'Special Sandwich', 'Savoury', 200, false],
  ['biscuits', '35', 'Biscuits', 'Bakery', 1400, true],
  ['customised-cake', '36', 'Customised Cake', 'Cakes', 1300, false],
  ['sandwich-bread', '37', 'Sandwich Bread', 'Bread', 250, false],
  ['special-rusk', '38', 'Special Rusk', 'Bakery', 300, true],
  ['burger-bun-large', '39', 'Burger Bun Large', 'Bread', 150, false],
  ['burger-bun-small', '40', 'Burger Bun Small', 'Bread', 120, false],
  ['tea-cake-small', '41', 'Tea Cake Small', 'Cakes', 180, true],
  ['tea-cake-large', '42', 'Tea Cake Large', 'Cakes', 350, true],
  ['drumstick', '43', 'Drumstick', 'Savoury', 150, false],
  ['kebab', '44', 'Kebab', 'Savoury', 100, false],
]

// [id, name, unit, cost per unit (rupees), reorder level]
const MATERIALS = [
  ['flour', 'Flour', 'kg', 180, 50],
  ['sugar', 'Sugar', 'kg', 160, 25],
  ['butter', 'Butter', 'kg', 1400, 10],
  ['eggs', 'Eggs', 'dozen', 350, 12],
  ['milk', 'Milk', 'litre', 220, 20],
  ['yeast', 'Yeast', 'kg', 900, 3],
  ['cooking-oil', 'Cooking Oil', 'litre', 560, 15],
  ['chicken-filling', 'Chicken Filling', 'kg', 950, 8],
  ['packaging', 'Boxes and Bags', 'packet', 450, 10],
]

async function ensureStaff(person) {
  const { uid, name, role, branchId } = person
  const email = staffEmail(uid)
  const password = await pinPassword(uid, pinFor(person))
  try {
    await auth.createUser({ uid, email, password, displayName: name })
  } catch (error) {
    if (
      error.code === 'auth/uid-already-exists' ||
      error.code === 'auth/email-already-exists'
    ) {
      await auth.updateUser(uid, { email, password, displayName: name })
    } else {
      throw error
    }
  }
  // Role and outlet ride on the token so the security rules never have to fetch
  // a document. In the running system the syncStaffClaims function keeps these
  // in step with the /users record; here they are set directly.
  await auth.setCustomUserClaims(uid, { role, branchId, active: true })

  // The document id is the auth uid — every stamped record points back to it.
  await db.collection('users').doc(uid).set({ loginId: uid, name, role, branchId, active: true })
}

async function main() {
  console.log(
    useEmulator
      ? `Seeding the emulators (${projectId})\n`
      : `Seeding the REAL project ${projectId}\n`,
  )
  checkPins()

  for (const branch of BRANCHES) {
    const { id, ...rest } = branch
    await db.collection('branches').doc(id).set(rest)
  }
  console.log(`✓ ${BRANCHES.length} outlets`)

  for (const person of STAFF) await ensureStaff(person)
  console.log(`✓ ${STAFF.length} staff accounts`)

  // Demo data only: drop products that are no longer in the list so re-seeding
  // never leaves stale items behind. The running system never deletes anything,
  // and neither does this script once it is pointed at a real project — an item
  // the shop has stopped making is archived in the app, not erased, or its sales
  // history loses the name and price it was sold under.
  if (useEmulator) {
    const keep = new Set(PRODUCTS.map(([id]) => id))
    const existing = await db.collection('products').get()
    for (const d of existing.docs) if (!keep.has(d.id)) await d.ref.delete()
  }

  for (const [id, code, name, category, price, sellsNextDay] of PRODUCTS) {
    await db
      .collection('products')
      .doc(id)
      .set({ code, name, category, price, sellsNextDay, active: true })
  }
  console.log(`✓ ${PRODUCTS.length} products`)

  for (const [id, name, unit, costPerUnit, reorderLevel] of MATERIALS) {
    const ref = db.collection('rawMaterials').doc(id)
    // The three running counters are set once, when the material is first
    // created, and never again. Re-running the seed must not wipe a count
    // somebody actually made in the storeroom — so an existing material only
    // has its description refreshed. onHand starts at zero deliberately: the
    // first purchase or count puts real stock on the shelf, so nobody inherits
    // a figure nobody counted.
    const description = { name, unit, costPerUnit, reorderLevel, active: true }
    const exists = (await ref.get()).exists
    await ref.set(
      exists
        ? description
        : { ...description, onHand: 0, receivedSinceCount: 0, spoiledSinceCount: 0 },
      { merge: true },
    )
  }
  console.log(`✓ ${MATERIALS.length} raw materials`)

  // Against a real project the PINs came from whoever ran this, so echoing them
  // back teaches nobody anything and only writes them into terminal history.
  console.log('\nSign in with:')
  for (const s of STAFF) {
    const pin = useEmulator ? `PIN ${pinFor(s)}` : 'PIN as supplied'
    console.log(`  ${s.name.padEnd(7)} ${s.role.padEnd(11)} ${s.branchId.padEnd(5)} ${pin}`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(
      useEmulator
        ? '\nSeed failed. Are the emulators running? (npm run emulators)\n'
        : `\nSeed failed against ${projectId}. Check that Firestore exists, that the\n` +
            'service-account key in GOOGLE_APPLICATION_CREDENTIALS belongs to this\n' +
            'project, and that Email/Password sign-in is enabled.\n',
    )
    console.error(error)
    process.exit(1)
  },
)
