import { onSchedule } from 'firebase-functions/v2/scheduler'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger, setGlobalOptions } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { compileDemands } from './shared/lib/compile.js'
import { buildDailyReport, carryoverFrom } from './shared/lib/dailyReport.js'
import {
  closingDocId,
  demandDocId,
  demandRef,
  productionDocId,
  productionRef,
  reportDocId,
  reportRef,
  transferDocId,
  transferRef,
} from './shared/lib/ids.js'
import { addDays, previousDate } from './shared/lib/dates.js'
import { isValidPin, pinPassword } from './shared/lib/pin.js'
import { onlyForMode } from './shared/lib/practice.js'
import { COMPILE_HOUR, HISTORY_WEEKS, HUB_BRANCH_ID, TIME_ZONE } from './shared/config.js'

// The one piece of server code in the system: every morning, add the outlets'
// orders together into a single baking list and pre-fill a delivery note for
// each shop. It runs on a clock rather than behind a button precisely so nobody
// can forget to press it.

// Every function runs beside the database, in Mumbai. This is not a preference:
// a v2 Firestore trigger has to live in the same region as the database it
// watches, and the default is us-central1, so without this line syncStaffClaims
// and reportOnClose simply refuse to deploy. Keeping the scheduled jobs here too
// means the whole compile talks to Firestore over a short wire rather than
// crossing the planet twice for every read.
//
// maxInstances is a cost fuse, not a capacity plan. Three outlets cannot
// generate meaningful load; what it prevents is a bad deploy or a retry storm
// quietly scaling to hundreds of instances on a billed account overnight.
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 })

initializeApp()
const db = getFirestore()

const SUBMITTED = ['submitted', 'locked']

/** Today's date where the bakery is, not where the server happens to live. */
function todayThere(timeZone = TIME_ZONE) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

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

