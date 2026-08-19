import { extrasList, hubStock } from './compile.js'
import { committedOut } from './dispatch.js'
import { summariseDay } from './report.js'

// The owner's own daily sheet, worked out by itself.
//
// He keeps one ruled line a day, in rupees, and it is the only record he reads
// end to end:
//
//   Date | Production | Distribution (×3) | Sale position (×3) | Total sale | Total stale
//
// Everything here already exists somewhere in the system, product by product and
// sale by sale. What did not exist was this row — the one shape he actually
// thinks in. A system that holds more detail than the paper it replaces, and
// cannot reproduce the paper, has not replaced it.
//
// Values, not counts. He does not write "180 loaves"; he writes 1,80,000. So
// every figure here is money, and quantities ride along only for the screens
// that want to explain a number.

/** Selling price by product id. Missing prices count as zero, never as NaN. */
function pricesOf(products = []) {
  const prices = {}
  for (const p of products) prices[p.id] = Number(p.price) || 0
  return prices
}

/**
 * What came out of the oven today, at what it sells for.
 *
 * Counted from what the kitchen actually recorded, not from what the list asked
 * for — those are different numbers on any day with a short bake, and the sheet
 * says "production", not "plan". Extras count: a tray nobody ordered was still
 * baked, and it still gets sent out and sold.
 *
 * `planned` comes back alongside so a screen can say "nothing recorded yet"
 * rather than "you baked nothing", which are very different mornings.
 */
export function productionValue(production, prices = {}) {
  const items = production?.items ?? []
  const produced = production?.produced ?? {}

  let value = 0
  let qty = 0
  let planned = 0
  let linesRecorded = 0

  for (const item of items) {
    const price = prices[item.productId] ?? 0
    planned += (item.qtyNeeded ?? 0) * price
    const made = produced[item.productId]
    if (made === undefined) continue
    linesRecorded += 1
    qty += made
    value += made * price
  }

  for (const extra of extrasList(production)) {
    const price = prices[extra.productId] ?? 0
    qty += extra.qty ?? 0
    value += (extra.qty ?? 0) * price
  }

  return { value, qty, planned, linesRecorded, lines: items.length }
}

/**
 * What left the hub for one outlet, at selling price.
 *
 * The hub does not send itself anything — its own share sits on the production
 * order rather than on a delivery note — so it is worked out from a different
 * place and then read the same way. On his sheet Susan Road's 1,00,000 is
 * exactly that: the half of the bake that never went in a van.
 *
 * Counted as *sent*, not as confirmed received. Distribution is the hub's
 * action and it is what he writes down in the morning; a note still being
 * counted at the far end has not stopped being a delivery. Returns going the
 * other way are not distribution and are excluded.
 */
export function distributedTo({ branch, production, transfers = [], prices = {} }) {
  if (branch?.isMain) {
    const share = hubStock(production, committedOut(branch.id, transfers, production?.businessDate))
    let value = 0
    let qty = 0
    for (const [productId, n] of Object.entries(share)) {
      qty += n
      value += n * (prices[productId] ?? 0)
    }
    return { qty, value }
  }

  let value = 0
  let qty = 0
  for (const transfer of transfers) {
    if (transfer.toBranchId !== branch?.id) continue
    if (transfer.direction === 'return') continue
    if (transfer.status !== 'dispatched' && transfer.status !== 'received') continue
    for (const item of transfer.items ?? []) {
      const n = item.qtySent ?? item.qtyDemanded ?? 0
      qty += n
      value += n * (prices[item.productId] ?? 0)
    }
  }
  return { qty, value }
}

/**
 * The whole sheet for one day.
 *
 * Stale comes only from closings, because it is only ever counted at closing —
 * so before any outlet has shut it is genuinely not known, and comes back null
 * rather than zero. Zero stale is a claim about the day; not knowing is not.
 */
export function dailySheet({
  products = [],
  branches = [],
  production = null,
  transfers = [],
  sales = [],
  closings = [],
  businessDate,
}) {
  const prices = pricesOf(products)
  const baked = productionValue(production, prices)

  const outlets = branches.map((branch) => {
    const distributed = distributedTo({ branch, production, transfers, prices })
    const mine = sales.filter((s) => s.branchId === branch.id)
    const day = summariseDay(mine)
    const closing = closings.find(
      (c) => c.branchId === branch.id && c.businessDate === businessDate,
    )

    return {
      branchId: branch.id,
      branchName: branch.name ?? branch.id,
      isMain: Boolean(branch.isMain),
      distributedQty: distributed.qty,
      distributed: distributed.value,
      sold: day.salesTotal,
      // Money taken for things the bakery never sent out — a bottle of Coke
      // out of the fridge. Part of the sale position, because it is part of
      // what the shop took, but it cannot be set against what was distributed:
      // nothing was distributed for it. Kept apart so `unsold` stays honest.
      soldOffList: day.customTotal,
      // A day that has been reopened is not shut, so its waste is not final.
      stale: closing && closing.status !== 'reopened' ? (closing.wasteValue ?? 0) : null,
      closed: Boolean(closing) && closing.status !== 'reopened',
    }
  })

  const distributed = outlets.reduce((sum, o) => sum + o.distributed, 0)
  const totalSale = outlets.reduce((sum, o) => sum + o.sold, 0)
  const soldOffList = outlets.reduce((sum, o) => sum + o.soldOffList, 0)
  const counted = outlets.filter((o) => o.closed)
  const totalStale = counted.length === 0 ? null : counted.reduce((sum, o) => sum + o.stale, 0)

  return {
    businessDate,
    production: baked,
    outlets,
    distributed,
    totalSale,
    soldOffList,
    totalStale,
    outletsClosed: counted.length,
    // The line his sheet has no column for.
    //
    // Sent out 2,00,000, sold 1,80,000, stale 5,000 — and 15,000 is simply not
    // on the paper. It is not missing money: it is bread still on a shelf, or
    // back at the hub. The system knows which, product by product, and the
    // whole reason to keep this figure is that a total which does not add up is
    // the fastest way to lose somebody's trust in a screen.
    //
    // Measured against what was sold *off the baking list only*. A bottle of
    // Coke was never distributed, so counting its takings here would report
    // that much less bread left on the shelf than there really is — and on a
    // quiet morning with a full fridge it would go negative, which is not a
    // quantity of anything.
    unsold: distributed - (totalSale - soldOffList),
  }
}
