#!/usr/bin/env node
// Fill the system with a believable fortnight so every screen has something on
// it — for showing the owner, not for going live.
//
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/demo-day.mjs
//
// Everything it writes is stamped `demo: true`, so `--clear` can take it all
// out again and leave nothing behind. Real records never carry that flag.
//
// The shape is deliberately imperfect: one short bake, one delivery that
// arrived light, a day reopened, some waste. A demo where everything reconciles
// shows none of the screens that matter — the ones that exist precisely because
// days do not go to plan.

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

import { addDays, businessDateOf, compactDate, shortDate } from '../src/lib/dates.js'
import {
  closingDocId,
  demandDocId,
  demandRef,
  reportDocId,
  reportRef,
  saleDocId,
  saleRef,
  transferDocId,
  transferRef,
} from '../src/lib/ids.js'

const projectId = process.env.SEED_PROJECT || process.env.GCLOUD_PROJECT
if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set SEED_PROJECT and GOOGLE_APPLICATION_CREDENTIALS first.')
  process.exit(1)
}

initializeApp({ projectId, credential: applicationDefault() })
const db = getFirestore()

const CLEAR = process.argv.includes('--clear')
const TODAY = businessDateOf()

// Filling a live project with invented trading is a one-way door: the figures
// look real, the owner reads them, and `lib/suggest.js` orders tomorrow's flour
// off them. It was written for `bakers-inn-pk` and says so at the top of this
// file, so the guard cannot simply refuse a real project — but it can make
// somebody say out loud that they meant it. Clearing is always allowed: that is
// the safe direction, and it is the one somebody will be in a hurry to run.
const projectIsLive = !projectId.startsWith('demo-')
if (!CLEAR && projectIsLive && !process.argv.includes('--yes-fill-live-project')) {
  console.error(
    `\nRefusing to fill '${projectId}' with demo data.\n\n` +
      'That project is not an emulator. If this is still the demo phase, re-run\n' +
      'with --yes-fill-live-project. If the bakery is trading on it, do not:\n' +
      'clear it instead with --clear, and check every collection reads empty\n' +
      'before anybody rings a real sale.\n',
  )
  process.exit(1)
}

// A whole month, not a week. Wages and rent are monthly costs, and setting a
// month of them against ten days of takings makes a healthy bakery look like it
// is losing money — which is an artefact of the demo, not a finding.
const HISTORY_DAYS = 30

// A steady, deterministic shuffle. Real randomness would make two runs
// disagree, and a demo that changes every time is impossible to talk about.
let seed = 20260812
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = (n, spread) => Math.max(0, Math.round(n + (rand() - 0.5) * spread))

// What each outlet sells in a day, roughly. Gulberg is the busy one.
const SHAPE = {
  MAIN: 1.0,
  B2: 1.25,
  B3: 0.75,
}

// The lines that make up a normal day. Ids match scripts/seed.mjs.
const BASKET = [
  { id: 'bread-small', code: '01', name: 'Bread Small', price: 120, perDay: 30 },
  { id: 'bread-large', code: '02', name: 'Bread Large', price: 220, perDay: 24 },
  { id: 'vip-bread', code: '03', name: 'VIP Bread', price: 350, perDay: 8 },
  { id: 'rusk', code: '05', name: 'Rusk', price: 150, perDay: 14, keeps: true },
  { id: 'donut-small', code: '06', name: 'Donut Small', price: 50, perDay: 26 },
  { id: 'paties', code: '24', name: 'Paties', price: 100, perDay: 20 },
  { id: 'samosi', code: '28', name: 'Samosi', price: 50, perDay: 34 },
  { id: 'chicken-roll', code: '27', name: 'Chicken Roll', price: 120, perDay: 16 },
  { id: 'reg-pastry', code: '20', name: 'Reg. Pastry', price: 100, perDay: 12 },
]

const STAFF = {
  MAIN: { id: 'ayesha', name: 'Ayesha' },
  B2: { id: 'bilal', name: 'Bilal' },
  B3: { id: 'hina', name: 'Hina' },
}

