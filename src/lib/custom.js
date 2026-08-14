// One-off lines: things the shop sells that are not on the baking list.
//
// A bottle of Coke, a packet of crisps, a birthday candle. The bakery does not
// make them, does not order them on the daily list, and does not count them on
// the shelf at closing — but a customer still hands over money for one, and
// that money has to be in the drawer figure or the cash-up is wrong every time
// it happens.
//
// The rule that keeps this from poisoning everything else:
//
//   **A one-off is money, not stock.**
//
// It counts in the takings, the cash and card split, the receipt, the day's
// total and the P&L. It is deliberately absent from anything that tracks a
// quantity on a shelf — the baking list, the stock report, the leftover count,
// and the order suggestion.
//
// That last one is not a nicety. `buildDailyReport` builds its rows from
// whatever was sold, and `suggest.soldOut(row)` is "sold something, none left,
// none binned" — which is true of every one-off ever rung, because there is no
// shelf for them to be left on. Without the split, selling one Coke would put
// Coke on tomorrow's baking list with a 10% uplift for having sold out, and
// the kitchen would be standing there at 5am wondering how to bake it.

/** Marks the synthetic ids, so nothing mistakes one for a catalogue product. */
const PREFIX = 'custom:'

/**
 * A stable id for a one-off, derived from what it was called.
 *
 * Stable so that "Coke" rung on Monday and "coke" rung on Friday land on the
 * same row when the owner looks at what is being sold off-catalogue — that list
 * is the whole point, because a thing sold forty times a month should stop
 * being a one-off and become a product.
 *
 * Not null, and not a random id per sale: a null id would collapse Coke and
 * crisps into one nameless row, and a random one would scatter forty Cokes
 * across forty rows. Both hide exactly what the owner needs to see.
 */
export function customProductId(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${PREFIX}${slug || 'item'}`
}

/** True for a sale line or sale item that was typed in rather than picked. */
export function isCustomItem(item) {
  return item?.custom === true || String(item?.productId ?? '').startsWith(PREFIX)
}

/** Splits sold items into the catalogue ones and the one-offs. */
export function partitionCustom(items = []) {
  const catalogue = []
  const custom = []
  for (const item of items) (isCustomItem(item) ? custom : catalogue).push(item)
  return { catalogue, custom }
}

/**
 * Is this a name and price the till should accept?
 *
 * A price of zero is allowed on purpose — a replacement handed over for nothing
 * still belongs on the slip, and refusing it just means the cashier writes it on
 * a scrap of paper instead. What is refused is a blank name, because an
 * unnamed line on a receipt is an argument at the counter, and a price that is
 * not a whole number of rupees.
 */
export function validCustom({ name, price }) {
  if (!String(name ?? '').trim()) return false
  if (price === null || price === undefined) return false
  return Number.isInteger(price) && price >= 0
}

/**
 * A bill line for something typed in at the counter.
 *
 * `custom: true` rides on the line and is copied onto the sale item, so every
 * screen downstream can tell without having to parse the id.
 */
export function customLine({ name, price, qty = 1 }) {
  const clean = String(name).trim()
  return {
    productId: customProductId(clean),
    custom: true,
    code: '',
    name: clean,
    price,
    qty,
  }
}

// --- remembering what a one-off cost last time -----------------------------
//
// A shop that sells Coke sells it every day. Typing the price each time is
// both a nuisance and the most likely way to ring it at the wrong price, so
// the last price used on this tablet is offered back. It is a suggestion in a
// filled-in box, never a silent default: the cashier still sees the figure and
// can change it before it goes on the bill.

const PRICE_KEY = 'bakery.customPrices'

function readPrices() {
  try {
    const raw = localStorage.getItem(PRICE_KEY)
    const value = raw ? JSON.parse(raw) : null
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** What this tablet charged for that one-off last time, or null. */
export function lastCustomPrice(name) {
  const price = readPrices()[customProductId(name)]
  return Number.isInteger(price) ? price : null
}

export function rememberCustomPrice(name, price) {
  if (!Number.isInteger(price)) return
  try {
    const prices = readPrices()
    prices[customProductId(name)] = price
    localStorage.setItem(PRICE_KEY, JSON.stringify(prices))
  } catch {
    // Remembering is a convenience. Losing it must never stop a sale.
  }
}

/** Names this tablet has rung before, most useful first, for a quick-pick row. */
export function knownCustomNames(sales = [], limit = 6) {
  const seen = new Map()
  for (const sale of sales) {
    if (sale.status === 'voided') continue
    for (const item of sale.items ?? []) {
      if (!isCustomItem(item)) continue
      const key = item.name
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name)
}
