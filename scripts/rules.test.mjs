// Security rules are the real permission system — the UI only hides buttons.
// These tests pin the invariants the whole design rests on.
//
// Needs the emulators running: npm run emulators
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

const here = dirname(fileURLToPath(import.meta.url))

let env

const OWNER = 'u-owner'
const CASHIER_MAIN = 'u-maya'
const CASHIER_B2 = 'u-sam'
const SPECIALIST = 'u-ravi'

function saleFor(branchId, cashierId) {
  return {
    ref: `S-${branchId}-0728-A001`,
    branchId,
    businessDate: '2026-07-28',
    cashierId,
    cashierName: 'Test',
    payment: 'cash',
    status: 'normal',
    items: [{ productId: 'p1', name: 'Loaf', price: 450, qty: 1 }],
    total: 450,
  }
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bakery-rules',
    firestore: {
      rules: readFileSync(join(here, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  await env.clearFirestore()

  // Staff records drive every rule, so they are written with rules disabled.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', OWNER), { name: 'Owner', role: 'owner', branchId: 'MAIN', active: true })
    await setDoc(doc(db, 'users', CASHIER_MAIN), { name: 'Maya', role: 'cashier', branchId: 'MAIN', active: true })
    await setDoc(doc(db, 'users', CASHIER_B2), { name: 'Sam', role: 'cashier', branchId: 'B2', active: true })
    await setDoc(doc(db, 'users', SPECIALIST), { name: 'Ravi', role: 'specialist', branchId: 'MAIN', active: true })
    await setDoc(doc(db, 'users', 'u-gone'), { name: 'Ex', role: 'cashier', branchId: 'MAIN', active: false })
    await setDoc(doc(db, 'products', 'p1'), { name: 'Loaf', category: 'Bread', price: 450, active: true })
    await setDoc(doc(db, 'sales', 'existing'), saleFor('MAIN', CASHIER_MAIN))
    await setDoc(doc(db, 'sales', 'b2-sale'), saleFor('B2', CASHIER_B2))

    // The daily cycle.
    await setDoc(doc(db, 'demands', 'D-B2'), {
      branchId: 'B2', businessDate: '2026-07-29', status: 'submitted',
      items: [{ productId: 'p1', code: '101', productName: 'Loaf', qty: 10 }],
    })
    await setDoc(doc(db, 'demands', 'D-B2-locked'), {
      branchId: 'B2', businessDate: '2026-07-28', status: 'locked', items: [],
    })
    await setDoc(doc(db, 'productionOrders', 'PO'), {
      businessDate: '2026-07-29', status: 'open',
      items: [{ productId: 'p1', code: '101', productName: 'Loaf', qtyNeeded: 30, perOutlet: { MAIN: 20, B2: 10 } }],
      produced: {},
    })
    await setDoc(doc(db, 'transfers', 'T-draft'), {
      fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-07-29', status: 'draft',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10 }],
    })
    await setDoc(doc(db, 'transfers', 'T-sent'), {
      fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-07-29', status: 'dispatched',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 8 }],
    })
  })
})

after(async () => {
  await env?.cleanup()
})

// Role and outlet ride on the token, exactly as they do in the running system
// where the syncStaffClaims function mirrors them off the /users record.
const CLAIMS = {
  [OWNER]: { role: 'owner', branchId: 'MAIN', active: true },
  [CASHIER_MAIN]: { role: 'cashier', branchId: 'MAIN', active: true },
  [CASHIER_B2]: { role: 'cashier', branchId: 'B2', active: true },
  [SPECIALIST]: { role: 'specialist', branchId: 'MAIN', active: true },
  'u-gone': { role: 'cashier', branchId: 'MAIN', active: false },
}

const as = (uid) => env.authenticatedContext(uid, CLAIMS[uid] ?? {}).firestore()

test('a cashier can ring a sale at their own outlet', async () => {
  const db = as(CASHIER_MAIN)
  await assertSucceeds(setDoc(doc(db, 'sales', 'new-main'), saleFor('MAIN', CASHIER_MAIN)))
})

test('a cashier cannot ring a sale onto another outlet', async () => {
  const db = as(CASHIER_MAIN)
  await assertFails(setDoc(doc(db, 'sales', 'cross-branch'), saleFor('B2', CASHIER_MAIN)))
})

test('a cashier cannot ring a sale under someone else\'s name', async () => {
  const db = as(CASHIER_MAIN)
  await assertFails(setDoc(doc(db, 'sales', 'impersonated'), saleFor('MAIN', CASHIER_B2)))
})

test('a cashier cannot read another outlet\'s takings', async () => {
  const db = as(CASHIER_MAIN)
  await assertFails(getDoc(doc(db, 'sales', 'b2-sale')))
})

test('the owner can read every outlet', async () => {
  const db = as(OWNER)
  await assertSucceeds(getDoc(doc(db, 'sales', 'b2-sale')))
})

