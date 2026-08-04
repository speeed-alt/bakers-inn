import { addDays, previousDate } from './dates.js'
import { isClosed } from './closing.js'
import { daysOfStock, lowStock } from './materials.js'

export const DAYS_SHOWN = 7

/** Takings per day across all outlets, oldest first, with today taken live. */
export function buildWeek(closings = [], today, todayLive = 0, days = DAYS_SHOWN) {
  const byDate = new Map()
  for (const c of closings) {
    byDate.set(c.businessDate, (byDate.get(c.businessDate) ?? 0) + (c.salesTotal ?? 0))
  }

  const out = []
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = addDays(today, -back)
    const isToday = date === today
    out.push({ date, isToday, total: isToday ? todayLive : (byDate.get(date) ?? 0) })
  }
  return out
}

/**
 * Waste and sell-through across a run of days.
 *
 * Read from the compiled reports rather than recomputed, so the owner's figure
 * and the one the cashier saw at closing time are the same number.
 */
export function summariseWaste(reports = []) {
  let wasteQty = 0
  let wasteValue = 0
  let available = 0
  let sold = 0
  let varianceValue = 0
  const worst = new Map()

  for (const report of reports) {
    wasteQty += report.wasteQty ?? 0
    wasteValue += report.wasteValue ?? 0
    varianceValue += report.transferVarianceValue ?? 0

    for (const row of report.byProduct ?? []) {
      available += (row.received ?? 0) + (row.carriedIn ?? 0)
      sold += row.sold ?? 0
      if (!row.wasted) continue
      const entry = worst.get(row.productId) ?? {
        productId: row.productId,
        productName: row.productName,
        qty: 0,
        value: 0,
      }
      entry.qty += row.wasted
      entry.value += row.wastedValue ?? 0
      worst.set(row.productId, entry)
    }
  }

  return {
    days: reports.length,
    wasteQty,
    wasteValue,
    varianceValue,
    wastePct: available > 0 ? Math.round((wasteQty / available) * 100) : 0,
    sellThroughPct: available > 0 ? Math.round((sold / available) * 100) : null,
    worst: [...worst.values()].sort((a, b) => b.value - a.value || b.qty - a.qty),
  }
}

/**
 * The short list of things that are actually wrong.
 *
 * Deliberately capped: a dashboard that always shows five warnings teaches its
 * owner to ignore warnings. Only things someone can act on today belong here.
 */
export function findProblems({
  today,
  branches = [],
  closings = [],
  transfers = [],
  order = null,
  materials = [],
  nameOf = (x) => x,
  max = 6,
}) {
  const problems = []
  const yesterday = previousDate(today)

  for (const c of closings) {
    if (c.businessDate === today && !isClosed(c)) {
      problems.push({
        what: 'A day that was closed has been reopened',
        where: `${nameOf(c.branchId)} · reopened by ${c.reopenedByName ?? 'staff'}${
          c.reopenReason ? ` — ${c.reopenReason}` : ''
        }`,
      })
    }
  }

  for (const branch of branches) {
    const closed = closings.find(
      (c) => c.businessDate === yesterday && c.branchId === branch.id && isClosed(c),
    )
    if (!closed) {
      problems.push({
        what: 'Yesterday was never counted',
        where: `${branch.name ?? branch.id} · the till there is blocked until it is`,
      })
    }
  }

  for (const t of transfers) {
    if (t.status === 'dispatched') {
      problems.push({
        what: 'A delivery has not been confirmed',
        where: `${nameOf(t.toBranchId)} · sent as ${t.ref}`,
      })
    }
    for (const item of t.items ?? []) {
      const missing = (item.qtySent ?? 0) - (item.qtyReceived ?? item.qtySent ?? 0)
      if (item.qtyReceived == null || missing <= 0) continue
      problems.push({
        what: `${missing} × ${item.productName} did not arrive`,
        where: `${nameOf(t.toBranchId)} · ${item.shortReason ?? 'no reason given'} · ${t.ref}`,
      })
    }
  }

  if (order?.missing?.length) {
    problems.push({
      what: 'An outlet has no order and no history to fall back on',
      where: `${order.missing.map(nameOf).join(', ')} · nothing was baked for them`,
    })
  }

  for (const material of lowStock(materials)) {
    const days = daysOfStock(material)
    problems.push({
      what: `${material.name} is running out`,
      where:
        days === null
          ? `${material.onHand ?? 0} ${material.unit} left · under the level you set`
          : `${material.onHand ?? 0} ${material.unit} left · about ${Math.floor(days)} day${
              Math.floor(days) === 1 ? '' : 's'
            } at the current rate`,
    })
  }

  return problems.slice(0, max)
}
