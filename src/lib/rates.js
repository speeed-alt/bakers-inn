// Some things do not have a price, they have a rate.
//
// Eggs, and bread when flour moves, are bought at whatever this morning cost
// and sold at whatever this morning justifies. The rest of the catalogue — a
// cake, a sandwich — has a price that stands until somebody decides otherwise.
// Treating both the same means either the owner re-types forty prices to change
// two, or the till quietly charges yesterday's rate for eggs all day.
//
// So a product carries a `dailyRate` flag. Flagged items are priced once each
// morning, in one place, for all three outlets. Everything else is unchanged.
//
// Two things make this safe:
//
//   1. A sale copies the price it charged into its own line. Whatever happens
//      to a rate afterwards, a receipt and a report still say what was taken.
//   2. `product.price` is kept as the *last* rate set. It is the fallback when
//      this morning's rate has not been entered yet, so a till with no rate for
//      today charges yesterday's rather than refusing to sell — and the shop
//      keeps trading while somebody is told about it.

/** The price map out of a day's rate document. */
export function ratesOf(rateDoc) {
  return rateDoc?.prices ?? {}
}

/**
 * What this product costs right now.
 *
 * Not `prices[id] ?? product.price` — a rate of 0 is a real answer (a giveaway,
 * a promotion) and `??` would keep it, but a *missing* rate must fall through.
 * Checking the number is finite separates the two.
 */
export function priceOf(product, prices = {}) {
  if (!product) return 0
  if (product.dailyRate) {
    const today = prices[product.id]
    if (Number.isFinite(today)) return today
  }
  return product.price ?? 0
}

/** The items that are priced fresh each morning. */
export function dailyRateProducts(products = []) {
  return products
    .filter((p) => p.dailyRate && p.active !== false)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/**
 * Which of them nobody has priced today.
 *
 * This is what the owner's dashboard warns about and what the till's banner
 * counts. Empty means the morning job is done.
 */
export function ratesNotSet(products = [], prices = {}) {
  return dailyRateProducts(products).filter((p) => !Number.isFinite(prices[p.id]))
}

/**
 * What changed between yesterday's rates and today's, for the record.
 *
 * Only items whose rate actually moved. A list that repeats every unchanged
 * item is a list nobody reads.
 */
export function rateChanges(products = [], before = {}, after = {}) {
  const changes = []
  for (const product of dailyRateProducts(products)) {
    const was = before[product.id]
    const now = after[product.id]
    if (!Number.isFinite(now)) continue
    if (Number.isFinite(was) && was === now) continue
    changes.push({
      productId: product.id,
      name: product.name,
      was: Number.isFinite(was) ? was : null,
      now,
    })
  }
  return changes
}