test('voiding is allowed — it is a whitelisted field change', async () => {
  const db = as(CASHIER_MAIN)
  await assertSucceeds(
    updateDoc(doc(db, 'sales', 'existing'), {
      status: 'voided',
      voidReason: 'Rung by mistake',
      voidedBy: CASHIER_MAIN,
    }),
  )
})

test('the takings on a sale can never be edited', async () => {
  const db = as(CASHIER_MAIN)
  await assertFails(updateDoc(doc(db, 'sales', 'existing'), { total: 1 }))
})

test('a sale line cannot be rewritten after the fact', async () => {
  const db = as(CASHIER_MAIN)
  await assertFails(
    updateDoc(doc(db, 'sales', 'existing'), {
      items: [{ productId: 'p1', name: 'Loaf', price: 1, qty: 1 }],
    }),
  )
})

test('nobody can delete a sale — not even the owner', async () => {
  await assertFails(deleteDoc(doc(as(CASHIER_MAIN), 'sales', 'existing')))
  await assertFails(deleteDoc(doc(as(OWNER), 'sales', 'existing')))
})

test('only the owner may change the catalog', async () => {
  await assertFails(setDoc(doc(as(CASHIER_MAIN), 'products', 'p2'), { name: 'X', price: 100, active: true }))
  await assertFails(setDoc(doc(as(SPECIALIST), 'products', 'p2'), { name: 'X', price: 100, active: true }))
  await assertSucceeds(setDoc(doc(as(OWNER), 'products', 'p2'), { name: 'X', price: 100, active: true }))
})

test('a product can never be deleted, only archived', async () => {
  await assertFails(deleteDoc(doc(as(OWNER), 'products', 'p1')))
  await assertSucceeds(updateDoc(doc(as(OWNER), 'products', 'p1'), { active: false }))
})

test('only the owner may add or change staff', async () => {
  await assertFails(setDoc(doc(as(CASHIER_MAIN), 'users', 'u-new'), { name: 'N', role: 'owner', branchId: 'MAIN', active: true }))
  await assertSucceeds(setDoc(doc(as(OWNER), 'users', 'u-new'), { name: 'N', role: 'cashier', branchId: 'B2', active: true }))
})

test('a cashier cannot promote themselves to owner', async () => {
  const db = as(CASHIER_MAIN)
  await assertFails(updateDoc(doc(db, 'users', CASHIER_MAIN), { role: 'owner' }))
})

test('a turned-off account can do nothing', async () => {
  const db = as('u-gone')
  await assertFails(setDoc(doc(db, 'sales', 'from-ex-staff'), saleFor('MAIN', 'u-gone')))
})

test('a signed-out visitor can read the staff list but write nothing', async () => {
  const db = env.unauthenticatedContext().firestore()
  // The login screen needs the names before anyone has signed in.
  await assertSucceeds(getDoc(doc(db, 'users', CASHIER_MAIN)))
  await assertFails(getDoc(doc(db, 'sales', 'existing')))
  await assertFails(setDoc(doc(db, 'sales', 'anon'), saleFor('MAIN', 'nobody')))
})

test('raw material purchases are the owner\'s alone', async () => {
  await assertFails(getDoc(doc(as(CASHIER_MAIN), 'purchases', 'P-0728-01')))
  await assertSucceeds(setDoc(doc(as(OWNER), 'purchases', 'P-0728-01'), { businessDate: '2026-07-28', total: 5000 }))
})

test('an outlet can reopen the day it closed by mistake', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'closings', 'C-20260728-MAIN'), {
      branchId: 'MAIN',
      businessDate: '2026-07-28',
      status: 'closed',
      countedCash: 10000,
    })
  })
  // An accidental close must never leave a shop waiting on the owner to sell.
  await assertSucceeds(
    updateDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260728-MAIN'), {
      status: 'reopened',
      reopenedBy: CASHIER_MAIN,
      reopenReason: 'Closed by mistake',
    }),
  )
  await assertSucceeds(updateDoc(doc(as(OWNER), 'closings', 'C-20260728-MAIN'), { countedCash: 9900 }))
})

test('another outlet cannot touch a day that is not theirs', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'closings', 'C-20260728-MAIN'), { status: 'reopened' }),
  )
})

test('a close cannot be moved to another outlet or another day', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260728-MAIN'), { branchId: 'B2' }),
  )
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260728-MAIN'), { businessDate: '2026-07-01' }),
  )
})

