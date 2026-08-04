// Pure money maths, kept out of the UI so it can be tested on its own.
// Rules that hold everywhere in the system:
//   - a voided sale is excluded from every total, but stays on the report
//   - a refund is a negative sale and reduces takings
//   - "sold" quantities are always net of voids

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
      const row = byProduct.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        qty: 0,
        revenue: 0,
      }
      row.qty += item.qty
      row.revenue += item.price * item.qty
      byProduct.set(item.productId, row)
    }
  }

  return {
    salesTotal,
    cashTotal,
    cardTotal,
    refundTotal,
    txCount,
    refundCount,
    voidedCount: sales.length - counted.length,
    byProduct: [...byProduct.values()].sort((a, b) => b.qty - a.qty),
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
