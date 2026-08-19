// The owner acts on what this screen tells him, so the two judgement calls it
// makes — what counts as a week's takings, and what counts as a problem — are
// pinned down here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWeek, findProblems, summariseWaste } from '../src/lib/dashboard.js'
import { isClosed, reopenCount } from '../src/lib/closing.js'

const TODAY = '2026-07-28'
const YESTERDAY = '2026-07-27'

const BRANCHES = [
  { id: 'MAIN', name: 'Main Outlet' },
  { id: 'B2', name: 'Gulberg' },
]

const closed = (branchId, businessDate, salesTotal, extra = {}) => ({
  branchId, businessDate, salesTotal, status: 'closed', ...extra,
})

test('a material nobody has entered yet is not an emergency', () => {
  // Day one: every material reads zero, so all six fired as "running out" and
  // filled the whole section. Said once, and as the thing it actually is.
  const materials = [
    { id: 'flour', name: 'Flour', unit: 'kg', onHand: 0, reorderLevel: 50 },
    { id: 'butter', name: 'Butter', unit: 'kg', onHand: 0, reorderLevel: 10 },
  ]
  const problems = findProblems({
    today: '2026-08-19',
    branches: [],
    closings: [],
    materials,
    purchased: new Set(),
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0].what, /2 raw materials have no stock recorded/)
  assert.match(problems[0].where, /Not the same as running out/)
})

test('a material that was bought and has since run down is still an emergency', () => {
  const problems = findProblems({
    today: '2026-08-19',
    branches: [],
    closings: [],
    materials: [{ id: 'flour', name: 'Flour', unit: 'kg', onHand: 4, reorderLevel: 50 }],
    purchased: new Set(['flour']),
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0].what, /Flour is running out/)
})

test('zero on hand after a purchase means it genuinely ran out', () => {
  const problems = findProblems({
    today: '2026-08-19',
    branches: [],
    closings: [],
    materials: [{ id: 'flour', name: 'Flour', unit: 'kg', onHand: 0, reorderLevel: 50 }],
    purchased: new Set(['flour']),
  })
  assert.match(problems[0].what, /Flour is running out/)
})

test('a shop that took nothing yesterday is not reported as blocked', () => {
  // Day one, and every Monday after a Sunday closure. The warning used to fire
  // on any outlet with no closing, so a system that had never traded announced
  // three blocked tills — none of which were blocked. The till itself has
  // always had the right rule; the dashboard was inventing its own.
  const branches = [{ id: 'MAIN', name: 'Susan Road' }, { id: 'B2', name: 'Gulberg' }]
  const quiet = findProblems({ today: '2026-08-19', branches, closings: [], yesterdaySales: [] })
  assert.equal(quiet.filter((p) => p.what === 'Yesterday was never counted').length, 0)

  // But a shop that did take money and never counted the drawer is still named.
  const traded = findProblems({
    today: '2026-08-19',
    branches,
    closings: [],
    yesterdaySales: [{ branchId: 'B2', total: 400 }],
  })
  const named = traded.filter((p) => p.what === 'Yesterday was never counted')
  assert.equal(named.length, 1)
  assert.match(named[0].where, /Gulberg/)
})

test('a day that was counted and then reopened still blocks the till', () => {
  const problems = findProblems({
    today: '2026-08-19',
    branches: [{ id: 'B2', name: 'Gulberg' }],
    closings: [{ businessDate: '2026-08-18', branchId: 'B2', status: 'reopened' }],
    yesterdaySales: [{ branchId: 'B2', total: 400 }],
  })
  assert.equal(problems.filter((p) => p.what === 'Yesterday was never counted').length, 1)
})

test('a reopened day is open again, everywhere', () => {
  assert.equal(isClosed(null), false)
  assert.equal(isClosed(undefined), false)
  assert.equal(isClosed({ status: 'closed' }), true)
  assert.equal(isClosed({ status: 'closed-late' }), true)
  assert.equal(isClosed({ status: 'no-trade' }), true)
  assert.equal(isClosed({ status: 'reopened' }), false)
})

test('reopens are counted from the event trail', () => {
  assert.equal(reopenCount(null), 0)
  assert.equal(reopenCount({ events: [{ action: 'closed' }] }), 0)
  assert.equal(
    reopenCount({ events: [{ action: 'closed' }, { action: 'reopened' }, { action: 'closed' }, { action: 'reopened' }] }),
    2,
  )
})

test('the week adds every outlet together, day by day, oldest first', () => {
  const week = buildWeek(
    [
      closed('MAIN', YESTERDAY, 3000),
      closed('B2', YESTERDAY, 2000),
      closed('MAIN', '2026-07-26', 1500),
    ],
    TODAY,
    900,
  )
  assert.equal(week.length, 7)
  assert.equal(week.at(-1).date, TODAY)
  assert.equal(week.at(0).date, '2026-07-22', 'oldest first')
  assert.equal(week.at(-1).total, 900, 'today comes from live sales, not a close')
  assert.equal(week.at(-1).isToday, true)
  assert.equal(week.at(-2).total, 5000, 'both outlets counted')
  assert.equal(week.find((d) => d.date === '2026-07-26').total, 1500)
  assert.equal(week.find((d) => d.date === '2026-07-24').total, 0, 'a day with no trade is zero')
})