test('a closed day still cannot be deleted by anyone', async () => {
  await assertFails(deleteDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260728-MAIN')))
  await assertFails(deleteDoc(doc(as(OWNER), 'closings', 'C-20260728-MAIN')))
})

test('collections nobody declared are closed by default', async () => {
  await assertFails(setDoc(doc(as(OWNER), 'secretStuff', 'x'), { a: 1 }))
})

// --- making the baking list without waiting for 5am ------------------------
//
// This used to be `allow create: if false`, which meant a morning the job had
// not run was a morning nobody in the building could do anything about. The
// kitchen can now run the same compile from the app — so these tests exist to
// keep that opening exactly as narrow as it was meant to be.

const bakingList = (uid) => ({
  businessDate: '2026-08-20',
  ref: 'PO-0820',
  status: 'open',
  items: [{ productId: 'bread-small', qtyNeeded: 40, perOutlet: { MAIN: 40 } }],
  compiledBy: uid,
})

test('the kitchen can make the day’s list when 5am did not', async () => {
  await assertSucceeds(
    setDoc(doc(as(SPECIALIST), 'productionOrders', 'PO-20260820'), bakingList(SPECIALIST)),
  )
})

test('the owner can make it too', async () => {
  await assertSucceeds(
    setDoc(doc(as(OWNER), 'productionOrders', 'PO-20260821'), {
      ...bakingList(OWNER),
      businessDate: '2026-08-21',
    }),
  )
})

test('a cashier cannot decide what the bakery bakes', async () => {
  await assertFails(
    setDoc(doc(as(CASHIER_MAIN), 'productionOrders', 'PO-20260822'), bakingList(CASHIER_MAIN)),
  )
})

test('a baking list cannot be signed with someone else’s name', async () => {
  // Same reasoning as a void: the stamp is the only record that a list was
  // built by hand rather than by the job, so it has to be true.
  await assertFails(
    setDoc(doc(as(SPECIALIST), 'productionOrders', 'PO-20260823'), bakingList(OWNER)),
  )
})

test('a list still has to look like a list', async () => {
  await assertFails(
    setDoc(doc(as(SPECIALIST), 'productionOrders', 'PO-20260824'), {
      businessDate: '2026-08-24',
      items: 'lots of bread',
      compiledBy: SPECIALIST,
    }),
  )
})

test('compiling closes the orders it was built from', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ctx.firestore().doc('demands/D-20260820-B2'), {
      branchId: 'B2',
      businessDate: '2026-08-20',
      status: 'submitted',
      items: [{ productId: 'bread-small', qty: 40 }],
    })
  })
  await assertSucceeds(
    updateDoc(doc(as(SPECIALIST), 'demands', 'D-20260820-B2'), { status: 'locked' }),
  )
})

test('but the kitchen cannot rewrite what an outlet asked for', async () => {
  // Locking is part of compiling. Changing the order is not.
  await assertFails(
    updateDoc(doc(as(SPECIALIST), 'demands', 'D-20260820-B2'), {
      status: 'locked',
      items: [{ productId: 'bread-small', qty: 400 }],
    }),
  )
})

test('the delivery notes that come with the list start as drafts', async () => {
  await assertSucceeds(
    setDoc(doc(as(SPECIALIST), 'transfers', 'T-20260820-B2'), {
      ref: 'T-0820-B2',
      fromBranch: 'MAIN',
      toBranchId: 'B2',
      businessDate: '2026-08-20',
      direction: 'out',
      status: 'draft',
      items: [],
    }),
  )
})

test('nobody can create a note that is already on its way', async () => {
  // Dispatch is a deliberate act on the Dispatch screen, with somebody
  // confirming what actually went in the van.
  await assertFails(
    setDoc(doc(as(SPECIALIST), 'transfers', 'T-20260820-B3'), {
      ref: 'T-0820-B3',
      fromBranch: 'MAIN',
      toBranchId: 'B3',
      businessDate: '2026-08-20',
      direction: 'out',
      status: 'dispatched',
      items: [],
    }),
  )
})

// --- the stamp has to name whoever actually did it -------------------------
//
// There are no approval queues anywhere in this system: anyone may void a sale
// or reopen a day, and the bargain is that every action is stamped and shows up
// on the owner's dashboard. That makes the stamp the only thing standing
// between a cashier and voiding their own takings — so it must not be a value
// the client simply chooses. Whitelisting the field as changeable was never the
// same as requiring it to be true.

test('a cashier cannot void a sale under another cashier\'s name', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'sales', 'existing'), {
      status: 'voided',
      voidReason: 'Rung by mistake',
      voidedBy: CASHIER_B2,
    }),
  )
})

test('a cashier cannot pin a payment correction on somebody else', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'sales', 'existing'), {
      payment: 'card',
      paymentChangedBy: OWNER,
    }),
  )
})

test('a reopen cannot be signed with another name', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260728-MAIN'), {
      status: 'reopened',
      reopenedBy: OWNER,
      reopenReason: 'Not mine to sign',
    }),
  )
})

