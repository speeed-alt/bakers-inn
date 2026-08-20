// Some things are counted and some things are weighed.
//
// A loaf is a loaf. Biscuits are however much the customer asks for, and the
// price on the shelf is a weight price. The till has to take both without the
// cashier thinking about which is which.
//
// **A weighed product is sold in portions, and a portion is 250 grams.** The
// quantity on the line is a whole number of those: 1 is a quarter kilo, 4 is a
// kilo, 6 is a kilo and a half. The price stored against the product is the
// price of one portion, so the line total is the same multiplication as a loaf
// and there is no rounding anywhere — four portions at 350 is exactly the 1,400
// the shelf says a kilo costs.
//
// It used to be fractional kilos: price per kilo, quantity 0.25 at a time. That
// read well and behaved badly. Every other screen in the system — the order, the
// baking list, the delivery note, the receipt count, the closing count — used a
// plain whole-number counter, so the one product this bakery sells by weight
// could be ordered, baked, sent, received and counted only in whole kilos while
// the till sold it in quarters, and the stock could never reconcile. Counting
// portions makes every quantity in the system a whole number again, which is
// what the rest of it was always built for.

/** Grams in one portion. The number the whole scheme rests on. */
export const PORTION_GRAMS = 250

/** What one of them is called, on a shelf label and in the catalogue. */
export const DEFAULT_WEIGHT_UNIT = '250 g'

const GRAMS_IN = { g: 1, gram: 1, grams: 1, kg: 1000, kilo: 1000, kilos: 1000, k: 1000 }

export function isWeighed(product) {
  return Boolean(product?.soldByWeight)
}

export function unitOf(product) {
  if (!isWeighed(product)) return null
  return product.unit || DEFAULT_WEIGHT_UNIT
}

/** Grams in one portion of this product. */
export function portionOf(product) {
  return Number(product?.portionGrams) > 0 ? Number(product.portionGrams) : PORTION_GRAMS
}

/**
 * What one tap of + or − is worth: one portion, for everything.
 *
 * Weighed or counted, the quantity is now a whole number of things, so there is
 * one answer and no product-dependent step to get wrong.
 */
export function stepFor() {
  return 1
}

/**
 * The most one line may carry.
 *
 * The stepper's own default is 9,999, which one stuck `+` turned into Rs
 * 13,998,600 on a bill. Generous enough for a wedding order — five hundred
 * loaves, or sixty kilos of biscuits — and short of the order of magnitude that
 * is never real.
 */
export function maxFor() {
  return MAX_LINE_UNITS
}

export const MAX_LINE_UNITS = 999

/**
 * Read a typed quantity.
 *
 * A bare number is a count: `4` is four portions, which is a kilo. A number with
 * a weight on it is converted, because a cashier told "give me a kilo" should be
 * able to type `1kg` rather than work out that it is four while a queue waits —
 * that arithmetic is exactly where mistakes come from.
 *
 * A weight that is not a whole number of portions goes to the nearest one, and
 * the screen then shows what it became. Selling in portions means selling in
 * portions; pretending otherwise would put a quantity on the bill that the scales
 * cannot produce.
 *
 * Returns null when it cannot be read at all, so the caller leaves the previous
 * value alone rather than silently zeroing a line.
 */
export function parseQuantity(text, product) {
  if (text === null || text === undefined) return null
  const raw = String(text).trim().toLowerCase()
  if (raw === '') return null

  const match = raw.match(/^([0-9]*\.?[0-9]+)\s*([a-z]*)$/)
  if (!match) return null

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return null

  const suffix = match[2]
  if (!suffix) return Math.round(value)

  // A suffix on a counted product is a typo, not a unit.
  if (!isWeighed(product)) return null

  const grams = GRAMS_IN[suffix]
  if (!grams) return null
  return Math.max(0, Math.round((value * grams) / portionOf(product)))
}

/**
 * Show a quantity the way it was asked for.
 *
 * A whole number either way — the weight it comes to is said separately, by
 * `weightOf`, where there is room for it.
 */
export function formatQuantity(qty) {
  return String(Math.round(Number(qty) || 0))
}

/** What that many portions actually weigh, for a label or a slip. */
export function weightOf(qty, product) {
  if (!isWeighed(product)) return null
  const grams = (Math.round(Number(qty) || 0)) * portionOf(product)
  if (grams === 0) return `0 ${DEFAULT_WEIGHT_UNIT}`
  if (grams % 1000 === 0) return `${grams / 1000} kg`
  if (grams > 1000) return `${Number((grams / 1000).toFixed(3))} kg`
  return `${grams} g`
}

/** Quantities are whole portions, so two tills cannot disagree by a rounding. */
export function roundQuantity(qty) {
  return Math.round(Number(qty) || 0)
}

/**
 * The props a Stepper needs to count one of these properly.
 *
 * Spread rather than passed one by one, because the interesting fact is that
 * they always travel together: a screen with the step but not the parser accepts
 * "1kg" and stores 1. Only the till had them, which is how the rest of the
 * system came to be counting the wrong thing.
 *
 * A missing product means "not known yet", which behaves as counted.
 */
export function weighedProps(product) {
  if (!product) return {}
  return {
    step: stepFor(product),
    max: maxFor(product),
    parse: (raw) => parseQuantity(raw, product),
    format: formatQuantity,
  }
}
