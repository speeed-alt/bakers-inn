import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPnl,
  daysInMonth,
  monthOf,
  monthsWithData,
  projectMonth,
  salarySheet,
} from '../src/lib/pnl.js'

const branches = [
  { id: 'MAIN', name: 'Main Outlet', isMain: true },
  { id: 'B2', name: 'Gulberg' },
]

const reports = [
  { branchId: 'MAIN', businessDate: '2026-08-01', salesTotal: 20000, wasteValue: 800 },
  { branchId: 'MAIN', businessDate: '2026-08-02', salesTotal: 22000, wasteValue: 1200 },
  { branchId: 'B2', businessDate: '2026-08-01', salesTotal: 30000, wasteValue: 1500 },
  // Last month, and must not be counted.
  { branchId: 'B2', businessDate: '2026-07-30', salesTotal: 99000, wasteValue: 9000 },
]

const purchases = [
  { businessDate: '2026-08-01', total: 18000 },
  { businessDate: '2026-07-15', total: 50000 },
]

const expenses = [
  { type: 'utility', category: 'Electricity', branchId: 'B2', month: '2026-08', amount: 4000 },
  { type: 'salary', personId: 'bilal', branchId: 'B2', month: '2026-08', amount: 35000 },
  { type: 'salary', personId: 'ayesha', branchId: 'MAIN', month: '2026-08', amount: 32000 },
  // Not pinned to an outlet — the owner's own costs.
  { type: 'utility', category: 'Internet', branchId: null, month: '2026-08', amount: 3000 },
  { type: 'salary', personId: 'owner', branchId: null, month: '2026-08', amount: 60000 },
  // Last month.
  { type: 'utility', category: 'Gas', branchId: 'B2', month: '2026-07', amount: 7000 },
]

test('a month is the first seven characters of a business date', () => {
  assert.equal(monthOf('2026-08-12'), '2026-08')
  assert.equal(monthOf(undefined), '')
})

test('each outlet is charged only what is truly its own', () => {
  const { perBranch } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  const gulberg = perBranch.find((b) => b.branchId === 'B2')

  assert.equal(gulberg.takings, 30000)
  assert.equal(gulberg.waste, 1500)
  assert.equal(gulberg.salaries, 35000)
  assert.equal(gulberg.utilities, 4000)
  // Takings less its own waste, salaries and bills — and nothing else.
  assert.equal(gulberg.contribution, 30000 - 1500 - 35000 - 4000)
})

test('no outlet is charged a share of the flour', () => {
  const { perBranch } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  // Materials are Rs 18,000 this month. If any of it had been split across the
  // outlets, at least one contribution would move.
  const main = perBranch.find((b) => b.branchId === 'MAIN')
  assert.equal(main.contribution, 42000 - 2000 - 32000 - 0)
})

test("an outlet is not charged another outlet's bill", () => {
  const { perBranch } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  assert.equal(perBranch.find((b) => b.branchId === 'MAIN').utilities, 0)
})

test('costs with no outlet land on the business, not on a shop', () => {
  const { perBranch, business } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  const branchSalaries = perBranch.reduce((sum, b) => sum + b.salaries, 0)

  assert.equal(branchSalaries, 67000)
  assert.equal(business.sharedSalaries, 60000)
  assert.equal(business.salaries, 127000)
  assert.equal(business.sharedUtilities, 3000)
  assert.equal(business.utilities, 7000)
})

test('the business figure is the one that includes ingredients', () => {
  const { business } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  assert.equal(business.takings, 72000)
  assert.equal(business.materials, 18000)
  assert.equal(business.waste, 3500)
  assert.equal(business.profit, 72000 - 18000 - 3500 - 127000 - 7000)
  assert.equal(business.profit, -83500)
})

test('last month is left out of this month', () => {
  const { business } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  // The July report of 99,000 and the July purchase of 50,000 are both ignored.
  assert.equal(business.takings, 72000)
  assert.equal(business.materials, 18000)
})

test('a month with nothing in it reports zeros, not a guess', () => {
  const { business, perBranch } = buildPnl({ month: '2026-01', branches, reports, purchases, expenses })
  assert.equal(business.takings, 0)
  assert.equal(business.profit, 0)
  assert.equal(business.marginPct, null)
  assert.equal(perBranch.every((b) => b.contribution === 0), true)
})

test('the margin is a percentage of takings, or nothing when nothing was taken', () => {
  const good = buildPnl({
    month: '2026-08',
    branches,
    reports,
    purchases,
    expenses: [{ type: 'salary', branchId: 'B2', month: '2026-08', amount: 5000 }],
  })
  // 72,000 takings; 18,000 materials; 3,500 waste; 5,000 salary -> 45,500
  assert.equal(good.business.profit, 45500)
  assert.equal(good.business.marginPct, 63)
})