test('the trail on a close can grow but never shrink', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'closings', 'C-20260729-MAIN'), {
      branchId: 'MAIN',
      businessDate: '2026-07-29',
      status: 'closed',
      countedCash: 10000,
      events: [
        { action: 'closed', by: CASHIER_MAIN, countedCash: 10000 },
        { action: 'reopened', by: CASHIER_MAIN },
      ],
    })
  })

  // Re-closing appends, which is the normal path and must keep working.
  await assertSucceeds(
    updateDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260729-MAIN'), {
      status: 'closed',
      countedCash: 9900,
      events: [
        { action: 'closed', by: CASHIER_MAIN, countedCash: 10000 },
        { action: 'reopened', by: CASHIER_MAIN },
        { action: 'closed', by: CASHIER_MAIN, countedCash: 9900 },
      ],
    }),
  )

  // Replacing it with one tidy entry would leave a day that looks like it was
  // counted once and reconciled perfectly. That is the version worth refusing.
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'closings', 'C-20260729-MAIN'), {
      events: [{ action: 'closed', by: CASHIER_MAIN, countedCash: 9900 }],
    }),
  )
})

test('what the bakery pays for its ingredients is the owner\'s alone', async () => {
  // Staff accounts are created through the app, so `signedIn()` here was a much
  // lower bar than it looked: anyone who could sign in could read the cost
  // price of every ingredient. Both screens that read this are owner-only.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rawMaterials', 'flour'), {
      name: 'Flour',
      unit: 'kg',
      costPerUnit: 210,
      onHand: 40,
    })
  })
  await assertFails(getDoc(doc(as(CASHIER_MAIN), 'rawMaterials', 'flour')))
  await assertFails(getDoc(doc(as(SPECIALIST), 'rawMaterials', 'flour')))
  await assertSucceeds(getDoc(doc(as(OWNER), 'rawMaterials', 'flour')))
})

test('a signed-in account with no role assigned can do nothing', async () => {
  // Claims not yet synced, or a stale token from before someone was set up.
  const db = env.authenticatedContext('u-nobody', {}).firestore()
  await assertFails(getDoc(doc(db, 'sales', 'existing')))
  await assertFails(setDoc(doc(db, 'sales', 'x'), saleFor('MAIN', 'u-nobody')))
})

// --- queries, which are the thing rules most often break -------------------

test('the owner can list every outlet at once; a cashier cannot', async () => {
  // This is what the owner's dashboard does, and it must not need a branch
  // filter. A cashier issuing the same unpinned query has to be refused.
  await assertSucceeds(getDocs(query(collection(as(OWNER), 'sales'), where('businessDate', '==', '2026-07-28'))))
  await assertFails(getDocs(query(collection(as(CASHIER_MAIN), 'sales'), where('businessDate', '==', '2026-07-28'))))
})

test('a cashier can list their own outlet by pinning it in the query', async () => {
  await assertSucceeds(
    getDocs(query(collection(as(CASHIER_MAIN), 'sales'), where('branchId', '==', 'MAIN'))),
  )
  // ...but cannot pin someone else's.
  await assertFails(
    getDocs(query(collection(as(CASHIER_MAIN), 'sales'), where('branchId', '==', 'B2'))),
  )
})

test('the owner can list closings and transfers across outlets', async () => {
  await assertSucceeds(getDocs(query(collection(as(OWNER), 'closings'), orderBy('businessDate', 'desc'))))
  await assertSucceeds(getDocs(query(collection(as(OWNER), 'transfers'), where('businessDate', '==', '2026-07-29'))))
})

test('an outlet lists only the deliveries addressed to it', async () => {
  await assertSucceeds(
    getDocs(query(collection(as(CASHIER_B2), 'transfers'), where('toBranchId', '==', 'B2'))),
  )
  await assertFails(
    getDocs(query(collection(as(CASHIER_B2), 'transfers'), where('toBranchId', '==', 'B3'))),
  )
  await assertFails(getDocs(collection(as(CASHIER_B2), 'transfers')))
})

// --- stock going back to the hub, and the compiled reports -----------------

test('an outlet can send its own leftovers back to the hub', async () => {
  await assertSucceeds(
    setDoc(doc(as(CASHIER_B2), 'transfers', 'T-return-b2'), {
      ref: 'T-0728-B2-R',
      fromBranch: 'B2',
      toBranchId: 'MAIN',
      businessDate: '2026-07-28',
      direction: 'return',
      status: 'dispatched',
      items: [{ productId: 'p1', productName: 'Loaf', qtySent: 4 }],
    }),
  )
})

test('an outlet cannot invent a delivery to itself, or send from somewhere else', async () => {
  const base = {
    ref: 'T-forged',
    businessDate: '2026-07-28',
    status: 'dispatched',
    items: [],
  }
  // An outbound delivery is the compile's to write, never an outlet's.
  await assertFails(
    setDoc(doc(as(CASHIER_B2), 'transfers', 'T-forged-out'), {
      ...base, direction: 'out', fromBranch: 'MAIN', toBranchId: 'B2',
    }),
  )
  // A return has to come from the outlet actually sending it.
  await assertFails(
    setDoc(doc(as(CASHIER_B2), 'transfers', 'T-forged-return'), {
      ...base, direction: 'return', fromBranch: 'B3', toBranchId: 'MAIN',
    }),
  )
})

