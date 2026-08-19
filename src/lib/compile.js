// Turning three outlets' orders into one baking list.
//
// This is the step the owner cares most about: nobody types the baking list. It
// is kept as plain functions with no Firestore in sight so the arithmetic can be
// tested on its own, and so the same code runs in the scheduled job and in the
// app when it needs to show what the compile would do.

const byCodeThenName = (a, b) =>
  String(a.code ?? '').localeCompare(String(b.code ?? '')) ||
  String(a.productName ?? '').localeCompare(String(b.productName ?? ''))

const SUBMITTED = new Set(['submitted', 'locked'])

/**
 * Merge a freshly computed baking list into one that already exists.
 *
 * A compile that runs twice — a manual re-run, or a future-dated order picking
 * up extra lines — must never discard what the kitchen has already made. So a
 * line is never asked for less than has been produced, and a line withdrawn
 * after baking started stays on the list rather than vanishing.
 */
export function mergeProduction(existingItems = [], newItems = [], produced = {}) {
  const merged = new Map(newItems.map((it) => [it.productId, { ...it }]))

  for (const old of existingItems) {
    const madeAlready = produced[old.productId] ?? 0
    const incoming = merged.get(old.productId)
    if (incoming) {
      // Still wanted, but never ask for less than is already out of the oven.
      incoming.qtyNeeded = Math.max(incoming.qtyNeeded, madeAlready)
    } else if (madeAlready > 0) {
      // Withdrawn after baking started. The work stays on the list, but the
      // target drops to what was actually made — otherwise the kitchen would
      // keep baking towards a figure nobody is waiting for any more.
      merged.set(old.productId, { ...old, qtyNeeded: madeAlready, withdrawn: true })
    }
  }

  return [...merged.values()].sort(byCodeThenName)
}

/**
 * Sum every outlet's order for `targetDate` into one baking list.
 *
 * `fallbacks` maps a branch id to the order it placed on the last same weekday.
 * An outlet that missed the cutoff gets that repeated for it and is flagged, so
 * the kitchen is never left guessing. An outlet with no history at all — the
 * first week at a new shop — is reported in `missing` instead of being invented.
 */
export function compileDemands({ branches = [], demands = [], fallbacks = {}, existing = null }) {
  const mainId = branches.find((b) => b.isMain)?.id ?? 'MAIN'
  const satellites = branches.filter((b) => !b.isMain).map((b) => b.id)

  const used = []
  const autoFilled = []
  const missing = []

  for (const branch of branches) {
    const own = demands.find((d) => d.branchId === branch.id && SUBMITTED.has(d.status))
    if (own) {
      used.push({ branchId: branch.id, source: own })
      continue
    }
    const fallback = fallbacks[branch.id]
    if (fallback) {
      used.push({ branchId: branch.id, source: fallback, auto: true })
      autoFilled.push(branch.id)
      continue
    }
    missing.push(branch.id)
  }

  const rows = new Map()
  for (const { branchId, source } of used) {
    for (const item of source.items ?? []) {
      if (!item.qty) continue
      const row = rows.get(item.productId) ?? {
        productId: item.productId,
        code: item.code ?? '',
        productName: item.productName,
        qtyNeeded: 0,
        perOutlet: {},
        // Travels with the line, so the kitchen and the van count in the same
        // unit the shop ordered in.
        ...(item.soldByWeight ? { soldByWeight: true, unit: item.unit ?? 'kg' } : {}),
      }
      row.qtyNeeded += item.qty
      row.perOutlet[branchId] = (row.perOutlet[branchId] ?? 0) + item.qty
      rows.set(item.productId, row)
    }
  }

  let items = [...rows.values()].sort(byCodeThenName)
  if (existing) items = mergeProduction(existing.items, items, existing.produced)

  // The hub keeps its own share; only the other outlets get a delivery note.
  const transfers = satellites
    .map((toBranchId) => ({
      toBranchId,
      items: items
        .filter((it) => (it.perOutlet[toBranchId] ?? 0) > 0)
        .map((it) => ({
          productId: it.productId,
          code: it.code,
          productName: it.productName,
          qtyDemanded: it.perOutlet[toBranchId],
          ...(it.soldByWeight ? { soldByWeight: true, unit: it.unit ?? 'kg' } : {}),
        })),
    }))
    .filter((t) => t.items.length > 0)

  return {
    items,
    transfers,
    compiledFrom: used.map((u) => u.source.id).filter(Boolean),
    autoFilled,
    missing,
    mainId,
  }
}