const demo = { demo: true }

/**
 * Take the demo back out.
 *
 * This has to be exhaustive rather than nearly exhaustive. What is left behind
 * does not sit there harmlessly: `lib/suggest.js` reads old reports to decide
 * how much to bake, the P&L reads expenses, and the days-left figure reads the
 * material counts. Anything missed here becomes a real decision made on
 * invented evidence, weeks later, with nothing on screen to say so.
 *
 * `expenses` was missing from this list until 2026-08-13, which left a month of
 * fabricated wages and bills — around Rs 346,000 of them — in the owner's
 * profit figure after a clear that reported success.
 */
async function wipe() {
  const collections = [
    'sales', 'closings', 'transfers', 'demands', 'productionOrders',
    'dailyReports', 'purchases', 'stockMovements', 'dailyRates', 'clientErrors',
    'expenses',
  ]
  let removed = 0
  for (const name of collections) {
    const snap = await db.collection(name).where('demo', '==', true).get()
    for (const chunk of chunks(snap.docs, 400)) {
      const batch = db.batch()
      for (const d of chunk) batch.delete(d.ref)
      await batch.commit()
      removed += chunk.length
    }
  }

  const reset = await resetMaterials()
  console.log(`Removed ${removed} demo records, and reset ${reset} raw materials.`)
  await reportLeftovers(collections)
}

/**
 * What is still there once the flagged records have gone.
 *
 * Counting the flagged deletions proves only that the delete ran. The question
 * that actually matters before going live is what is *left*, and the answer is
 * not always nothing: a record written by hand while testing, or one made
 * before the flag existed, has no `demo: true` on it and no way to be found by
 * one. Printing the count is what turns "the script said it worked" into
 * something somebody can check.
 */
async function reportLeftovers(collections) {
  const left = []
  for (const name of collections) {
    const snap = await db.collection(name).limit(20).get()
    if (!snap.empty) left.push([name, snap.size, snap.docs.map((d) => d.id)])
  }

  if (left.length === 0) {
    console.log('\nEvery trading collection now reads empty. Safe to start.')
    return
  }

  console.log('\nStill holding records, with no demo flag to remove them by:')
  for (const [name, size, ids] of left) {
    const shown = ids.slice(0, 5).join(', ')
    console.log(`  ${name}: ${size === 20 ? '20+' : size} — ${shown}${size > 5 ? ', …' : ''}`)
  }
  console.log(
    '\nEach one is a real record as far as every screen is concerned. Look at it\n' +
      'before the bakery starts trading, and remove it by hand if it was a test.\n',
  )
  process.exitCode = 1
}

/**
 * Raw materials cannot simply be deleted — the documents are real, made by the
 * seed, and the catalogue of what this bakery buys is not demo data. What is
 * demo is the counting written *onto* them: an on-hand figure, a last count,
 * and a usage rate, all invented. They carry no `demo` flag to find them by,
 * because they were merged into documents that already existed.
 *
 * So this resets the counted fields and leaves the material itself alone. A
 * material with no count is the correct state for a bakery that has not started
 * counting yet: the screen says "not known" rather than quoting a number nobody
 * measured.
 */
async function resetMaterials() {
  const snap = await db.collection('rawMaterials').get()
  let n = 0
  for (const chunk of chunks(snap.docs, 400)) {
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
      n += 1
    }
    await batch.commit()
  }
  return n
}

function* chunks(list, size) {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size)
}

