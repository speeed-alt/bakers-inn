// Lines on a bill that deserve a second look before the money is taken.
//
// The till deliberately knows nothing about stock when it comes to *refusing* a
// sale, and that stays true: what is on the shelf is worked out rather than
// counted, so the system's belief is often wrong early in the day — a delivery
// not yet confirmed, a second tray nobody recorded — and a till that turned a
// customer away over paperwork would cost more than it ever saved.
//
// But saying nothing at all is a different thing from not blocking. These are
// the two cases worth a word, and neither stops the sale going through.

import { formatMoney } from './money.js'

/** A single line worth this much is worth checking before it is taken. */
export const BIG_LINE = 25000

/**
 * What looks wrong about a bill, if anything.
 *
 * `onShelf` is what the system believes this outlet has, product by product —
 * from `stockAt`, the same figure the Stock tab and the owner's report show. A
 * product missing from it entirely is not "none": it is something the system
 * has no opinion about, which is the ordinary state of a shop before the first
 * delivery is counted in, so it earns no warning.
 */
export function oddLines(lines = [], { onShelf = null, big = BIG_LINE } = {}) {
  const odd = []
  for (const line of lines) {
    const amount = Math.round((line.price ?? 0) * (line.qty ?? 0))
    const known = onShelf && Object.prototype.hasOwnProperty.call(onShelf, line.productId)
    const left = known ? onShelf[line.productId] : null

    // More than the shop is thought to have. Said, never refused — the belief
    // is the thing most likely to be wrong.
    if (known && (line.qty ?? 0) > left) {
      odd.push({
        productId: line.productId,
        name: line.name,
        kind: 'over-shelf',
        left,
        say: `more than the ${left} we think are left`,
      })
      continue
    }

    // And the order of magnitude that is never a real bakery line.
    if (amount >= big) {
      odd.push({
        productId: line.productId,
        name: line.name,
        kind: 'large',
        amount,
        say: `${formatMoney(amount)} on one line`,
      })
    }
  }
  return odd
}
