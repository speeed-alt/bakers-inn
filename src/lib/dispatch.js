// What a delivery note says after somebody has acted on it.
//
// Pure, and separate from the Firestore write, for the reason every other
// calculation in this app is: the arithmetic of a delivery is the part that can
// be wrong in a way nobody notices for a week, so it belongs somewhere a test
// can reach it. The write itself is three lines and cannot really be wrong.

/**
 * The lines as they leave the hub.
 *
 * `sent` holds only what the dispatcher actually adjusted; every other line
 * goes out as ordered. The middle fallback — the line's own `qtySent` — is what
 * carries a tray of something nobody ordered.
 *
 * That case is worth spelling out because it was broken from the day extras
 * shipped. An extra is added to the note as `{ qtyDemanded: 0, qtySent: 20 }`,
 * and it can never appear in `sent`, which is seeded from the note's own lines
 * and deliberately excludes anything already on it. Falling straight from
 * `sent` to `qtyDemanded` therefore resolved every extra to zero. The van left
 * with the donuts, the note recorded none, the receiving shop could only book
 * them in by claiming a miscount of its own, and the printed day sheet valued
 * them at nothing — while the button read "Send — 1 extra".
 */
export function dispatchedItems(items = [], sent = {}) {
  return items.map((item) => ({
    ...item,
    qtySent: sent[item.productId] ?? item.qtySent ?? item.qtyDemanded ?? 0,
  }))
}

/**
 * The lines as they are counted in at the far end.
 *
 * A line that does not match what was sent keeps both numbers and gains a
 * reason. Never one number quietly replacing the other: a short delivery is the
 * hub's problem or the road's problem, and turning it into the receiving shop's
 * waste is how a cashier ends up answering for bread they never had.
 */
export function receivedItems(items = [], counted = {}, reasons = {}) {
  return items.map((item) => {
    const sent = item.qtySent ?? 0
    const got = counted[item.productId] ?? sent
    return {
      ...item,
      qtyReceived: got,
      ...(got !== sent ? { shortReason: reasons[item.productId] ?? 'Other' } : {}),
    }
  })
}

/**
 * What one outlet has already promised away, product by product.
 *
 * A note still in draft counts at what the receiving outlet asked for, because
 * that is what is earmarked; once it has gone it counts at what actually went.
 * The distinction matters on a short day, when the dispatcher cuts a note down
 * and the difference stays behind on the hub's own shelf.
 *
 * Returns are excluded: stock coming back the other way is somebody else's
 * despatch, and counting it here would have the hub give away its own bread
 * twice over.
 */
export function committedOut(branchId, transfers = []) {
  const out = {}
  for (const transfer of transfers) {
    if (transfer.fromBranch !== branchId) continue
    if (transfer.direction === 'return') continue
    for (const item of transfer.items ?? []) {
      const qty =
        transfer.status === 'draft'
          ? (item.qtyDemanded ?? 0)
          : (item.qtySent ?? item.qtyDemanded ?? 0)
      out[item.productId] = (out[item.productId] ?? 0) + qty
    }
  }
  return out
}