/** One day's sales at one outlet, as separate transactions. */
function salesFor(branchId, date, scale) {
  const out = []
  const staff = STAFF[branchId]
  const transactions = Math.round(14 * scale + rand() * 6)

  for (let n = 1; n <= transactions; n += 1) {
    const items = []
    const howMany = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < howMany; i += 1) {
      const product = BASKET[Math.floor(rand() * BASKET.length)]
      if (items.find((x) => x.productId === product.id)) continue
      items.push({
        productId: product.id,
        code: product.code,
        name: product.name,
        price: product.price,
        qty: 1 + Math.floor(rand() * 3),
      })
    }
    if (items.length === 0) continue

    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0)
    const payment = rand() > 0.22 ? 'cash' : 'card'
    const cashGiven = payment === 'cash' ? Math.ceil(total / 500) * 500 : null
    // One voided sale a day, so the dashboard's void count is not always zero.
    const status = n === 4 && rand() > 0.6 ? 'voided' : 'normal'

    // Spread across trading hours so the times on the sales list look real.
    const at = new Date(`${date}T08:00:00`)
    at.setMinutes(at.getMinutes() + Math.round((n / transactions) * 660))

    out.push({
      // No install token: there is no browser here, and demo ids stay stable
      // across re-runs so a repeated build overwrites rather than piles up.
      id: saleDocId(branchId, date, n, 'A', ''),
      body: {
        ...demo,
        ref: saleRef(branchId, date, n, 'A'),
        branchId,
        businessDate: date,
        cashierId: staff.id,
        cashierName: staff.name,
        device: 'A',
        payment,
        status,
        ...(status === 'voided'
          ? { voidReason: 'Rung by mistake', voidedBy: staff.id, voidedAt: Timestamp.fromDate(at) }
          : {}),
        items,
        total,
        cashGiven,
        changeGiven: cashGiven ? cashGiven - total : null,
        localAt: Timestamp.fromDate(at),
        createdAt: FieldValue.serverTimestamp(),
      },
    })
  }
  return out
}

/** The order an outlet sends for a given day. */
function demandFor(branchId, date, scale, status = 'locked') {
  return {
    id: demandDocId(date, branchId),
    body: {
      ...demo,
      ref: demandRef(date, branchId),
      branchId,
      businessDate: date,
      status,
      items: BASKET.map((p) => ({
        productId: p.id,
        code: p.code,
        productName: p.name,
        qty: pick(p.perDay * scale, 4),
      })),
      updatedAt: FieldValue.serverTimestamp(),
    },
  }
}

async function history() {
  const batchOf = []

  for (let back = HISTORY_DAYS; back >= 1; back -= 1) {
    const date = addDays(TODAY, -back)

    for (const [branchId, scale] of Object.entries(SHAPE)) {
      const sales = salesFor(branchId, date, scale)
      for (const sale of sales) batchOf.push(['sales', sale.id, sale.body])

      const live = sales.filter((s) => s.body.status !== 'voided')
      const takings = live.reduce((sum, s) => sum + s.body.total, 0)
      const cash = live.filter((s) => s.body.payment === 'cash').reduce((s, x) => s + x.body.total, 0)

      // What each product did that day, which is what the reports are built on.
      //
      // Deliveries are worked back from what actually sold plus a small
      // surplus, not invented independently. Inventing them produced a shop
      // that binned a third of everything it baked and ran at a loss — which is
      // a fair description of the generator and a libel on the bakery. A real
      // one bakes a little over and throws out a few percent.
      const byProduct = BASKET.map((p) => {
        const sold = live.reduce(
          (sum, s) => sum + (s.body.items.find((i) => i.productId === p.id)?.qty ?? 0),
          0,
        )
        const surplus = Math.round(sold * (0.04 + rand() * 0.07))
        const received = sold + surplus
        // Something that keeps is carried over rather than binned, so only a
        // little of its surplus is ever waste.
        const wasted = p.keeps ? Math.round(surplus * 0.25) : surplus
        return {
          productId: p.id,
          productName: p.name,
          carriedIn: 0,
          received,
          sold,
          wasted,
          wastedValue: wasted * p.price,
        }
      })

      const wasteQty = byProduct.reduce((s, p) => s + p.wasted, 0)
      const wasteValue = byProduct.reduce((s, p) => s + p.wastedValue, 0)

      batchOf.push([
        'closings',
        closingDocId(date, branchId),
        {
          ...demo,
          branchId,
          businessDate: date,
          status: 'closed',
          salesTotal: takings,
          cashTotal: cash,
          cardTotal: takings - cash,
          countedCash: cash + (back === 3 && branchId === 'B2' ? -120 : 0),
          overShort: back === 3 && branchId === 'B2' ? -120 : 0,
          closedBy: STAFF[branchId].id,
          closedByName: STAFF[branchId].name,
          closedAt: Timestamp.fromDate(new Date(`${date}T20:30:00`)),
          waste: byProduct.filter((p) => p.wasted > 0).map((p) => ({
            productId: p.productId,
            productName: p.productName,
            qty: p.wasted,
            reason: 'Unsold',
          })),
          carry: [],
          events: [{ action: 'closed', by: STAFF[branchId].id, at: Timestamp.fromDate(new Date(`${date}T20:30:00`)) }],
        },
      ])

      batchOf.push([
        'dailyReports',
        reportDocId(date, branchId),
        {
          ...demo,
          ref: reportRef(date, branchId),
          branchId,
          businessDate: date,
          salesTotal: takings,
          cashTotal: cash,
          cardTotal: takings - cash,
          txCount: live.length,
          overShort: back === 3 && branchId === 'B2' ? -120 : 0,
          wasteQty,
          wasteValue,
          transferVarianceValue: back === 5 && branchId === 'B3' ? 240 : 0,
          byProduct,
          reconciles: true,
          builtAt: FieldValue.serverTimestamp(),
        },
      ])

      // Yesterday's order, so today's compile has something real to add up.
      if (back === 1) {
        const order = demandFor(branchId, TODAY, scale, 'submitted')
        batchOf.push(['demands', order.id, order.body])
      }
    }
  }

  return batchOf
}

