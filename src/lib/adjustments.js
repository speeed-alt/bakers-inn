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

/**
 * The reason on every line of a full count.
 *
 * A cashier walking the shelf and typing twenty figures cannot be asked twenty
 * times why each one moved — that is exactly the tedium the count exists to
 * remove — and mostly she does not know why. What she does know is true and
 * worth keeping: she counted, and this is what was there. The one-item
 * correction is still there for the loaves she watched go on the floor.
 */
export const COUNT_REASON = 'Counted the shelf'

/** Every reason the app will accept, for checking one that arrived from a device. */
export const ALL_REASONS = [...new Set([...MORE_REASONS, ...FEWER_REASONS, COUNT_REASON])]

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

// ---------------------------------------------------------------------------
// A whole shelf at once.

/**
 * Read one typed count.
 *
 * Blank means "I did not count this one", which is a different fact from zero —
 * treating it as zero would write off every row the cashier skipped. Anything
 * that is not a plain whole number is unreadable rather than guessed at.
 */
export function parseCount(text) {
  const raw = String(text ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  return Number(raw)
}

/**
 * What each product is measured against when the count is saved.
 *
 * The till goes on selling while the cashier walks the shelf. Measuring her
 * count against the figure at the moment she presses Save would quietly undo
 * every sale rung in between — the shelf would claim bread that has already
 * left in a customer's bag. So sales are frozen at the figure from when the
 * count *started*, and everything else — a delivery confirmed mid-count, a
 * correction someone else made — is taken as it stands now, because those
 * goods are on the shelf she is looking at.
 *
 * `raw`, not `expected`: see the note on `raw` in buildLeftovers.
 */
export function countBaseline(lines = [], soldAtStart = {}) {
  const base = {}
  for (const line of lines) {
    const raw = line.raw ?? line.expected ?? 0
    base[line.productId] = raw + (line.sold ?? 0) - (soldAtStart[line.productId] ?? 0)
  }
  return base
}

/**
 * Turn a whole shelf count into corrections — one entry per line that moved.
 *
 * Whether a line moved is judged against the figure the cashier was *shown*,
 * which never goes below zero: typing 0 over a 0 on the screen is agreement,
 * not a correction, even when the arithmetic underneath is negative. How far it
 * moves is measured from the unclamped figure, so the shelf lands on exactly
 * the number she typed.
 *
 * Every entry is an ordinary correction with its name, time and reason, so the
 * owner's trail reads the same whether it came from one dropped tray or from a
 * full count.
 */
export function countEntries({ products = [], baseline = {}, counts = {}, user, at = new Date() }) {
  const entries = []
  for (const product of products) {
    const counted = parseCount(counts[product.id])
    if (counted === null) continue
    const raw = baseline[product.id] ?? 0
    if (counted === Math.max(0, raw)) continue
    entries.push(adjustmentEntry({ product, delta: counted - raw, reason: COUNT_REASON, user, at }))
  }
  return entries
}
