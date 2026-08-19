import { PAYMENT_ACCOUNTS, PAYMENT_METHODS } from '../config.js'

// How the customer paid.
//
// One question decides everything downstream: **is this money in the drawer at
// closing time?** Cash is. A card takes days to settle, and a JazzCash or
// Easypaisa transfer lands in the shop's mobile account within seconds — but
// neither is in the till, so neither belongs in the figure the cashier is
// counted against.
//
// Before this file there were exactly two methods and the code said `if cash …
// else card`, which meant every new way of paying would have silently been
// labelled "card" on every screen and in every export. The drawer arithmetic
// would still have been right; the owner's figures would have been fiction.

const BY_ID = new Map(PAYMENT_METHODS.map((m) => [m.id, m]))

/**
 * The method, or a sensible stand-in for one this build has never heard of.
 *
 * Sales are kept for good, so a method retired from config.js still appears in
 * last year's records. Falling back to the stored id rather than to null keeps
 * an old receipt readable and keeps it out of the drawer total, which is the
 * safe side to be wrong on.
 */
export function methodOf(id) {
  return BY_ID.get(id) ?? { id: id ?? 'unknown', label: String(id ?? 'Unknown'), drawer: false }
}

export function labelOf(id) {
  return methodOf(id).label
}

/** Should this money be in the till tonight? */
export function inDrawer(id) {
  return methodOf(id).drawer === true
}

/** Does the till have to show the customer where to send the money? */
export function needsAccount(id) {
  return methodOf(id).account === true
}

/**
 * Where a customer sends money for this method, at this shop.
 *
 * The outlet's own details first, then the business-wide fallback. Per-outlet
 * is worth having — a transfer that lands in Gulberg's account is a transfer
 * you can attribute to Gulberg — but one account for the whole bakery is the
 * normal arrangement and this handles both.
 *
 * Empty means nobody has filled it in. The till says so rather than showing a
 * blank space beside an amount, because a customer staring at an empty screen
 * asks the cashier for a number and the cashier recites one from memory.
 */
export function accountFor(id, branch = null) {
  const own = branch?.payTo?.[id]
  return (own && String(own).trim()) || String(PAYMENT_ACCOUNTS[id] ?? '').trim()
}

export function isKnownMethod(id) {
  return BY_ID.has(id)
}

/**
 * Every method's takings for a set of sales, in the order config.js lists them.
 *
 * Methods nobody used today are dropped: a close screen listing five ways to
 * pay with four of them at zero is four lines of nothing to read past. A
 * method used in a way this build does not recognise is kept, because a figure
 * with a strange name against it is a question worth asking, and a figure
 * silently omitted is not.
 */
export function splitByMethod(sales = []) {
  const totals = new Map()

  for (const sale of sales) {
    if (sale.status === 'voided') continue
    const id = sale.payment ?? 'unknown'
    const row = totals.get(id) ?? { ...methodOf(id), total: 0, count: 0 }
    row.total += sale.total ?? 0
    row.count += 1
    totals.set(id, row)
  }

  const order = PAYMENT_METHODS.map((m) => m.id)
  return [...totals.values()].sort((a, b) => {
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}