/** Today, up to the point where the shops are trading. */
async function todayRun() {
  const writes = []

  // Yesterday left a little on the shelves, so the stock screen has carry-in.
  for (const branchId of Object.keys(SHAPE)) {
    const id = closingDocId(addDays(TODAY, -1), branchId)
    writes.push([
      'closings',
      id,
      {
        carry: [
          { productId: 'rusk', productName: 'Rusk', qty: pick(6, 4) },
          { productId: 'biscuit-box', productName: 'Biscuit Box', qty: pick(3, 2) },
        ],
      },
      true, // merge
    ])
  }

  // Wages and bills, so the profit figure is a real one rather than takings
  // less flour. These are what turn a gross margin into a profit.
  const month = TODAY.slice(0, 7)
  const wages = [
    ['ayesha', 'Ayesha', 'MAIN', 45000],
    ['bilal', 'Bilal', 'B2', 42000],
    ['hina', 'Hina', 'B3', 42000],
    ['usman', 'Usman', 'MAIN', 58000],
  ]
  for (const [personId, personName, branchId, amount] of wages) {
    writes.push([
      'expenses',
      `SAL-${month.replace('-', '')}-${personId}`,
      {
        ...demo,
        type: 'salary',
        category: 'Salary',
        personId,
        personName,
        branchId,
        month,
        businessDate: TODAY,
        amount,
        updatedBy: 'owner',
        updatedByName: 'Owner',
        updatedAt: FieldValue.serverTimestamp(),
      },
    ])
  }

  // Sized so the three shops together run at a believable margin. The first
  // pass put rent and power at a third of takings, which left the whole
  // business breaking even — a fair description of my arithmetic and a libel on
  // the bakery, same as the waste figures were.
  const bills = [
    ['MAIN', 'Electricity', 22000],
    ['MAIN', 'Gas', 9000],
    ['MAIN', 'Rent', 35000],
    ['B2', 'Electricity', 18000],
    ['B2', 'Rent', 30000],
    ['B3', 'Electricity', 14000],
    ['B3', 'Rent', 25000],
    [null, 'Internet', 6000],
  ]
  for (const [branchId, category, amount] of bills) {
    const slug = category.toLowerCase()
    writes.push([
      'expenses',
      `UTL-${month.replace('-', '')}-${branchId ?? 'ALL'}-${slug}`,
      {
        ...demo,
        type: 'utility',
        category,
        branchId,
        month,
        businessDate: TODAY,
        amount,
        updatedBy: 'owner',
        updatedByName: 'Owner',
        updatedAt: FieldValue.serverTimestamp(),
      },
    ])
  }

  // Materials: a delivery this week and a count, so usage and days-left work.
  // Sized to land materials near a third of a week's takings, which is roughly
  // what a bakery this size spends. The first pass bought nearly half and made
  // the gross margin negative.
  const materials = [
    ['flour', 'Flour', 'kg', 180, 80],
    ['sugar', 'Sugar', 'kg', 160, 25],
    ['butter', 'Butter', 'kg', 1400, 10],
    ['eggs', 'Eggs', 'dozen', 350, 20],
    ['cooking-oil', 'Cooking Oil', 'litre', 560, 12],
  ]
  const counted = addDays(TODAY, -1)

  // A delivery a week, so a month of ingredients sits against a month of
  // takings. One weekly delivery would have understated the cost fourfold.
  for (let week = 0; week < 4; week += 1) {
    const bought = addDays(TODAY, -1 - week * 7)
    writes.push([
      'purchases',
      `P-${compactDate(bought)}-DEMO`,
      {
        ...demo,
        ref: `P-${compactDate(bought)}-DEMO`,
        businessDate: bought,
        supplier: 'Al-Karam Traders',
        items: materials.map(([id, name, unit, cost, qty]) => ({
          materialId: id,
          materialName: name,
          unit,
          qty,
          unitCost: cost,
          lineTotal: qty * cost,
        })),
        total: materials.reduce((sum, [, , , cost, qty]) => sum + cost * qty, 0),
        createdBy: 'owner',
        createdByName: 'Owner',
        createdAt: FieldValue.serverTimestamp(),
      },
    ])
  }

  for (const [id, name, unit, cost, qty] of materials) {
    // Counted five days later at about two thirds — that gap is what teaches
    // the system the usage rate, and so the days-left figure.
    const left = Math.round(qty * 0.62)
    writes.push([
      'rawMaterials',
      id,
      {
        name,
        unit,
        costPerUnit: cost,
        onHand: left,
        receivedSinceCount: 0,
        spoiledSinceCount: 0,
        lastCountQty: left,
        lastCountAt: Timestamp.fromDate(new Date(`${counted}T09:00:00`)),
        usagePerDay: Math.round(((qty - left) / 5) * 100) / 100,
        active: true,
      },
      true,
    ])
  }

  // Today's sales, part-way through the day.
  for (const [branchId, scale] of Object.entries(SHAPE)) {
    for (const sale of salesFor(branchId, TODAY, scale * 0.55)) {
      writes.push(['sales', sale.id, sale.body])
    }
  }

  return writes
}

