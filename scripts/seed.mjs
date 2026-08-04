#!/usr/bin/env node
// Seed the local emulators with the three outlets, the starting staff, and a
// realistic product list. Safe to run repeatedly — every write is by a fixed id.
//
//   npm run emulators     (in one terminal)
//   npm run seed          (in another)

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { pinPassword, staffEmail } from '../src/lib/pin.js'

const projectId = process.env.GCLOUD_PROJECT || 'demo-bakery'
initializeApp({ projectId })
const db = getFirestore()
const auth = getAuth()

const BRANCHES = [
  { id: 'MAIN', name: 'Main Outlet', isMain: true },
  { id: 'B2', name: 'Gulberg', isMain: false },
  { id: 'B3', name: 'Model Town', isMain: false },
]

const STAFF = [
  { uid: 'owner', name: 'Owner', role: 'owner', branchId: 'MAIN', pin: '1111' },
  { uid: 'ayesha', name: 'Ayesha', role: 'cashier', branchId: 'MAIN', pin: '2222' },
  { uid: 'bilal', name: 'Bilal', role: 'cashier', branchId: 'B2', pin: '3333' },
  { uid: 'hina', name: 'Hina', role: 'cashier', branchId: 'B3', pin: '4444' },
  { uid: 'usman', name: 'Usman', role: 'specialist', branchId: 'MAIN', pin: '5555' },
]

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

async function ensureStaff({ uid, name, role, branchId, pin }) {
  const email = staffEmail(uid)
  const password = await pinPassword(uid, pin)
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
  for (const branch of BRANCHES) {
    const { id, ...rest } = branch
    await db.collection('branches').doc(id).set(rest)
  }
  console.log(`✓ ${BRANCHES.length} outlets`)

  for (const person of STAFF) await ensureStaff(person)
  console.log(`✓ ${STAFF.length} staff accounts`)

  // Demo data only: drop products that are no longer in the list so re-seeding
  // never leaves stale items behind. The running system never deletes anything.
  const keep = new Set(PRODUCTS.map(([id]) => id))
  const existing = await db.collection('products').get()
  for (const d of existing.docs) if (!keep.has(d.id)) await d.ref.delete()

  for (const [id, code, name, category, price, sellsNextDay] of PRODUCTS) {
    await db
      .collection('products')
      .doc(id)
      .set({ code, name, category, price, sellsNextDay, active: true })
  }
  console.log(`✓ ${PRODUCTS.length} products`)

  for (const [id, name, unit, costPerUnit, reorderLevel] of MATERIALS) {
    // onHand starts at zero: the first purchase or count puts real stock on the
    // shelf, so nobody inherits a figure nobody counted.
    await db.collection('rawMaterials').doc(id).set({
      name, unit, costPerUnit, reorderLevel,
      onHand: 0, receivedSinceCount: 0, spoiledSinceCount: 0, active: true,
    })
  }
  console.log(`✓ ${MATERIALS.length} raw materials`)

  console.log('\nSign in with:')
  for (const s of STAFF) {
    console.log(`  ${s.name.padEnd(7)} ${s.role.padEnd(11)} ${s.branchId.padEnd(5)} PIN ${s.pin}`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('\nSeed failed. Are the emulators running? (npm run emulators)\n')
    console.error(error)
    process.exit(1)
  },
)