test('the hub confirms a return; the outlet that sent it cannot', async () => {
  const confirmed = {
    status: 'received',
    items: [{ productId: 'p1', productName: 'Loaf', qtySent: 4, qtyReceived: 4 }],
  }
  await assertFails(updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-return-b2'), confirmed))
  await assertSucceeds(updateDoc(doc(as(CASHIER_MAIN), 'transfers', 'T-return-b2'), confirmed))
})

test('reports are compiled and read-only — nobody writes one, not even the owner', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'dailyReports', 'R-20260728-B2'), {
      branchId: 'B2', businessDate: '2026-07-28', salesTotal: 5000, wasteValue: 660,
    })
  })
  await assertFails(setDoc(doc(as(OWNER), 'dailyReports', 'R-forged'), { branchId: 'B2' }))
  await assertFails(updateDoc(doc(as(OWNER), 'dailyReports', 'R-20260728-B2'), { salesTotal: 1 }))
  await assertFails(deleteDoc(doc(as(OWNER), 'dailyReports', 'R-20260728-B2')))
})

test('the owner reads every outlet’s report; a cashier only their own', async () => {
  await assertSucceeds(getDocs(query(collection(as(OWNER), 'dailyReports'), orderBy('businessDate', 'desc'))))
  await assertSucceeds(getDoc(doc(as(CASHIER_B2), 'dailyReports', 'R-20260728-B2')))
  await assertFails(getDoc(doc(as(CASHIER_MAIN), 'dailyReports', 'R-20260728-B2')))
  await assertFails(getDocs(collection(as(CASHIER_B2), 'dailyReports')))
})

test('the hub lists what it is sending out', async () => {
  await assertSucceeds(
    getDocs(query(collection(as(SPECIALIST), 'transfers'), where('fromBranch', '==', 'MAIN'))),
  )
})

// --- the daily cycle -------------------------------------------------------

test('an outlet places its own order but not another outlet\'s', async () => {
  const order = (branchId) => ({
    branchId, businessDate: '2026-07-30', status: 'submitted',
    items: [{ productId: 'p1', code: '101', productName: 'Loaf', qty: 4 }],
  })
  await assertSucceeds(setDoc(doc(as(CASHIER_B2), 'demands', 'D-new-b2'), order('B2')))
  await assertFails(setDoc(doc(as(CASHIER_B2), 'demands', 'D-new-main'), order('MAIN')))
})

test('an order that has gone to the kitchen can no longer be changed', async () => {
  await assertFails(updateDoc(doc(as(CASHIER_B2), 'demands', 'D-B2-locked'), { status: 'submitted' }))
  // The owner can still put a mistake right.
  await assertSucceeds(updateDoc(doc(as(OWNER), 'demands', 'D-B2-locked'), { note: 'fixed' }))
})

test('an outlet can still edit its order before the cutoff', async () => {
  await assertSucceeds(
    updateDoc(doc(as(CASHIER_B2), 'demands', 'D-B2'), {
      status: 'submitted',
      items: [{ productId: 'p1', code: '101', productName: 'Loaf', qty: 12 }],
    }),
  )
})

test('nobody can type a baking list — only the scheduled compile makes one', async () => {
  const list = { businessDate: '2026-07-30', status: 'open', items: [], produced: {} }
  await assertFails(setDoc(doc(as(OWNER), 'productionOrders', 'PO-forged'), list))
  await assertFails(setDoc(doc(as(SPECIALIST), 'productionOrders', 'PO-forged'), list))
  await assertFails(setDoc(doc(as(CASHIER_MAIN), 'productionOrders', 'PO-forged'), list))
})

test('the kitchen records what it baked, and nothing else', async () => {
  await assertSucceeds(
    updateDoc(doc(as(SPECIALIST), 'productionOrders', 'PO'), {
      'produced.p1': 28,
      'producedBy.p1': SPECIALIST,
    }),
  )
  await assertSucceeds(updateDoc(doc(as(SPECIALIST), 'productionOrders', 'PO'), { status: 'done' }))
  // Rewriting what was asked for is not the kitchen's to do.
  await assertFails(
    updateDoc(doc(as(SPECIALIST), 'productionOrders', 'PO'), {
      items: [{ productId: 'p1', qtyNeeded: 1, perOutlet: {} }],
    }),
  )
})

test('a cashier cannot touch the baking list', async () => {
  await assertFails(updateDoc(doc(as(CASHIER_MAIN), 'productionOrders', 'PO'), { 'produced.p1': 99 }))
})

