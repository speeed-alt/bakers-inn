// What is on the shelf right now, at every outlet.
//
// Nothing counts stock continuously — the shops count once, at closing. So this
// works it out the same way the close screen does: what yesterday left, plus
// what arrived today, less what has been sold. Deriving it here rather than in
// the screen is the point: two places computing "what should be on the shelf"
// would eventually give two answers, and the one the owner reads at home would
// not be the one the cashier is looking at.

import { hubStock } from './compile.js'
import { committedOut } from './dispatch.js'
import { buildLeftovers } from './leftovers.js'
import { carryoverFrom } from './dailyReport.js'

/**
 * What one outlet took in today.
 *
 * A shop receives deliveries. The hub does not send itself anything — what it
 * keeps is whatever it made and did not put on a note, which is worked out from
 * the production order by `hubStock`.
 *
 * Only deliveries that have actually been counted in are included. A note still
 * in the van is not stock on a shelf, and treating it as such is how a shop ends
 * up "having" bread it cannot find.
 *
 * **A return arriving is an arrival.** This used to skip every note marked
 * `return`, on the reasoning that stock going back the other way is not a
 * delivery — but the loop above has already narrowed to notes addressed *to*
 * this outlet, so what is left is the hub receiving crates. Skipping them meant
 * unsold bread sent back at closing left the shop's books, where it was
 * correctly no longer carried, and never appeared on the hub's: forty loaves
 * checked in by name, by a person, and then accounted for nowhere in the
 * system. The stock that went back was silently destroyed every night.
 */
export function receivedAt({ branchId, isMain = false, transfers = [], production = null }) {
  const arrived = {}

  for (const transfer of transfers) {
    if (transfer.toBranchId !== branchId) continue
    if (transfer.status !== 'received') continue
    for (const item of transfer.items ?? []) {
      arrived[item.productId] =
        (arrived[item.productId] ?? 0) + (item.qtyReceived ?? item.qtySent ?? 0)
    }
  }

  if (isMain && production) {
    const spokenFor = committedOut(branchId, transfers)
    for (const [productId, qty] of Object.entries(hubStock(production, spokenFor))) {
      arrived[productId] = (arrived[productId] ?? 0) + qty
    }
  }

  return arrived
}

/**
 * Quantities sold today, keyed by product.
 *
 * The field is `items`, matching what `recordSale` writes and what
 * `summariseDay` reads. Reading anything else here would silently report that
 * nothing had sold all day, which looks like a quiet shop rather than a bug.
 *
 * A voided sale did not sell anything. A refund keeps its negative quantity,
 * so subtracting happens by simply adding it up.
 */
export function soldAt(sales = [], branchId = null) {
  const sold = {}
  for (const sale of sales) {
    if (branchId && sale.branchId !== branchId) continue
    if (sale.status === 'voided') continue
    for (const item of sale.items ?? []) {
      sold[item.productId] = (sold[item.productId] ?? 0) + (Number(item.qty) || 0)
    }
  }
  return sold
}

/**
 * One outlet's shelf, product by product.
 *
 * The same `buildLeftovers` the close wizard uses, so the figure the owner sees
 * at eleven in the morning is the one the cashier will be asked to confirm at
 * closing time.
 */
export function stockAt({
  products = [],
  branch,
  transfers = [],
  production = null,
  sales = [],
  previousClosing = null,
}) {
  const branchId = branch?.id
  const lines = buildLeftovers({
    products,
    received: receivedAt({
      branchId,
      isMain: Boolean(branch?.isMain),
      transfers,
      production,
    }),
    sold: soldAt(sales, branchId),
    carriedIn: carryoverFrom(previousClosing),
  })

  return {
    branchId,
    branchName: branch?.name ?? branchId,
    lines,
    onShelf: lines.reduce((sum, l) => sum + l.expected, 0),
    value: lines.reduce((sum, l) => sum + l.expected * (l.price ?? 0), 0),
  }
}

/**
 * Every outlet, in one report.
 *
 * Outlets with nothing at all still appear. An empty shop is a fact worth
 * seeing — it usually means a delivery has not been counted in — and leaving it
 * off the report would make it invisible precisely when it matters.
 */
export function stockReport({
  products = [],
  branches = [],
  transfers = [],
  production = null,
  sales = [],
  closings = [],
  businessDate,
  previousDate: yesterday,
}) {
  const outlets = branches.map((branch) =>
    stockAt({
      products,
      branch,
      transfers,
      production,
      sales,
      previousClosing: closings.find(
        (c) => c.branchId === branch.id && c.businessDate === yesterday,
      ),
    }),
  )

  return {
    businessDate,
    outlets,
    onShelf: outlets.reduce((sum, o) => sum + o.onShelf, 0),
    value: outlets.reduce((sum, o) => sum + o.value, 0),
  }
}

/**
 * The same figures the other way round: one row per product, one column per
 * outlet. This is the shape somebody actually reads when deciding where to move
 * stock — "who has bread left" is a question about a row, not about three
 * separate lists.
 */
export function byProduct(report) {
  const rows = new Map()

  for (const outlet of report.outlets ?? []) {
    for (const line of outlet.lines) {
      const row = rows.get(line.productId) ?? {
        productId: line.productId,
        code: line.code,
        productName: line.productName,
        price: line.price,
        keeps: line.keeps,
        perOutlet: {},
        carriedIn: 0,
        received: 0,
        sold: 0,
        left: 0,
      }

      // Per outlet, the whole story rather than only what is left — "Gulberg
      // has none" and "Gulberg has none because it sold forty" are different
      // facts, and only one of them is a problem.
      row.perOutlet[outlet.branchId] = {
        carriedIn: line.carriedIn,
        received: line.received,
        sold: line.sold,
        left: line.expected,
      }

      row.carriedIn += line.carriedIn
      row.received += line.received
      row.sold += line.sold
      row.left += line.expected
      rows.set(line.productId, row)
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      // Everything the outlets had to sell today: yesterday's leftovers plus
      // today's deliveries.
      available: row.carriedIn + row.received,
      // Sold more than was ever recorded as arriving.
      //
      // The shelf is clamped at zero, because there is no such thing as minus
      // three loaves — but that clamp then makes the totals look like they do
      // not add up, and a figure that does not add up is the fastest way to
      // lose somebody's trust in the whole screen. So the difference is named.
      //
      // Measured per outlet, not on the row: the clamp happens per outlet per
      // product, so one shop overselling while another sits on stock cancels
      // out at this level and the gap goes unreported. That is exactly the case
      // that produced a total nobody could reconcile.
      unaccounted: Object.values(row.perOutlet).reduce(
        (sum, at) => sum + Math.max(0, at.sold - (at.carriedIn + at.received)),
        0,
      ),
      // What is left is worth what it would sell for. Stock that does not keep
      // is worth that only until closing time, which is the point of showing it.
      worth: row.left * (row.price ?? 0),
      soldValue: row.sold * (row.price ?? 0),
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
}

/** Totals across every product, for the figures at the top of the report. */
export function stockTotals(rows = []) {
  return rows.reduce(
    (totals, row) => ({
      available: totals.available + row.available,
      sold: totals.sold + row.sold,
      left: totals.left + row.left,
      worth: totals.worth + row.worth,
      soldValue: totals.soldValue + row.soldValue,
      unaccounted: totals.unaccounted + (row.unaccounted ?? 0),
    }),
    { available: 0, sold: 0, left: 0, worth: 0, soldValue: 0, unaccounted: 0 },
  )
}
