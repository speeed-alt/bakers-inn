// Profit and loss, told honestly.
//
// The hard part is not the arithmetic, it is knowing which figures belong to
// which shop. Three of the four costs can be pinned to an outlet: its salaries,
// its electricity bill, its rent. The fourth cannot. Flour is bought once, at
// the hub, and baked into bread that goes to all three — and without recipes
// there is no honest way to say what Gulberg's share of a sack was.
//
// So this reports two different things and says which is which:
//
//   Per outlet   takings, less what that outlet binned, less its own salaries
//                and bills. Everything here is a fact about that shop. It stops
//                short of ingredients, so it is a contribution, not a profit.
//
//   Whole business  all of the above, plus what was actually spent on
//                   materials. This one is the profit.
//
// The alternative — splitting materials across outlets by share of takings —
// would produce a per-shop profit figure that looks authoritative and is
// invented. A shop could be closed on the strength of it. The owner already
// rejected recipe tracking, which is the only thing that would make that
// division real, so the honest answer is to leave the line where it is and
// label it.

export const SALARY = 'salary'
export const UTILITY = 'utility'

/** '2026-08-12' -> '2026-08'. */
export function monthOf(businessDate) {
  return String(businessDate ?? '').slice(0, 7)
}

/** How many days the month has. */
export function daysInMonth(month) {
  const [year, m] = String(month).split('-').map(Number)
  if (!year || !m) return 30
  return new Date(year, m, 0).getDate()
}

/**
 * What the month is on course for, at the rate it has gone so far.
 *
 * Looked at on the 11th, a monthly profit is always frightening: wages and rent
 * are the whole month's and the takings are a third of it. That is arithmetic,
 * not a failing shop, and an owner who reads it as the latter might do
 * something drastic. So the screen shows both — what has actually happened, and
 * what the month is heading for if the rest of it goes like the part that has.
 *
 * Only takings and the costs that move with them are scaled. Wages and rent are
 * already the whole month and do not grow because more bread was sold.
 */
export function projectMonth(business, { daysTrading, days }) {
  if (!daysTrading || daysTrading >= days) return null
  const scale = days / daysTrading
  const takings = Math.round(business.takings * scale)
  const materials = Math.round(business.materials * scale)
  const waste = Math.round(business.waste * scale)
  const profit = takings - materials - waste - business.salaries - business.utilities
  return {
    takings,
    materials,
    waste,
    salaries: business.salaries,
    utilities: business.utilities,
    profit,
    marginPct: takings > 0 ? Math.round((profit / takings) * 100) : null,
  }
}

function inMonth(record, month) {
  return monthOf(record?.businessDate ?? record?.month ?? '') === month
}

/**
 * Add up one month.
 *
 * Takings and waste come from the compiled daily reports rather than from raw
 * sales, so this agrees with what each outlet saw at its own closing. A month
 * with no closed days reports zeros rather than guessing from live sales — a
 * half-finished day would make the figure move every time it was looked at.
 */
export function buildPnl({
  month,
  branches = [],
  reports = [],
  purchases = [],
  expenses = [],
} = {}) {
  const forMonth = {
    reports: reports.filter((r) => inMonth(r, month)),
    purchases: purchases.filter((p) => inMonth(p, month)),
    expenses: expenses.filter((e) => inMonth(e, month)),
  }

  const perBranch = branches.map((branch) => {
    const mine = forMonth.reports.filter((r) => r.branchId === branch.id)
    const myExpenses = forMonth.expenses.filter((e) => e.branchId === branch.id)

    const takings = mine.reduce((sum, r) => sum + (r.salesTotal ?? 0), 0)
    const waste = mine.reduce((sum, r) => sum + (r.wasteValue ?? 0), 0)
    const salaries = myExpenses
      .filter((e) => e.type === SALARY)
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)
    const utilities = myExpenses
      .filter((e) => e.type !== SALARY)
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)

    return {
      branchId: branch.id,
      branchName: branch.name ?? branch.id,
      days: new Set(mine.map((r) => r.businessDate)).size,
      takings,
      waste,
      salaries,
      utilities,
      // Deliberately not called profit. Ingredients are missing from it, and a
      // number called profit that is missing its largest cost is a lie.
      contribution: takings - waste - salaries - utilities,
    }
  })

  // Anything not pinned to an outlet: the owner's own costs, a bill for the
  // whole business, a salary for somebody who works across all three.
  const shared = forMonth.expenses.filter((e) => !e.branchId)
  const sharedSalaries = shared
    .filter((e) => e.type === SALARY)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0)
  const sharedUtilities = shared
    .filter((e) => e.type !== SALARY)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0)

  const materials = forMonth.purchases.reduce((sum, p) => sum + (p.total ?? 0), 0)

  const takings = perBranch.reduce((sum, b) => sum + b.takings, 0)
  const waste = perBranch.reduce((sum, b) => sum + b.waste, 0)
  const salaries = perBranch.reduce((sum, b) => sum + b.salaries, 0) + sharedSalaries
  const utilities = perBranch.reduce((sum, b) => sum + b.utilities, 0) + sharedUtilities
  const profit = takings - materials - waste - salaries - utilities

  // Distinct days any outlet closed. Not the sum of each outlet's days: three
  // shops closing the same Tuesday is one day of trading, not three.
  const daysTrading = new Set(forMonth.reports.map((r) => r.businessDate)).size

  return {
    month,
    perBranch,
    days: daysInMonth(month),
    daysTrading,
    business: {
      takings,
      materials,
      waste,
      salaries,
      utilities,
      sharedSalaries,
      sharedUtilities,
      profit,
      // Null rather than zero when nothing was taken: 0% reads as a catastrophe
      // rather than as a month that has not started.
      marginPct: takings > 0 ? Math.round((profit / takings) * 100) : null,
    },
  }
}

/**
 * The month's salary sheet, one line per person.
 *
 * Everybody on the staff appears, including anyone not yet paid, because a
 * sheet that silently omits the person you forgot is worse than no sheet.
 */
export function salarySheet({ month, staff = [], expenses = [], branches = [] }) {
  const paid = new Map(
    expenses
      .filter((e) => e.type === SALARY && monthOf(e.month ?? e.businessDate) === month)
      .map((e) => [e.personId, e]),
  )
  const nameOf = (id) => branches.find((b) => b.id === id)?.name ?? id

  const rows = staff
    .filter((person) => person.active !== false)
    .map((person) => {
      const entry = paid.get(person.id)
      return {
        personId: person.id,
        name: person.name,
        role: person.role,
        branchId: person.branchId,
        branchName: nameOf(person.branchId),
        amount: entry?.amount ?? null,
        note: entry?.note ?? null,
        set: Boolean(entry),
      }
    })
    .sort(
      (a, b) =>
        String(a.branchName).localeCompare(String(b.branchName)) ||
        String(a.name).localeCompare(String(b.name)),
    )

  return {
    month,
    rows,
    total: rows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    unset: rows.filter((r) => !r.set).length,
  }
}

/** The months that have any figures at all, newest first. */
export function monthsWithData({ reports = [], expenses = [], purchases = [] } = {}) {
  const months = new Set()
  for (const r of reports) months.add(monthOf(r.businessDate))
  for (const p of purchases) months.add(monthOf(p.businessDate))
  for (const e of expenses) months.add(monthOf(e.month ?? e.businessDate))
  return [...months].filter(Boolean).sort().reverse()
}