test('the hub sends a delivery; an outlet cannot send to itself', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-draft'), {
      status: 'dispatched',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 10 }],
    }),
  )
  await assertSucceeds(
    updateDoc(doc(as(SPECIALIST), 'transfers', 'T-draft'), {
      status: 'dispatched',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 10 }],
    }),
  )
})

test('the receiving outlet counts a delivery in; another outlet cannot', async () => {
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'transfers', 'T-sent'), {
      status: 'received',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 8, qtyReceived: 8 }],
    }),
  )
  await assertSucceeds(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-sent'), {
      status: 'received',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 8, qtyReceived: 6, shortReason: 'Damaged in transit' }],
    }),
  )
})

test('a delivery cannot be marked received before it was ever sent', async () => {
  // A note of its own: the shared draft has already been dispatched by the test
  // above, and these tests deliberately share state to mirror a real day.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'transfers', 'T-untouched'), {
      fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-07-29', status: 'draft',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10 }],
    })
  })
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-untouched'), {
      status: 'received',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtyReceived: 10 }],
    }),
  )
})

test('an outlet cannot read a delivery meant for somewhere else', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'transfers', 'T-b3'), {
      fromBranch: 'MAIN', toBranchId: 'B3', businessDate: '2026-07-29', status: 'dispatched', items: [],
    })
  })
  await assertFails(getDoc(doc(as(CASHIER_B2), 'transfers', 'T-b3')))
  await assertSucceeds(getDoc(doc(as(OWNER), 'transfers', 'T-b3')))
})

test('an outlet can ask about a day it has not closed yet', async () => {
  // The till asks this on every load, and for most of the day the answer is
  // "there is no such document". That has to come back as an empty read, not a
  // refusal: a rule touching resource.data cannot be evaluated against a
  // document that does not exist, and the denial it produced was
  // indistinguishable from a real permission fault.
  await assertSucceeds(getDoc(doc(as(CASHIER_B2), 'closings', 'C-20991231-B2')))
})

test('a closing that does exist is still only for its own outlet', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'closings', 'C-20260801-B3'), {
      branchId: 'B3', businessDate: '2026-08-01', status: 'closed', salesTotal: 100,
    })
  })
  await assertFails(getDoc(doc(as(CASHIER_B2), 'closings', 'C-20260801-B3')))
  await assertSucceeds(getDoc(doc(as(OWNER), 'closings', 'C-20260801-B3')))
})

// --- Faults reported by the tablets -----------------------------------------

const faultFrom = (uid) => ({
  message: 'Cannot read properties of undefined',
  stack: 'at Sell.jsx:1',
  where: 'render',
  userId: uid,
  branchId: 'B2',
  businessDate: '2026-07-29',
})

test('a tablet reports its own fault', async () => {
  await assertSucceeds(
    setDoc(doc(as(CASHIER_B2), 'clientErrors', 'e-1'), faultFrom(CASHIER_B2)),
  )
})

test('a fault cannot be filed in somebody else’s name', async () => {
  // Otherwise one tablet could bury another outlet in invented faults, and the
  // trail back to the device that is actually broken would be worthless.
  await assertFails(
    setDoc(doc(as(CASHIER_B2), 'clientErrors', 'e-2'), faultFrom(CASHIER_MAIN)),
  )
})

test('someone signed out cannot report anything', async () => {
  const db = env.unauthenticatedContext().firestore()
  await assertFails(setDoc(doc(db, 'clientErrors', 'e-3'), faultFrom(CASHIER_B2)))
})

test('only the owner reads the fault list', async () => {
  await assertSucceeds(getDocs(query(collection(as(OWNER), 'clientErrors'))))
  // A stack trace names the code and the outlet. That is the owner's business.
  await assertFails(getDocs(query(collection(as(CASHIER_B2), 'clientErrors'))))
  await assertFails(getDoc(doc(as(CASHIER_B2), 'clientErrors', 'e-1')))
})

test('a fault report can never be edited away, not even by the owner', async () => {
  await assertFails(updateDoc(doc(as(OWNER), 'clientErrors', 'e-1'), { message: 'never mind' }))
  await assertFails(deleteDoc(doc(as(OWNER), 'clientErrors', 'e-1')))
})

test('no part of the cycle can ever be deleted', async () => {
  await assertFails(deleteDoc(doc(as(OWNER), 'demands', 'D-B2')))
  await assertFails(deleteDoc(doc(as(OWNER), 'productionOrders', 'PO')))
  await assertFails(deleteDoc(doc(as(OWNER), 'transfers', 'T-draft')))
})

// --- delivery notes, from both ends ----------------------------------------