test('nothing is flagged when the day is running properly', () => {
  const problems = findProblems({
    today: TODAY,
    branches: BRANCHES,
    closings: [closed('MAIN', YESTERDAY, 100), closed('B2', YESTERDAY, 100)],
    transfers: [{ ref: 'T-1', toBranchId: 'B2', status: 'received', items: [{ productName: 'Loaf', qtySent: 5, qtyReceived: 5 }] }],
    order: { missing: [] },
  })
  assert.deepEqual(problems, [])
})

test('a reopened day today is flagged, with who and why', () => {
  const problems = findProblems({
    today: TODAY,
    branches: [],
    closings: [
      { branchId: 'B2', businessDate: TODAY, status: 'reopened', reopenedByName: 'Bilal', reopenReason: 'Closed by mistake' },
    ],
    nameOf: (id) => (id === 'B2' ? 'Gulberg' : id),
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0].what, /reopened/i)
  assert.match(problems[0].where, /Gulberg/)
  assert.match(problems[0].where, /Bilal/)
  assert.match(problems[0].where, /Closed by mistake/)
})

test('an outlet that took money yesterday and never counted it is flagged', () => {
  // Both shops traded; only Susan Road counted its drawer.
  const problems = findProblems({
    today: TODAY,
    branches: BRANCHES,
    closings: [closed('MAIN', YESTERDAY, 100)],
    yesterdaySales: [{ branchId: 'MAIN', total: 100 }, { branchId: 'B2', total: 400 }],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0].where, /Gulberg/)
})

test('a day reopened yesterday and left open still counts as uncounted', () => {
  const problems = findProblems({
    today: TODAY,
    branches: [BRANCHES[1]],
    closings: [{ branchId: 'B2', businessDate: YESTERDAY, status: 'reopened' }],
    yesterdaySales: [{ branchId: 'B2', total: 400 }],
  })
  assert.equal(problems.length, 1, 'a reopened yesterday is not a closed yesterday')
})

test('an unconfirmed delivery and a short one are both raised', () => {
  const problems = findProblems({
    today: TODAY,
    branches: [],
    closings: [],
    transfers: [
      { ref: 'T-0728-B3', toBranchId: 'B3', status: 'dispatched', items: [] },
      {
        ref: 'T-0728-B2',
        toBranchId: 'B2',
        status: 'received',
        items: [
          { productName: 'Chicken Patty', qtySent: 11, qtyReceived: 9, shortReason: 'Damaged in transit' },
          { productName: 'Milk Bread', qtySent: 8, qtyReceived: 8 },
        ],
      },
    ],
  })
  assert.equal(problems.length, 2)
  assert.match(problems[0].what, /not been confirmed/)
  assert.match(problems[1].what, /^2 × Chicken Patty/)
  assert.match(problems[1].where, /Damaged in transit/)
})

test('an outlet baked nothing for is the loudest problem of all', () => {
  const problems = findProblems({
    today: TODAY,
    branches: [],
    closings: [],
    order: { missing: ['B3'] },
    nameOf: () => 'Model Town',
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0].where, /Model Town/)
})

test('waste adds up across outlets and days, ranked by what it cost', () => {
  const summary = summariseWaste([
    {
      wasteQty: 3,
      wasteValue: 660,
      transferVarianceValue: 360,
      byProduct: [
        { productId: 'bread', productName: 'Milk Bread', received: 20, carriedIn: 0, sold: 17, wasted: 3, wastedValue: 660 },
      ],
    },
    {
      wasteQty: 5,
      wasteValue: 900,
      byProduct: [
        { productId: 'patty', productName: 'Chicken Patty', received: 10, carriedIn: 0, sold: 5, wasted: 5, wastedValue: 900 },
        { productId: 'bread', productName: 'Milk Bread', received: 10, carriedIn: 0, sold: 10, wasted: 0, wastedValue: 0 },
      ],
    },
  ])

  assert.equal(summary.wasteQty, 8)
  assert.equal(summary.wasteValue, 1560)
  assert.equal(summary.varianceValue, 360)
  assert.equal(summary.wastePct, 20, '8 binned of 40 available')
  assert.equal(summary.sellThroughPct, 80, '32 sold of 40')
  assert.deepEqual(
    summary.worst.map((w) => [w.productName, w.qty, w.value]),
    [['Chicken Patty', 5, 900], ['Milk Bread', 3, 660]],
    'ranked by money, not quantity',
  )
})

test('a clean week reports no waste rather than dividing by zero', () => {
  assert.deepEqual(summariseWaste([]), {
    days: 0, wasteQty: 0, wasteValue: 0, varianceValue: 0,
    wastePct: 0, sellThroughPct: null, worst: [],
  })
  const nothingWasted = summariseWaste([
    { wasteQty: 0, wasteValue: 0, byProduct: [{ productId: 'a', productName: 'A', received: 10, carriedIn: 0, sold: 10, wasted: 0 }] },
  ])
  assert.equal(nothingWasted.wastePct, 0)
  assert.equal(nothingWasted.sellThroughPct, 100)
  assert.deepEqual(nothingWasted.worst, [])
})

test('the list is capped so it never becomes wallpaper', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    ref: `T-${i}`, toBranchId: 'B2', status: 'dispatched', items: [],
  }))
  assert.equal(findProblems({ today: TODAY, transfers: many }).length, 6)
})