test('trading days are counted per outlet, so a shut shop is visible', () => {
  const { perBranch } = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  assert.equal(perBranch.find((b) => b.branchId === 'MAIN').days, 2)
  assert.equal(perBranch.find((b) => b.branchId === 'B2').days, 1)
})

// --- the salary sheet ------------------------------------------------------

const staff = [
  { id: 'ayesha', name: 'Ayesha', role: 'cashier', branchId: 'MAIN' },
  { id: 'bilal', name: 'Bilal', role: 'cashier', branchId: 'B2' },
  { id: 'gone', name: 'Former', role: 'cashier', branchId: 'B2', active: false },
]

test('everybody appears, including the one nobody has paid yet', () => {
  const sheet = salarySheet({ month: '2026-08', staff, expenses, branches })
  assert.deepEqual(sheet.rows.map((r) => r.name), ['Bilal', 'Ayesha'])
  assert.equal(sheet.rows.find((r) => r.name === 'Ayesha').amount, 32000)
  assert.equal(sheet.rows.find((r) => r.name === 'Bilal').amount, 35000)
  assert.equal(sheet.unset, 0)
})

test('somebody unpaid is shown as unset rather than as zero', () => {
  const sheet = salarySheet({
    month: '2026-08',
    staff,
    expenses: [{ type: 'salary', personId: 'bilal', month: '2026-08', amount: 35000 }],
    branches,
  })
  const ayesha = sheet.rows.find((r) => r.name === 'Ayesha')
  assert.equal(ayesha.amount, null)
  assert.equal(ayesha.set, false)
  assert.equal(sheet.unset, 1)
  assert.equal(sheet.total, 35000)
})

test('somebody turned off is off the sheet', () => {
  const sheet = salarySheet({ month: '2026-08', staff, expenses, branches })
  assert.equal(sheet.rows.find((r) => r.name === 'Former'), undefined)
})

test('the sheet groups by outlet, so it can be paid shop by shop', () => {
  const sheet = salarySheet({ month: '2026-08', staff, expenses, branches })
  assert.equal(sheet.rows[0].branchName, 'Gulberg')
  assert.equal(sheet.rows[1].branchName, 'Main Outlet')
})

// --- looking at a month before it has finished ----------------------------

test('a month knows how long it is', () => {
  assert.equal(daysInMonth('2026-08'), 31)
  assert.equal(daysInMonth('2026-02'), 28)
  assert.equal(daysInMonth('2024-02'), 29)
})

test('trading days count the day, not the shops open on it', () => {
  // Three outlets closing the same Tuesday is one day of trading.
  const pnl = buildPnl({ month: '2026-08', branches, reports, purchases, expenses })
  assert.equal(pnl.daysTrading, 2)
})

test('a part-finished month is scaled to what it is on course for', () => {
  const business = {
    takings: 262130,
    materials: 92240,
    waste: 15200,
    salaries: 187000,
    utilities: 256000,
  }
  const projected = projectMonth(business, { daysTrading: 11, days: 31 })

  // Takings and the costs that follow them scale; wages and rent do not, since
  // they are already the whole month and do not grow because more bread sold.
  assert.equal(projected.takings, Math.round(262130 * (31 / 11)))
  assert.equal(projected.salaries, 187000)
  assert.equal(projected.utilities, 256000)
  assert.equal(
    projected.profit,
    projected.takings - projected.materials - projected.waste - 187000 - 256000,
  )

  // The point of the projection: the month-so-far figure is dragged down by
  // fixed costs that the takings have not caught up with, so the projected
  // profit is always the kinder of the two — by exactly the fixed costs that
  // are no longer being charged against a partial month.
  const soFar = business.takings - business.materials - business.waste - 187000 - 256000
  assert.ok(projected.profit > soFar)
})

test('a shop that really is losing money still shows a loss when projected', () => {
  // The projection must not flatter a business into the black. Scaling takings
  // scales the cost of making them too.
  const business = {
    takings: 100000,
    materials: 60000,
    waste: 20000,
    salaries: 90000,
    utilities: 40000,
  }
  const projected = projectMonth(business, { daysTrading: 10, days: 30 })
  assert.ok(projected.profit < 0)
})

test('a finished month is not projected, because there is nothing left to guess', () => {
  const business = { takings: 100, materials: 0, waste: 0, salaries: 0, utilities: 0 }
  assert.equal(projectMonth(business, { daysTrading: 31, days: 31 }), null)
  assert.equal(projectMonth(business, { daysTrading: 0, days: 31 }), null)
})

test('months with figures are listed newest first', () => {
  assert.deepEqual(monthsWithData({ reports, purchases, expenses }), ['2026-08', '2026-07'])
  assert.deepEqual(monthsWithData(), [])
})
