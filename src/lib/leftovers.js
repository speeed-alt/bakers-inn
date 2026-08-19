// What should still be on the shelf at closing time, and what to do with it.
//
// The whole point is that nobody counts a whole shop. The system already knows
// what arrived and what sold, so it says what *should* be left and the cashier
// only corrects the lines where reality disagrees.

export const WASTE = 'waste'
export const CARRY = 'carry'
export const RETURN = 'return'

/**
 * A product that does not keep is thrown out; one that keeps stays on the shelf.
 * That single flag on the product is what decides the default, so bread is not
 * carried over into tomorrow and biscuits are not binned every night.
 */
export function defaultDisposition(product) {
  return product?.sellsNextDay ? CARRY : WASTE
}

/**
 * Build the closing count.
 *
 * `received` is what came in today — a delivery at a shop, or its own share of
 * the bake at the hub. `carriedIn` is what yesterday left on the shelf.
 * Anything the outlet handled today appears, even when the expected figure is
 * zero, because "we have three left and the system thinks none" is exactly the
 * discrepancy worth catching.
 */
export function buildLeftovers({
  products = [],
  received = {},
  sold = {},
  carriedIn = {},
  // Stock this outlet has already sent back to the hub today. Empty during the
  // close itself, which is what creates the return; supplied by the live stock
  // screens, where crates on a van are no longer on the shelf.
  returned = {},
}) {
  const touched = new Set([
    ...Object.keys(received),
    ...Object.keys(sold),
    ...Object.keys(carriedIn),
    ...Object.keys(returned),
  ])

  return products
    .filter((p) => touched.has(p.id))
    .map((product) => {
      const inQty = (received[product.id] ?? 0) + (carriedIn[product.id] ?? 0)
      const soldQty = sold[product.id] ?? 0
      const backQty = returned[product.id] ?? 0
      return {
        productId: product.id,
        code: product.code ?? '',
        productName: product.name,
        price: product.price ?? 0,
        keeps: Boolean(product.sellsNextDay),
        ...(product.soldByWeight ? { soldByWeight: true, unit: product.unit ?? 'kg' } : {}),
        received: received[product.id] ?? 0,
        carriedIn: carriedIn[product.id] ?? 0,
        sold: soldQty,
        returned: backQty,
        // Never negative: selling more than the system thinks arrived means the
        // paperwork is wrong, not that there is minus-two bread on the shelf.
        expected: Math.max(0, inQty - soldQty - backQty),
        disposition: defaultDisposition(product),
      }
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
}

/** Split the counted lines into what is binned, carried, and sent back. */
export function splitLeftovers(lines = [], counts = {}, dispositions = {}, reasons = {}) {
  const waste = []
  const carry = []
  const returns = []

  for (const line of lines) {
    const qty = counts[line.productId] ?? line.expected
    if (qty <= 0) continue
    const how = dispositions[line.productId] ?? line.disposition
    const entry = {
      productId: line.productId,
      code: line.code,
      productName: line.productName,
      qty,
    }
    if (how === WASTE) waste.push({ ...entry, reason: reasons[line.productId] ?? 'Unsold' })
    else if (how === RETURN) returns.push(entry)
    else carry.push(entry)
  }

  return { waste, carry, returns }
}

/** What binned stock cost, valued at what it would have sold for. */
export function wasteValue(waste = [], priceOf = () => 0) {
  return waste.reduce((sum, w) => sum + priceOf(w.productId) * w.qty, 0)
}

/**
 * How much of what the outlet had actually sold. The number that tells the
 * owner whether he is baking too much — 100% means he probably sold out early
 * and could have sold more.
 */
export function sellThrough(lines = [], counts = {}) {
  let available = 0
  let sold = 0
  for (const line of lines) {
    available += line.received + line.carriedIn
    sold += line.sold
  }
  if (available <= 0) return null
  return Math.round((sold / available) * 100)
}
