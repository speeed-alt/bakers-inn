import { addDays } from './dates.js'

// What to order tomorrow, worked out from what actually sold.
//
// Until now tomorrow's order was last week's order, copied. That is better than
// a blank sheet, but it repeats last week's mistakes exactly: an item that was
// over-ordered stays over-ordered every week, and one that sold out at noon
// keeps selling out. The shop's own closing reports already say what happened.
// Using them is the difference between a form that remembers and one that
// learns.
//
// Two judgements are built in, and both are deliberately conservative, because
// a suggestion the outlet does not believe is a suggestion they will start
// overriding without reading.

/** How many of the same weekday to look back over. */
export const WEEKS_CONSIDERED = 4

/**
 * A day that ended with nothing left and nothing binned did not measure demand
 * — it measured the shelf. Real demand was higher by an unknown amount, so the
 * figure is nudged up rather than taken at face value. Ten per cent is small on
 * purpose: it corrects the bias without inventing customers.
 */
export const SOLD_OUT_UPLIFT = 1.1

/**
 * The same weekday as `forDate`, most recent first.
 *
 * Stepping back in whole weeks rather than matching weekday names sidesteps
 * locale and timezone entirely: seven days before a Tuesday is a Tuesday
 * everywhere.
 */
export function sameWeekdayReports(reports, forDate, weeks = WEEKS_CONSIDERED) {
  const wanted = new Set()
  for (let back = 1; back <= weeks; back += 1) wanted.add(addDays(forDate, -7 * back))

  return reports
    .filter((r) => wanted.has(r.businessDate))
    .sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate)))
}

/** True when a product ran out: everything went, and none of it went in the bin. */
export function soldOut(row) {
  return (row.sold ?? 0) > 0 && (row.leftover ?? 0) === 0 && (row.wasted ?? 0) === 0
}

/** What that day really called for, as opposed to what the shelf allowed. */
function neededOn(row) {
  const sold = row.sold ?? 0
  return soldOut(row) ? Math.ceil(sold * SOLD_OUT_UPLIFT) : sold
}

/**
 * Suggest a quantity per product from a handful of same-weekday reports.
 *
 * Returns `{ days, items }`, where each item carries the working as well as the
 * answer — the screen shows the outlet what the number was based on, so it can
 * be argued with. A number with no explanation gets ignored or obeyed blindly,
 * and both are worse than a number someone checked.
 */
export function suggestOrder(history = []) {
  const days = history.length
  if (days === 0) return { days: 0, items: {} }

  const gathered = new Map()
  for (const report of history) {
    for (const row of report.byProduct ?? []) {
      if (!gathered.has(row.productId)) {
        gathered.set(row.productId, { sold: [], needed: [], ranOut: 0, wasted: 0 })
      }
      const entry = gathered.get(row.productId)
      entry.sold.push(row.sold ?? 0)
      entry.needed.push(neededOn(row))
      entry.wasted += row.wasted ?? 0
      if (soldOut(row)) entry.ranOut += 1
    }
  }

  const items = {}
  for (const [productId, entry] of gathered) {
    // Average over every day looked at, not just the days this product appears
    // in. A product absent from a report sold none that day, and dropping those
    // days would quietly turn "sold 40 once in four weeks" into "order 40".
    const total = entry.needed.reduce((sum, n) => sum + n, 0)
    const qty = Math.round(total / days)

    // Nothing sold across the whole window: suggest nothing rather than round
    // a trickle up to one and have it ordered every day forever.
    if (qty <= 0) continue

    items[productId] = {
      qty,
      sold: entry.sold,
      ranOut: entry.ranOut,
      wasted: entry.wasted,
    }
  }

  return { days, items }
}
