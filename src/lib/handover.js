// The hub's own bake, counted in at its own counter.
//
// Every other outlet is told the moment the kitchen sends its van, and counts
// the crates in against the delivery note. The hub never got a note — its share
// of the bake never goes in a van, it is simply what the kitchen made and did not
// send anywhere — so the hub's cashier was told nothing at all. Tomorrow's bread
// was finished and sitting in the back, and the only way to find out was to walk
// through and look. And because it was never counted in, a short tray at the hub
// was invisible until closing, where it landed as unexplained waste.
//
// So the hub gets the same two things the shops have: a notice when its bake is
// ready, and a count-in. What it does *not* get is a delivery note, and that is
// deliberate. The hub's share is already worked out by `hubStock` — made, less
// what went on the notes — and the Stock screen, the till, the close and the
// owner's report all read it that way. Inventing a note from the hub to itself
// would mean changing all four and re-proving the owner's handwritten sheets.
// Instead the count-in records what the cashier found, and any difference goes
// in as an ordinary shelf correction — short or extra from the kitchen, with her
// name on it — which all four screens already honour.

import { hubStock } from './compile.js'
import { committedOut } from './dispatch.js'
import { adjustmentEntry } from './adjustments.js'

export const SHORT_FROM_KITCHEN = 'Short from the kitchen'
export const EXTRA_FROM_KITCHEN = 'Extra from the kitchen'

/**
 * What the kitchen made for the hub's own counter from one baking list.
 *
 * Exactly the figure `receivedAt` gives the hub's shelf — the same `hubStock`
 * over the same `committedOut` — so the count-in asks the cashier to confirm the
 * very number the shelf is about to show. Two workings of it would eventually
 * disagree, and the cashier would be confirming a figure nothing else used.
 */
export function hubShare({ branchId, production, outbound = [] }) {
  if (!production) return {}
  return hubStock(production, committedOut(branchId, outbound, production.businessDate))
}

/**
 * Where one day's bake stands, from the hub counter's point of view.
 *
 *   none         no baking list for the day
 *   baking       the kitchen has not marked the list done
 *   dispatching  done, but a van for another outlet is still being loaded
 *   nothing      done and sent, and nothing from it was kept for this counter
 *   ready        waiting to be counted in
 *   counted      counted in
 *
 * `dispatching` is why the notice waits. While a note is still a draft the
 * kitchen can send extra of something, or less, and every tray moved on a note
 * changes what the hub keeps. Counting in before the vans have gone would be
 * counting stock that might still leave.
 */
export function bakeStatus({ production, outbound = [], handover = null, share = {} }) {
  if (handover) return 'counted'
  if (!production) return 'none'
  if (production.status !== 'done') return 'baking'
  if (outbound.some((t) => t.direction !== 'return' && t.status === 'draft')) return 'dispatching'
  if (Object.keys(share).length === 0) return 'nothing'
  return 'ready'
}

/**
 * The corrections a count-in writes: one per line that did not match.
 *
 * The reason is decided by the direction rather than asked for. Counting the
 * delivery at a shop asks why a line is short, because a van can lose a crate in
 * several ways; the hub's bake comes from the kitchen next door, and short or
 * extra from the kitchen is the whole of what the cashier knows.
 */
export function handoverEntries({ share = {}, counted = {}, products = [], user, at = new Date() }) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const entries = []
  for (const [productId, made] of Object.entries(share)) {
    const got = Number(counted[productId] ?? made)
    if (!Number.isInteger(got) || got < 0 || got === made) continue
    const product = byId.get(productId) ?? { id: productId, code: '', name: productId }
    const delta = got - made
    entries.push(
      adjustmentEntry({
        product,
        delta,
        reason: delta < 0 ? SHORT_FROM_KITCHEN : EXTRA_FROM_KITCHEN,
        user,
        at,
      }),
    )
  }
  return entries
}

/** Both figures for every line, kept on the handover record for good. */
export function handoverItems({ share = {}, counted = {}, products = [] }) {
  const byId = new Map(products.map((p) => [p.id, p]))
  return Object.entries(share).map(([productId, made]) => {
    const product = byId.get(productId)
    const got = Number(counted[productId] ?? made)
    return {
      productId,
      code: product?.code ?? '',
      productName: product?.name ?? productId,
      qtyMade: made,
      qtyCounted: Number.isInteger(got) && got >= 0 ? got : made,
    }
  })
}