async function commit(writes) {
  for (const chunk of chunks(writes, 400)) {
    const batch = db.batch()
    for (const [collection, id, body, merge] of chunk) {
      batch.set(db.collection(collection).doc(id), body, merge ? { merge: true } : {})
    }
    await batch.commit()
  }
}

async function main() {
  if (CLEAR) {
    await wipe()
    return
  }

  console.log(`Filling ${projectId} with demo data up to ${TODAY}…\n`)

  const past = await history()
  await commit(past)
  console.log(`✓ ${HISTORY_DAYS} days of trading at three outlets`)
  console.log('  sales, closings and daily reports — so the week chart, waste and margin have figures')

  const now = await todayRun()
  await commit(now)
  console.log("✓ today's sales in progress, yesterday's leftovers carried in")
  console.log('✓ a materials delivery and a count, so usage and days-left are real')
  console.log("✓ three outlet orders waiting for today's compile")

  console.log('\nNext: build the baking list, then walk it through the kitchen:')
  console.log('  node scripts/compile-now.mjs --demo')
  console.log('  node scripts/demo-kitchen.mjs')
  console.log('\nTo take it all out again:  node scripts/demo-day.mjs --clear')
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('\nDemo data failed.\n')
    console.error(error)
    process.exit(1)
  },
)