/**
 * How far through the baking list the kitchen is.
 *
 * "Complete" means every line has been *recorded*, not that every line hit its
 * target. A morning where the ovens fell short is a perfectly normal end to the
 * baking — if finishing required meeting every number, a short day could never
 * be closed off and the vans would never leave.
 */
/**
 * What the kitchen baked beyond the list.
 *
 * Kept out of `productionProgress` on purpose: progress answers "is the list
 * done?", and a tray of extra donuts does not help finish an order for bread.
 * Counting them there would let a kitchen look finished while a line was still
 * empty.
 *
 * Entries set back to zero are dropped — that is how an extra is taken back,
 * since nothing in this system is deleted.
 */
export function extrasList(order) {
  return Object.values(order?.extras ?? {})
    .filter((e) => (e?.qty ?? 0) > 0)
    .sort((a, b) => (a.productName ?? '').localeCompare(b.productName ?? ''))
}

export function extrasTotal(order) {
  return extrasList(order).reduce((sum, e) => sum + (e.qty ?? 0), 0)
}

export function productionProgress(order) {
  const items = order?.items ?? []
  const produced = order?.produced ?? {}

  let needed = 0
  let made = 0
  let linesRecorded = 0
  let linesMet = 0
  for (const item of items) {
    const qty = item.qtyNeeded ?? 0
    needed += qty
    const recorded = produced[item.productId]
    if (recorded === undefined) continue
    linesRecorded += 1
    made += recorded
    if (recorded >= qty) linesMet += 1
  }

  return {
    needed,
    made,
    lines: items.length,
    linesRecorded,
    linesMet,
    complete: items.length > 0 && linesRecorded === items.length,
  }
}

/** Per-product gap between what was asked for and what came out of the oven. */
export function shortfalls(order) {
  const produced = order?.produced ?? {}
  return (order?.items ?? [])
    .map((item) => ({
      productId: item.productId,
      productName: item.productName,
      short: (item.qtyNeeded ?? 0) - (produced[item.productId] ?? 0),
    }))
    .filter((row) => row.short > 0)
}

/**
 * What the hub still has, out of everything it made today.
 *
 * Stated as a physical fact rather than as a share of an order: everything that
 * came out of the ovens, less everything that is on a delivery note. What is
 * left is in the building, and the building is the hub's shop.
 *
 * This replaced `mainShare`, which asked a subtly different question — "how
 * much of what the hub ordered for itself did it manage to bake" — and got
 * three things wrong at once, each of which showed the hub holding bread it did
 * not have:
 *
 *   - It took a `dispatched` argument that no caller ever passed. So on a short
 *     day, when the baker sent the whole bake to the outlets rather than keep
 *     his own share, the hub was still credited with that share in full. The
 *     owner's stock screen showed loaves that were forty minutes down the road.
 *   - It was capped at what the hub had ordered for its own counter, so a
 *     second bake nobody ordered belonged to nowhere.
 *   - Extras never appeared at all: a tray of spare rusks the hub deliberately
 *     kept was, on every screen in the system, nothing.
 *
 * `committed` is what is spoken for, from `committedOut` — a note still in
 * draft counts at what the outlet asked for, one that has gone counts at what
 * actually went. So bread earmarked for Gulberg stops being the hub's the
 * moment the note exists, not when the van pulls away, and the hub is never
 * asked at closing time to count a crate that is standing by the door with
 * somebody else's name on it.
 *
 * Products that are entirely spoken for drop out rather than sitting at zero,
 * which is what keeps the hub's closing count to things it actually handled.
 */
export function hubStock(order, committed = {}) {
  const made = { ...(order?.produced ?? {}) }
  for (const extra of extrasList(order)) {
    made[extra.productId] = (made[extra.productId] ?? 0) + (extra.qty ?? 0)
  }

  const left = {}
  for (const [productId, qty] of Object.entries(made)) {
    const keeps = qty - (committed[productId] ?? 0)
    if (keeps > 0) left[productId] = keeps
  }
  return left
}
