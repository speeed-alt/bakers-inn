// Corrections the counter makes to its own shelf, during the day.
//
// Everything else about the shelf figure is worked out rather than counted:
// yesterday's carry-over, plus what was counted in off the van, less what has
// been sold. That is deliberate — a derived figure and a counted one can
// *disagree*, and the disagreement at closing is the only thing in the whole
// system that catches bread walking out of the door.
//
// But it left the cashier with no way to say a true thing. Six loaves go on the
// floor at eleven. The kitchen walks a tray over without paperwork. A delivery
// was counted in wrong and confirmed. Until closing there was nowhere to put any
// of it, and at closing it landed silently in waste with no name against it and
// no reason — which is the same shape as a theft, and reads as one.
//
// So: an adjustment is an *entry in the chain*, never an override of it. The
// cashier says what changed and why; the derived figure absorbs it and stays
// derived. What is given up is that a cashier can now move the expected figure —
// which is why every entry carries a name, a time and a reason, and why nothing
// can ever be deleted. A correction that has to be explained is a very different
// thing from a number that can be typed over.

/**
 * Why the shelf is not what the arithmetic says.
 *
 * Split by direction because the honest reasons genuinely differ, and a list
 * that offers "dropped" as an explanation for finding six extra loaves is a list
 * nobody reads. `Miscounted earlier` is on both, because it is the commonest
 * one and it goes both ways.
 */
export const MORE_REASONS = [
  'Extra from the kitchen',
  'Found some',
  'Miscounted earlier',
]

export const FEWER_REASONS = [
  'Dropped',
  'Spoiled',
  'Given to staff',
  'Miscounted earlier',
]

export function reasonsFor(delta) {
  return delta >= 0 ? MORE_REASONS : FEWER_REASONS
}

/** Every reason the app will accept, for checking one that arrived from a device. */
export const ALL_REASONS = [...new Set([...MORE_REASONS, ...FEWER_REASONS])]

/**
 * Is this something worth writing down?
 *
 * A zero change is not a correction, and a correction without a reason is a
 * number nobody can act on later — which is the whole point of recording it
 * rather than letting the cashier type over the figure.
 */
export function validAdjustment({ productId, delta, reason } = {}) {
  if (!productId) return false
  const n = Number(delta)
  if (!Number.isInteger(n) || n === 0) return false
  return ALL_REASONS.includes(reason)
}

/**
 * The net change per product, from the day's entries.
 *
 * Entries are kept, not summed away: "minus six, dropped" followed by "plus six,
 * miscounted" is two facts about a morning and reads as such. Only the shelf
 * arithmetic wants the total.
 */
export function netAdjustments(record) {
  const net = {}
  for (const entry of record?.entries ?? []) {
    const delta = Number(entry?.delta)
    if (!entry?.productId || !Number.isFinite(delta)) continue
    net[entry.productId] = (net[entry.productId] ?? 0) + delta
  }
  return net
}

/**
 * One entry, built exactly the same way every time.
 *
 * `at` is set by the caller rather than by the server, and that is on purpose.
 * These are appended with `arrayUnion`, which compares whole objects — so a
 * retry after a flaky connection sends a byte-identical entry and is dropped,
 * where a server timestamp would differ and quietly book the six dropped loaves
 * twice.
 */
export function adjustmentEntry({ product, delta, reason, user, at = new Date() }) {
  return {
    productId: product.id,
    code: product.code ?? '',
    productName: product.name ?? '',
    delta: Math.trunc(Number(delta)),
    reason,
    byId: user?.id ?? '',
    byName: user?.name ?? '',
    at: at.toISOString(),
  }
}

/** The day's entries, newest first, for showing back to whoever made them. */
export function entriesOf(record) {
  return [...(record?.entries ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
