import { distributedTo, productionValue } from './dailySheet.js'
import { previousDate } from './dates.js'

// The owner's pad, as a register: one ruled line per day, going back.
//
// `dailySheet` answers "how did today go" from the live records. This answers
// "how has the fortnight gone", which is a different question with a different
// source. Reading the raw sales of thirty days to add them up again would be
// thousands of documents for figures that were already totalled the night they
// happened — each outlet's close holds its own takings and its own waste, so
// the register is built from those.
//
// Which means a day nobody closed has no line. That is correct rather than
// unfortunate: an unclosed day is one where nobody counted the drawer, and
// inventing a total for it would put a number in the register that no one
// stands behind.

/** The last `days` business dates, most recent first. */
export function recentDates(today, days = 14) {
  const dates = [today]
  for (let i = 1; i < days; i += 1) dates.push(previousDate(dates[dates.length - 1]))
  return dates
}

function pricesOf(products = []) {
  const prices = {}
  for (const p of products) prices[p.id] = Number(p.price) || 0
  return prices
}

/**
 * One row per day, in the shape of the owner's own sheet.
 *
 * Every figure is money, because that is what he writes. `today` is passed in
 * from the live dashboard rather than rebuilt here — the day is still running,
 * nothing has been closed, and the live figures are the only ones that exist.
 */
export function buildRegister({
  dates = [],
  branches = [],
  products = [],
  closings = [],
  productions = [],
  transfers = [],
  today = null,
  todaySheet = null,
}) {
  const prices = pricesOf(products)
  const byDate = (list, date) => list.filter((r) => r.businessDate === date)

  const rows = dates.map((date) => {
    if (date === today && todaySheet) {
      return {
        date,
        live: true,
        production: todaySheet.production.linesRecorded > 0 ? todaySheet.production.value : null,
        perOutlet: Object.fromEntries(
          todaySheet.outlets.map((o) => [o.branchId, { distributed: o.distributed, sold: o.sold }]),
        ),
        totalSale: todaySheet.totalSale,
        totalStale: todaySheet.totalStale,
        closed: todaySheet.outletsClosed === branches.length,
      }
    }

    const production = productions.find((p) => p.businessDate === date) ?? null
    const dayTransfers = byDate(transfers, date)
    const dayClosings = byDate(closings, date)
    const baked = productionValue(production, prices)

    const perOutlet = {}
    let totalSale = 0
    let stale = 0
    let closedCount = 0

    for (const branch of branches) {
      const closing = dayClosings.find((c) => c.branchId === branch.id)
      const sold = closing?.salesTotal ?? 0
      const distributed = distributedTo({ branch, production, transfers: dayTransfers, prices })
      perOutlet[branch.id] = { distributed: distributed.value, sold: closing ? sold : null }
      if (closing) {
        closedCount += 1
        totalSale += sold
        stale += closing.wasteValue ?? 0
      }
    }

    return {
      date,
      live: false,
      production: baked.linesRecorded > 0 ? baked.value : null,
      perOutlet,
      totalSale: closedCount > 0 ? totalSale : null,
      // Not zero for a day nobody shut. Zero waste is a claim; not knowing is not.
      totalStale: closedCount > 0 ? stale : null,
      closed: closedCount === branches.length,
    }
  })

  // A stretch of days before the shop was on the system prints as a run of
  // empty ruled lines, which looks like the system losing data rather than
  // like the system not having existed yet. Trailing blanks are dropped;
  // blanks *between* trading days are kept, because a day nobody closed in the
  // middle of a working fortnight is exactly what the owner wants to notice.
  let last = rows.length - 1
  while (last >= 0 && rows[last].totalSale === null && rows[last].production === null) last -= 1

  return {
    rows: rows.slice(0, last + 1),
    branches,
    totals: totalsOf(rows.slice(0, last + 1), branches),
  }
}

/** The column at the foot: what the fortnight came to. */
function totalsOf(rows, branches) {
  const perOutlet = {}
  for (const b of branches) perOutlet[b.id] = { distributed: 0, sold: 0 }
  let production = 0
  let totalSale = 0
  let totalStale = 0

  for (const row of rows) {
    production += row.production ?? 0
    totalSale += row.totalSale ?? 0
    totalStale += row.totalStale ?? 0
    for (const b of branches) {
      const at = row.perOutlet[b.id]
      if (!at) continue
      perOutlet[b.id].distributed += at.distributed ?? 0
      perOutlet[b.id].sold += at.sold ?? 0
    }
  }

  return { production, perOutlet, totalSale, totalStale, days: rows.length }
}
