// Raw materials — flour, butter, boxes — kept as a plain ledger rather than a
// recipe engine. Three things happen to a material: some arrives, somebody
// counts what is really there, or some goes bad. Everything the owner wants to
// know is worked out from those three.

export const RECEIVED = 'received'
export const COUNT = 'count'
export const SPOILAGE = 'spoilage'

export const MOVEMENTS = [
  { type: RECEIVED, label: 'Came in', hint: 'A delivery outside a purchase — a gift, or a swap.' },
  { type: COUNT, label: 'Counted', hint: 'What is actually on the shelf right now.' },
  { type: SPOILAGE, label: 'Went bad', hint: 'Thrown away before it could be used.' },
]

/**
 * How much stock a movement leaves behind.
 *
 * A count is the odd one out: the person counting types what is *there*, not a
 * difference, so it replaces the figure rather than adjusting it. Making the
 * human do that subtraction is exactly how stock records start lying.
 */
export function applyMovement(onHand = 0, { type, qty = 0 }) {
  if (type === COUNT) return Math.max(0, qty)
  if (type === SPOILAGE) return Math.max(0, onHand - qty)
  return onHand + qty
}

/**
 * Work out daily usage from two counts.
 *
 * Between one count and the next, whatever arrived and did not survive was
 * used: `(previous count + received since) − counted now`. No recipes needed —
 * the shelf tells the truth, which is the whole reason the design avoided
 * ingredient-level tracking.
 */
export function usageBetweenCounts({ previousCount, receivedSince = 0, spoiledSince = 0, countedNow, days }) {
  if (previousCount == null || !days || days <= 0) return null
  const used = previousCount + receivedSince - spoiledSince - countedNow
  if (used < 0) return null // more on the shelf than can be explained; not usable
  return { used, days, perDay: used / days }
}

/** Days of stock left at the current rate. Null when usage is not known yet. */
export function daysOfStock(material) {
  const perDay = material?.usagePerDay
  if (!perDay || perDay <= 0) return null
  return (material.onHand ?? 0) / perDay
}

/**
 * Low when it will run out before the next delivery can realistically arrive,
 * or when it has fallen under the level the owner set for it.
 */
export function isLow(material, leadDays = 2) {
  const level = material?.reorderLevel ?? 0
  if (level > 0 && (material?.onHand ?? 0) <= level) return true
  const days = daysOfStock(material)
  return days !== null && days <= leadDays
}

export function stockValue(materials = []) {
  return materials.reduce((sum, m) => sum + (m.onHand ?? 0) * (m.costPerUnit ?? 0), 0)
}

export function lowStock(materials = [], leadDays = 2) {
  return materials
    .filter((m) => m.active !== false && isLow(m, leadDays))
    .sort((a, b) => (daysOfStock(a) ?? 0) - (daysOfStock(b) ?? 0))
}

export function purchaseTotal(items = []) {
  return items.reduce((sum, i) => sum + Math.round((i.qty ?? 0) * (i.unitCost ?? 0)), 0)
}

/**
 * Gross margin for the business as a whole.
 *
 * Deliberately not per outlet: without recipes there is no honest way to say
 * what a shop's stock cost, and an invented figure is worse than none. Waste is
 * subtracted at what it would have sold for — money that was there and is not.
 */
export function grossMargin({ salesTotal = 0, materialCost = 0, wasteValue = 0 }) {
  const margin = salesTotal - materialCost - wasteValue
  return {
    salesTotal,
    materialCost,
    wasteValue,
    margin,
    marginPct: salesTotal > 0 ? Math.round((margin / salesTotal) * 100) : null,
  }
}
