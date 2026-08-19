import { summariseDay } from './report.js'

// One outlet's day, closed off into a single record.
//
// Written as a plain function of plain data so the scheduled job and the app
// produce byte-identical figures — a report the owner reads at night and a
// screen the cashier saw at closing time must never disagree.

/** Everything the outlet had to sell today, per product. */
function receivedFor({ branchId, mainId, transfersIn = [], production = null }) {
  const received = {}

  // A shop receives a delivery; the hub keeps back its own share of the bake.
  for (const transfer of transfersIn) {
    if (transfer.status !== 'received') continue
    for (const item of transfer.items ?? []) {
      const qty = item.qtyReceived ?? item.qtySent ?? 0
      received[item.productId] = (received[item.productId] ?? 0) + qty
    }
  }

  if (branchId === mainId && production) {
    const produced = production.produced ?? {}
    for (const item of production.items ?? []) {
      const share = item.perOutlet?.[branchId] ?? 0
      if (!share) continue
      // Never claim more than actually came out of the oven.
      const madeHere = Math.min(share, produced[item.productId] ?? 0)
      received[item.productId] = (received[item.productId] ?? 0) + madeHere
    }
  }

  return received
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
  production = null,
  carriedIn = {},
  products = [],
  mainId = 'MAIN',
}) {
  const summary = summariseDay(sales)
  const priceOf = new Map(products.map((p) => [p.id, p.price ?? 0]))
  const nameOf = new Map(products.map((p) => [p.id, p.name]))
  const codeOf = new Map(products.map((p) => [p.id, p.code ?? '']))

  const received = receivedFor({ branchId, mainId, transfersIn, production })
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