test('the owner can send stock back from whichever outlet he is standing in', () => {
  // He is registered at MAIN and deliberately allowed to work anywhere — App
  // exempts him from the wrong-outlet guard on purpose. This one clause was
  // written with a bare myBranch() instead of canWriteBranch(), so closing
  // Gulberg's day on Gulberg's tablet refused his return, and the return is
  // part of the same act as counting the drawer.
  return assertSucceeds(
    setDoc(doc(as(OWNER), 'transfers', 'T-20260729-B2-R-owner'), {
      ref: 'DN-R-owner',
      fromBranch: 'B2',
      toBranchId: 'MAIN',
      businessDate: '2026-07-29',
      direction: 'return',
      status: 'dispatched',
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 4, qtySent: 4, qtyReceived: null }],
    }),
  )
})

test('an outlet can correct a return it has sent, until the hub confirms it', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'transfers', 'T-20260729-B2-R'), {
      fromBranch: 'B2', toBranchId: 'MAIN', businessDate: '2026-07-29',
      direction: 'return', status: 'dispatched',
      items: [{ productId: 'p1', productName: 'Loaf', qtySent: 4, qtyReceived: null }],
    })
  })
  // A day can be reopened, and re-closing it sends the return again onto the
  // same natural-key document — which is an update, and no clause matched the
  // outlet that wrote it. Reopening a day left a shop unable to close it again.
  await assertSucceeds(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-20260729-B2-R'), {
      items: [{ productId: 'p1', productName: 'Loaf', qtySent: 6, qtyReceived: null }],
      status: 'dispatched',
    }),
  )
  // Another outlet's return is still none of their business.
  await assertFails(
    updateDoc(doc(as(CASHIER_MAIN), 'transfers', 'T-20260729-B2-R'), {
      items: [], status: 'dispatched',
    }),
  )
  // Correcting the count, not re-addressing the van.
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-20260729-B2-R'), {
      items: [], status: 'dispatched', toBranchId: 'B3',
    }),
  )
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-20260729-B2-R'), {
      items: [], status: 'dispatched', businessDate: '2026-07-28',
    }),
  )
})

test('counting a delivery in cannot rewrite anything but the count', async () => {
  const note = (id) => ({
    fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-07-29',
    direction: 'out', status: 'dispatched',
    items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 10 }],
  })
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const id of ['T-in-ok', 'T-in-date', 'T-in-stamp', 'T-in-lines']) {
      await setDoc(doc(ctx.firestore(), 'transfers', id), note(id))
    }
  })

  const counted = [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 10, qtyReceived: 8, shortReason: 'Damaged in transit' }]

  await assertSucceeds(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-in-ok'), {
      items: counted, status: 'received', receivedBy: CASHIER_B2, receivedByName: 'Sam',
      // The day the goods actually landed, which is not the day on the note.
      receivedOn: '2026-07-29',
    }),
  )
  // Moving the note to another day would move the stock to another day's books.
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-in-date'), {
      items: counted, status: 'received', receivedBy: CASHIER_B2, businessDate: '2026-07-28',
    }),
  )
  // Signing somebody else's name to the count.
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-in-stamp'), {
      items: counted, status: 'received', receivedBy: CASHIER_MAIN, receivedByName: 'Maya',
    }),
  )
  // Dropping a line rather than declaring it short.
  await assertFails(
    updateDoc(doc(as(CASHIER_B2), 'transfers', 'T-in-lines'), {
      items: [], status: 'received', receivedBy: CASHIER_B2,
    }),
  )
})

test('the hub may add extras when it sends, but not sign for the far end', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const id of ['T-out-ok', 'T-out-forge']) {
      await setDoc(doc(ctx.firestore(), 'transfers', id), {
        fromBranch: 'MAIN', toBranchId: 'B2', businessDate: '2026-07-29',
        direction: 'out', status: 'draft',
        items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: null }],
      })
    }
  })
  // A tray nobody ordered becomes a new line, so the line count may grow here.
  await assertSucceeds(
    updateDoc(doc(as(SPECIALIST), 'transfers', 'T-out-ok'), {
      items: [
        { productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 10 },
        { productId: 'p2', productName: 'Donut', qtyDemanded: 0, qtySent: 20, extra: true },
      ],
      status: 'dispatched',
      dispatchedBy: SPECIALIST,
      dispatchedByName: 'Ravi',
    }),
  )
  // Marking it received on the outlet's behalf, from the hub.
  await assertFails(
    updateDoc(doc(as(SPECIALIST), 'transfers', 'T-out-forge'), {
      items: [{ productId: 'p1', productName: 'Loaf', qtyDemanded: 10, qtySent: 10, qtyReceived: 10 }],
      status: 'dispatched',
      dispatchedBy: SPECIALIST,
      receivedBy: SPECIALIST,
    }),
  )
})

