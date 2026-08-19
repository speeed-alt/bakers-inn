import { summariseDay } from './report.js'
import { receivedAt } from './stock.js'

// One outlet's day, closed off into a single record.
//
// Written as a plain function of plain data so the scheduled job and the app
// produce byte-identical figures — a report the owner reads at night and a
// screen the cashier saw at closing time must never disagree.

/**
 * Everything the outlet had to sell today, per product.
 *
 * Through `receivedAt` — the same function the close wizard and the owner's
 * stock screen use. It had its own copy, and the copy had been left behind:
 * it still worked the hub's share out as "the part of the order MAIN placed
 * for itself that actually got baked", which the rest of the system abandoned
 * because it is wrong the moment a short bake is sent out in full. The cashier
 * was shown one figure at closing time and this wrote a different one into the
 * permanent record the owner reads afterwards — the exact disagreement this
 * codebase keeps saying it will not have.
 *
 * Needs the hub's outbound notes as well as its inbound ones, because what the
 * hub kept is what it made less what it put on a note.
 */
function receivedFor({
  branchId,
  mainId,
  transfersIn = [],
  transfersOut = [],
  production = null,
  businessDate = null,
}) {
  return receivedAt({
    branchId,
    isMain: branchId === mainId,
    transfers: [...transfersIn, ...transfersOut],
    production,
    businessDate,
  })
}

const toQtyMap = (rows = []) =>
  rows.reduce((map, r) => ({ ...map, [r.productId]: (map[r.productId] ?? 0) + r.qty }), {})

export function buildDailyReport({
  branchId,
  businessDate,
  ref,
  sales = [],
  closing = null,
  transfersIn = [],
  // The hub's outgoing notes. Only the hub has any, and without them what it
  // kept back cannot be worked out.
  transfersOut = [],
  production = null,
  carriedIn = {},
  products = [],
  mainId = 'MAIN',
}) {
  const summary = summariseDay(sales)
  const priceOf = new Map(products.map((p) => [p.id, p.price ?? 0]))
  const nameOf = new Map(products.map((p) => [p.id, p.name]))
  const codeOf = new Map(products.map((p) => [p.id, p.code ?? '']))

  const received = receivedFor({ branchId, mainId, transfersIn, transfersOut, production, businessDate })
  const wasted = toQtyMap(closing?.wasteItems)
  const returned = toQtyMap(closing?.returns)
  const carried = toQtyMap(closing?.carry)
  const soldByProduct = new Map(summary.byProduct.map((p) => [p.productId, p]))

  const ids = new Set([
    ...Object.keys(received),
    ...Object.keys(carriedIn),
    ...soldByProduct.keys(),
    ...Object.keys(wasted),
    ...Object.keys(returned),
    ...Object.keys(carried),
  ])

  let wasteQty = 0
  let wasteAmount = 0
  let available = 0
  let soldQty = 0

  const byProduct = [...ids]
    .map((productId) => {
      const sold = soldByProduct.get(productId)
      const row = {
        productId,
        code: codeOf.get(productId) ?? '',
        productName: sold?.name ?? nameOf.get(productId) ?? productId,
        carriedIn: carriedIn[productId] ?? 0,
        received: received[productId] ?? 0,
        sold: sold?.qty ?? 0,
        wasted: wasted[productId] ?? 0,
        returned: returned[productId] ?? 0,
        leftover: carried[productId] ?? 0,
        revenue: sold?.revenue ?? 0,
        // Carried on the row so the owner's dashboard can rank what is costing
        // most without needing the price list to hand.
        wastedValue: (wasted[productId] ?? 0) * (priceOf.get(productId) ?? 0),
      }

      wasteQty += row.wasted
      // Waste is valued at what it would have sold for — the money that walked
      // out with the bin, which is the figure that changes behaviour.
      wasteAmount += row.wasted * (priceOf.get(productId) ?? 0)
      available += row.received + row.carriedIn
      soldQty += row.sold

      // carried in + received − sold − wasted − returned should be what is left
      row.unexplained = row.carriedIn + row.received - row.sold - row.wasted - row.returned - row.leftover
      return row
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))

  const variance = transfersIn.reduce(
    (acc, t) => {
      for (const item of t.items ?? []) {
        if (item.qtyReceived == null) continue
        const missing = (item.qtySent ?? 0) - item.qtyReceived
        if (missing <= 0) continue
        acc.qty += missing
        acc.value += missing * (priceOf.get(item.productId) ?? 0)
      }
      return acc
    },
    { qty: 0, value: 0 },
  )

  return {
    ref,
    branchId,
    businessDate,

    salesTotal: summary.salesTotal,
    cashTotal: summary.cashTotal,
    cardTotal: summary.cardTotal,
    digitalTotal: summary.digitalTotal,
    byMethod: summary.byMethod.map((m) => ({ id: m.id, label: m.label, total: m.total, count: m.count })),
    refundTotal: summary.refundTotal,
    txCount: summary.txCount,
    voidedCount: summary.voidedCount,

    openingFloat: closing?.openingFloat ?? 0,
    countedCash: closing?.countedCash ?? 0,
    overShort: closing?.overShort ?? 0,
    closedByName: closing?.closedByName ?? null,
    closingStatus: closing?.status ?? 'open',

    byProduct,
    wasteQty,
    wasteValue: wasteAmount,
    // Share of what was available that ended up in the bin.
    wastePct: available > 0 ? Math.round((wasteQty / available) * 100) : 0,
    sellThroughPct: available > 0 ? Math.round((soldQty / available) * 100) : null,
    transferVarianceQty: variance.qty,
    transferVarianceValue: variance.value,

    // True when every product's movements add up. False is not an error — it
    // means a count somewhere disagrees, which is precisely worth surfacing.
    reconciles: byProduct.every((row) => row.unexplained === 0),
  }
}

/** What tomorrow should start with: what was left on the shelf tonight. */
export function carryoverFrom(closing) {
  return toQtyMap(closing?.carry)
}
