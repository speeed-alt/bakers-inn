import { isCustomItem } from './custom.js'

// Pure money maths, kept out of the UI so it can be tested on its own.
// Rules that hold everywhere in the system:
//   - a voided sale is excluded from every total, but stays on the report
//   - a refund is a negative sale and reduces takings
//   - "sold" quantities are always net of voids
//   - a one-off counts as money and never as stock — see lib/custom.js

export function isCounted(sale) {
  return sale.status !== 'voided'
}

export function summariseDay(sales) {
  const counted = sales.filter(isCounted)

  let salesTotal = 0
  let cashTotal = 0
  let cardTotal = 0
  let refundTotal = 0
  let txCount = 0
  let refundCount = 0
  const byProduct = new Map()
  const custom = new Map()

  for (const sale of counted) {
    salesTotal += sale.total
    if (sale.payment === 'cash') cashTotal += sale.total
    else cardTotal += sale.total

    if (sale.status === 'refund') {
      refundTotal += sale.total
      refundCount += 1
    } else {
      txCount += 1
    }

    for (const item of sale.items ?? []) {
      // One-offs are kept in their own list, never in byProduct.
      //
      // Their money is already counted — it went into salesTotal above, which
      // is what the drawer is checked against. What must not happen is a
      // one-off reaching anything that reasons about stock: `buildDailyReport`
      // builds its rows from these keys, and `suggest.soldOut` reads "sold
      // some, none left, none binned" as a product that ran out. A bottle of
      // Coke matches that every single time, because there is no shelf for it
      // to be left on — so without this split, selling one would put Coke on
      // tomorrow's baking list, with 10% added for having sold out.
      const into = isCustomItem(item) ? custom : byProduct
      const row = into.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        qty: 0,
        revenue: 0,
      }
      row.qty += item.qty
      row.revenue += item.price * item.qty
      into.set(item.productId, row)
    }
  }

  const bySold = (a, b) => b.qty - a.qty

  return {
    salesTotal,
    cashTotal,
    cardTotal,
    refundTotal,
    txCount,
    refundCount,
    voidedCount: sales.length - counted.length,
    byProduct: [...byProduct.values()].sort(bySold),
    // What was sold that the bakery does not make. The owner's cue to add a
    // product properly: a thing rung forty times a month is not a one-off.
    customItems: [...custom.values()].sort(bySold),
    customTotal: [...custom.values()].reduce((sum, r) => sum + r.revenue, 0),
  }
}

/**
 * What should be in the drawer at close: the float it opened with plus every
 * cash movement since. Counted before tomorrow's float is put back in.
 */
export function expectedCash(summary, openingFloat) {
  return openingFloat + summary.cashTotal
}

export function overShort(countedCash, summary, openingFloat) {
  return countedCash - expectedCash(summary, openingFloat)
}