export async function runCompile(targetDate) {
  const [branchesSnap, demandsSnap, existingSnap] = await Promise.all([
    db.collection('branches').get(),
    db.collection('demands').where('businessDate', '==', targetDate).get(),
    db.collection('productionOrders').doc(productionDocId(targetDate)).get(),
  ])

  const branches = branchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  // Real orders only. A practice tablet writes demands with the same
  // businessDate, and this query matches on that field — so without the
  // filter a trainee's order would be compiled into the real morning bake.
  const demands = onlyForMode(
    demandsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    'demands',
  )
  const existing = existingSnap.exists ? { id: existingSnap.id, ...existingSnap.data() } : null

  // An outlet that missed the cutoff has last week repeated for it, so the
  // kitchen is never left guessing. A shop with no history at all is reported
  // rather than invented.
  const fallbacks = {}
  for (const branch of branches) {
    const submitted = demands.find(
      (d) => d.branchId === branch.id && SUBMITTED.includes(d.status),
    )
    if (submitted) continue
    const past = await lastSameWeekday(branch.id, targetDate)
    if (past) fallbacks[branch.id] = past
  }

  const result = compileDemands({ branches, demands, fallbacks, existing })

  if (result.items.length === 0) {
    logger.info('nothing to compile', { targetDate, missing: result.missing })
    return { targetDate, compiled: false, ...result }
  }

  // Adding a line the kitchen has not seen reopens a finished list; otherwise
  // leave its status alone so a completed morning is not undone.
  const knownBefore = new Set((existing?.items ?? []).map((i) => i.productId))
  const gainedLines = result.items.some((i) => !knownBefore.has(i.productId))
  const status = !existing ? 'open' : gainedLines ? 'open' : (existing.status ?? 'open')

  const batch = db.batch()

  batch.set(
    db.collection('productionOrders').doc(productionDocId(targetDate)),
    {
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

  // Lock every order that went into the list, and write one in for any outlet
  // whose order was repeated from last week — flagged, so it is never mistaken
  // for something a person sent.
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

  // A delivery note per shop, pre-filled with what that shop asked for. One
  // already on its way is never touched.
  const existingTransfers = await db
    .collection('transfers')
    .where('businessDate', '==', targetDate)
    .get()
  const alreadyMoving = new Set(
    onlyForMode(
      existingTransfers.docs.map((d) => ({ id: d.id, ...d.data() })),
      'transfers',
    )
      .filter((t) => t.status !== 'draft')
      .map((t) => t.id),
  )

  for (const transfer of result.transfers) {
    const id = transferDocId(targetDate, transfer.toBranchId)
    if (alreadyMoving.has(id)) {
      logger.info('delivery already sent, leaving it alone', { id })
      continue
    }
    batch.set(
      db.collection('transfers').doc(id),
      {
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

  logger.info('baking list compiled', {
    targetDate,
    lines: result.items.length,
    from: result.compiledFrom,
    autoFilled: result.autoFilled,
    missing: result.missing,
    deliveries: result.transfers.map((t) => t.toBranchId),
  })

  return { targetDate, compiled: true, ...result }
}

/**
 * Mirror a staff record onto their sign-in token.
 *
 * The /users document stays the thing the owner edits; this copies role, outlet
 * and whether they are switched on into custom claims so the security rules can
 * read them without fetching a document. That is what keeps queries working:
 * a rule that reads a document does so once per row and soon exceeds
 * Firestore's per-request limit on a busy day.
 *
 * The new claims reach a device the next time its token refreshes — within the
 * hour, or immediately on next sign-in.
 */
export const syncStaffClaims = onDocumentWritten('users/{uid}', async (event) => {
  const { uid } = event.params
  const after = event.data?.after?.data()

  try {
    if (!after) {
      // The record went away; take their permissions with it.
      await getAuth().setCustomUserClaims(uid, { role: null, branchId: null, active: false })
      logger.info('staff record removed, claims cleared', { uid })
      return
    }
    await getAuth().setCustomUserClaims(uid, {
      role: after.role ?? null,
      branchId: after.branchId ?? null,
      active: after.active !== false,
    })
    logger.info('claims synced', { uid, role: after.role, branchId: after.branchId })
  } catch (error) {
    // A staff document can exist before its auth account does (or in tests).
    logger.warn('could not sync claims', { uid, error: String(error) })
  }
})

/**
 * Compile one outlet's day into a single report.
 *
 * Rebuilt rather than patched, so it can be run again safely — which matters,
 * because a till that was offline at closing time syncs its sales later and the
 * first version of the report would be missing them.
 */
export async function buildReportFor(branchId, businessDate) {
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

  if (!closingSnap.exists) {
    logger.info('day not closed yet, nothing to report', { branchId, businessDate })
    return null
  }

  const report = buildDailyReport({
    branchId,
    businessDate,
    ref: reportRef(businessDate, branchId),
    // Real sales only. This query matches on branch and date, both of
    // which a practice sale carries — so without the filter a training
    // session would be totalled into the shop's real daily report, and
    // from there into the P&L and the next order suggestion.
    sales: onlyForMode(
      salesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      'sales',
    ),
    closing: closingSnap.data(),
    transfersIn: onlyForMode(
      transfersSnap.docs.map((d) => d.data()),
      'transfers',
    ).filter((t) => t.direction !== 'return'),
    production: productionSnap.exists ? productionSnap.data() : null,
    carriedIn: carryoverFrom(previousSnap.exists ? previousSnap.data() : null),
    products: productsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    mainId: HUB_BRANCH_ID,
  })

  await db
    .collection('dailyReports')
    .doc(reportDocId(businessDate, branchId))
    .set({ ...report, builtAt: FieldValue.serverTimestamp() })

  logger.info('daily report built', {
    branchId,
    businessDate,
    takings: report.salesTotal,
    wasteValue: report.wasteValue,
    reconciles: report.reconciles,
  })
  return report
}

/** A day is closed — write its report straight away so the owner can see it. */
export const reportOnClose = onDocumentWritten('closings/{closingId}', async (event) => {
  const after = event.data?.after?.data()
  if (!after?.branchId || !after?.businessDate) return
  try {
    await buildReportFor(after.branchId, after.businessDate)
  } catch (error) {
    logger.error('could not build report on close', { error: String(error) })
  }
})

/**
 * Morning rebuild.
 *
 * Sales rung while a till was offline arrive whenever it reconnects, which can
 * be after the day was closed. Rebuilding yesterday once more each morning lets
 * the figures settle by themselves instead of needing anyone to notice.
 */
export const rebuildYesterdaysReports = onSchedule(
  { schedule: '0 6 * * *', timeZone: TIME_ZONE, retryCount: 3 },
  async () => {
    const yesterday = previousDate(todayThere())
    const branches = await db.collection('branches').get()
    for (const branch of branches.docs) {
      try {
        await buildReportFor(branch.id, yesterday)
      } catch (error) {
        logger.error('rebuild failed', { branchId: branch.id, error: String(error) })
      }
    }
  },
)

export const compileDailyOrders = onSchedule(
  { schedule: `0 ${COMPILE_HOUR} * * *`, timeZone: TIME_ZONE, retryCount: 3 },
  async () => {
    await runCompile(todayThere())
  },
)

/**
 * Manual run — for testing against the emulators, and as the recovery path if
 * the scheduled job ever misses. Locked behind a key in the cloud; open only
 * when running locally.
 */
export const compileNow = onRequest(async (req, res) => {
  const key = process.env.COMPILE_KEY
  const local = process.env.FUNCTIONS_EMULATOR === 'true'
  if (!local && (!key || req.query.key !== key)) {
    res.status(403).send('forbidden')
    return
  }
  const targetDate = typeof req.query.date === 'string' ? req.query.date : todayThere()
  try {
    res.json(await runCompile(targetDate))
  } catch (error) {
    logger.error('compile failed', error)
    res.status(500).send(String(error))
  }
})


/**
 * Give somebody a new PIN.
 *
 * The one thing the owner could not do for himself. PINs are never stored —
 * the Auth password is a hash of the PIN and a per-person salt — so a forgotten
 * one could not be looked up, and could not be changed either: setting another
 * account's password needs the Admin SDK, which is only available here. Until
 * this existed, a cashier who forgot their PIN at seven on a Friday stopped the
 * shop until somebody found a laptop with the admin key on it.
 *
 * The owner never learns the PIN and neither does this function keep it: the
 * new one arrives, becomes a password hash, and is gone. Which means the person
 * has to be told it out loud, and can change it again the same way.
 *
 * Owner only, checked against the token rather than the /users document — the
 * same source the security rules read, so this cannot be talked into trusting a
 * document somebody edited.
 */
export const setStaffPin = onCall(async (request) => {
  const token = request.auth?.token
  if (!token || token.role !== 'owner' || token.active !== true) {
    throw new HttpsError('permission-denied', 'Only the owner can set a PIN.')
  }

  const { uid, pin } = request.data ?? {}
  if (typeof uid !== 'string' || !uid) {
    throw new HttpsError('invalid-argument', 'Which person?')
  }
  if (!isValidPin(pin)) {
    throw new HttpsError('invalid-argument', 'A PIN is exactly four digits.')
  }

  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such person.')
  }

  // The password is derived from the login id, not the auth uid — they differ
  // for anyone created through the app, and deriving from the wrong one would
  // set a password nobody could ever sign in with.
  const loginId = snap.data().loginId
  if (!loginId) {
    throw new HttpsError('failed-precondition', 'That person has no login id.')
  }

  await getAuth().updateUser(uid, { password: await pinPassword(loginId, pin) })

  // Not the PIN. Never the PIN.
  logger.info('staff PIN changed', { uid, by: request.auth.uid })
  return { ok: true }
})