// --- the reads a compile makes before it writes anything --------------------
//
// The batch was the obvious suspect and it was not the only one. `compileNow`
// reads four things first, and one of them asked a question the rules do not
// allow: "every transfer for this date", with no branch pinned. The owner has
// a blanket list rule, so it passed every time it was tried as the owner — and
// was refused for the baker, who is the person actually pressing the button.

test('the kitchen can make every read a compile starts with', async () => {
  const db = as(SPECIALIST)
  await assertSucceeds(getDocs(collection(db, 'branches')))
  await assertSucceeds(
    getDocs(query(collection(db, 'demands'), where('businessDate', '==', '2026-08-20'))),
  )
  // Both of these are misses on purpose: no list has been built for that date
  // and there is no order from a week ago to repeat. A rule that reaches into
  // resource.data refuses a document that is not there, and the compile asks
  // for both by name on a bakery with no history.
  await assertSucceeds(getDoc(doc(db, 'productionOrders', 'PO-20260820')))
  await assertSucceeds(getDoc(doc(db, 'demands', 'D-20260813-B3')))
  await assertSucceeds(
    getDocs(
      query(
        collection(db, 'transfers'),
        where('fromBranch', '==', 'MAIN'),
        where('businessDate', '==', '2026-08-20'),
      ),
    ),
  )
})

test('the bare "every transfer today" query stays refused for the kitchen', async () => {
  // Kept as a test rather than a note in a comment: the per-branch rule is
  // deliberate, and whoever writes that query next should hear it from a red
  // test rather than from a baker at four in the morning.
  await assertFails(
    getDocs(query(collection(as(SPECIALIST), 'transfers'), where('businessDate', '==', '2026-08-20'))),
  )
})

// --- the whole compile, write by write, as the owner ------------------------
//
// `compileNow` sends every one of these in a single writeBatch, and a batch is
// atomic: one refusal fails all of it with "Missing or insufficient
// permissions" and no clue which write caused it. So each is asserted on its
// own, for the role that actually presses the button.

test('the owner can write the baking list', async () => {
  await assertSucceeds(
    setDoc(
      doc(as(OWNER), 'productionOrders', 'PO-20260820'),
      {
        ref: 'PO-0820',
        businessDate: '2026-08-20',
        status: 'open',
        items: [{ productId: 'bread-small', qtyNeeded: 30, perOutlet: { B2: 30 } }],
        compiledBy: OWNER,
      },
      { merge: true },
    ),
  )
})

test('the owner can lock the order the list was built from', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ctx.firestore().doc('demands/D-20260820-B2'), {
      branchId: 'B2',
      businessDate: '2026-08-20',
      status: 'submitted',
      items: [{ productId: 'bread-small', qty: 30 }],
    })
  })
  await assertSucceeds(
    updateDoc(doc(as(OWNER), 'demands', 'D-20260820-B2'), { status: 'locked' }),
  )
})

test('the owner can write the repeat order for a shop that did not send one', async () => {
  // The one that actually broke it. A compile writes last week's order in for
  // any shop that did not send one, flagged `auto`. The rule allowing that was
  // written for the specialist and never for the owner — so the moment any
  // shop had not ordered, the owner's batch was refused in full and the screen
  // said only "Missing or insufficient permissions".
  await assertSucceeds(
    setDoc(doc(as(OWNER), 'demands', 'D-20260820-MAIN'), {
      ref: 'D-0820-MAIN',
      branchId: 'MAIN',
      businessDate: '2026-08-20',
      status: 'locked',
      auto: true,
      copiedFrom: 'D-20260813-MAIN',
      items: [{ productId: 'bread-small', qty: 20 }],
    }),
  )
})

test('the kitchen can write that repeat order too', async () => {
  await assertSucceeds(
    setDoc(doc(as(SPECIALIST), 'demands', 'D-20260820-B3'), {
      ref: 'D-0820-B3',
      branchId: 'B3',
      businessDate: '2026-08-20',
      status: 'locked',
      auto: true,
      copiedFrom: 'D-20260813-B3',
      items: [{ productId: 'bread-small', qty: 20 }],
    }),
  )
})

test('the owner can write the delivery notes that come with it', async () => {
  await assertSucceeds(
    setDoc(
      doc(as(OWNER), 'transfers', 'T-20260820-B2'),
      {
        ref: 'T-0820-B2',
        fromBranch: 'MAIN',
        toBranchId: 'B2',
        businessDate: '2026-08-20',
        direction: 'out',
        status: 'draft',
        items: [],
      },
      { merge: true },
    ),
  )
})

test('nobody can smuggle a real order in as an automatic one', async () => {
  // `auto: true` is what the repeat clause allows. Without it the clause must
  // not apply, or anyone could write a locked order for any shop.
  await assertFails(
    setDoc(doc(as(SPECIALIST), 'demands', 'D-20260820-FAKE'), {
      branchId: 'B2',
      businessDate: '2026-08-20',
      status: 'locked',
      items: [],
    }),
  )
})
