// Some things are counted and some things are weighed.
//
// A loaf is a loaf. Biscuits are however much the customer asks for — "give me
// four and a half kilos" — and the price on the shelf is per kilo. The till has
// to take both without the cashier thinking about which is which.
//
// A weighed product carries `soldByWeight` and a `unit` (kg by default). Its
// `price` is the price of one whole unit, and the quantity on the line is a
// decimal of that unit. Everything downstream — the bill, the receipt, the
// daily report — already multiplies price by quantity, so it keeps working;
// the only thing that had to change is that the result is now rounded, because
// a fractional weight makes a fractional rupee and rupees are integers here.

export const DEFAULT_WEIGHT_UNIT = 'kg'

/** Grams per one of these, for units the till knows how to convert. */
const SUB_UNITS = { kg: { g: 1000, gram: 1000, grams: 1000, kg: 1, kilo: 1, kilos: 1 } }

export function isWeighed(product) {
  return Boolean(product?.soldByWeight)
}

export function unitOf(product) {
  if (!isWeighed(product)) return null
  return product.unit || DEFAULT_WEIGHT_UNIT
}

/**
 * What one tap of + or − should be worth.
 *
 * A quarter of a kilo, not a whole one: the arrows are for nudging an already
 * weighed amount, and a customer who asked for 4.5 does not want 5.
 */
export function stepFor(product) {
  return isWeighed(product) ? 0.25 : 1
}

/**
 * Read a typed quantity.
 *
 * Accepts what somebody would actually type at a counter: `4.5`, `4.5kg`,
 * `450g`, `1 kilo`. Grams are converted, because a cashier told "three hundred
 * grams" should be able to type 300g rather than work out 0.3 in their head
 * while a queue waits — that arithmetic is exactly where mistakes come from.
 *
 * Returns null when it cannot be read at all, so the caller can leave the
 * previous value alone rather than silently zeroing a line.
 */
export function parseQuantity(text, product) {
  if (text === null || text === undefined) return null
  const raw = String(text).trim().toLowerCase()
  if (raw === '') return null

  const match = raw.match(/^([0-9]*\.?[0-9]+)\s*([a-z]*)$/)
  if (!match) return null

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return null

  if (!isWeighed(product)) return Math.round(value)

  const suffix = match[2]
  const unit = unitOf(product)
  const table = SUB_UNITS[unit]
  if (!suffix || !table) return value
  const divisor = table[suffix]
  // An unrecognised suffix is a typo, not a unit. Better to refuse than to
  // guess and charge for the wrong amount.
  if (!divisor) return null
  return value / divisor
}

/**
 * Show a quantity the way it was asked for.
 *
 * Trailing zeros are dropped — "4.5 kg", not "4.500 kg" — and a counted item
 * stays a bare number, because "3 each" is not how anybody says it.
 */
export function formatQuantity(qty, product) {
  const n = Number(qty ?? 0)
  if (!isWeighed(product)) return String(Math.round(n))
  // Three decimals is one gram. Nothing in a bakery is weighed finer.
  const trimmed = Number(n.toFixed(3))
  return `${trimmed} ${unitOf(product)}`
}

/** Quantities are stored to the gram, so two tills cannot disagree by a rounding. */
export function roundQuantity(qty, product) {
  const n = Number(qty ?? 0)
  if (!isWeighed(product)) return Math.round(n)
  return Number(n.toFixed(3))
}

/**
 * The most one line may carry.
 *
 * The stepper's own default is 9,999, which for a counted item is silly and for
 * a weighed one is nine and a half tonnes of biscuits — a single stuck `+` or a
 * mistyped digit put Rs 13,998,600 on a bill, and from there into the day's
 * takings, the daily report and the P&L. Nothing anywhere said a word.
 *
 * Generous rather than tight, because the till must never be the reason a real
 * order cannot be rung: five hundred loaves for a wedding is a real morning,
 * and so is fifty kilos of biscuits for a shop. What it stops is the order of
 * magnitude that is never real.
 */
export function maxFor(product) {
  return isWeighed(product) ? MAX_WEIGHED_UNITS : MAX_COUNTED_UNITS
}

export const MAX_COUNTED_UNITS = 999
export const MAX_WEIGHED_UNITS = 100

/**
 * The props a Stepper needs to count one of these properly.
 *
 * Spread rather than passed one by one, because the interesting fact is that
 * they always travel together: a screen that knows the step but not the parser
 * accepts "450g" and stores 450. Only the till had them; the baking list, the
 * delivery note, the receipt count, the closing count and the outlet's order
 * were all plain integer steppers, so the one product this bakery sells by
 * weight could be ordered, baked, sent, received and counted only in whole
 * kilos — while the till sold it in quarters. Weighed stock could never
 * reconcile, and nothing said why.
 *
 * A missing product means "not known yet", which behaves as counted.
 */
export function weighedProps(product) {
  if (!product) return {}
  return {
    step: stepFor(product),
    max: maxFor(product),
    parse: (raw) => parseQuantity(raw, product),
    // The bare number: these steppers sit in tables with their own unit column.
    format: (n) => String(Number(Number(n ?? 0).toFixed(3))),
  }
}
