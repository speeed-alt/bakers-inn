import { useMemo } from 'react'
import { useSnapshot } from '../lib/hooks.js'
import { businessDateOf, nextDate, previousDate } from '../lib/dates.js'
import { transfersTo } from './transfers.js'

/**
 * Goods that have turned up for this outlet and have not been dealt with yet.
 *
 * Everything else in this system is filed under a business date, and that is
 * right: a day's takings belong to a day. Goods do not. A crate is in the room
 * or it is not, and the date written on its paperwork is somebody else's day.
 *
 * Three separate cases were each broken by asking only about today:
 *
 *   - The baker bakes tomorrow's bread tonight, so the delivery note is stamped
 *     tomorrow. The shop it is addressed to was told "nothing on its way yet"
 *     while the van was outside.
 *   - An outlet sends its leftovers back at closing, so the note is stamped the
 *     day that just ended. The hub confirms it in the morning — by which time
 *     the business date has rolled over and the note is stamped yesterday.
 *     Nobody could ever confirm a return, on any day, since the feature shipped.
 *   - A delivery dispatched at half past three in the morning and not counted in
 *     before four became invisible at four.
 *
 * So the rule here is: **outbound follows the list, inbound follows the goods.**
 * The hub dispatches a particular baking list and picks which one. But anything
 * arriving is looked for across yesterday, today and tomorrow, because those are
 * the only dates a note that is still open can plausibly carry, and a crate in
 * the room does not care which one it is.
 *
 * Three listeners rather than one range query: the security rules require every
 * transfer query to pin a branch, and a range on `businessDate` alongside that
 * equality would need a composite index deployed before it would run at all.
 * Three equality listeners need nothing and cost a few kilobytes.
 */
export function arrivalDays(today = businessDateOf()) {
  return [previousDate(today), today, nextDate(today)]
}

/**
 * Every note addressed to this outlet across that window, oldest first.
 *
 * Returns the same shape as `useSnapshot` so it drops into a screen the same
 * way: `{ loading, error, data }`. Loading until all three have answered —
 * showing two thirds of the deliveries would be worse than showing none, since
 * the missing third looks like a delivery that was never sent.
 */
export function useArrivals(branchId, today = businessDateOf()) {
  const [yesterday, , tomorrow] = arrivalDays(today)

  const before = useSnapshot(() => transfersTo(branchId, yesterday), [branchId, yesterday])
  const now = useSnapshot(() => transfersTo(branchId, today), [branchId, today])
  const after = useSnapshot(() => transfersTo(branchId, tomorrow), [branchId, tomorrow])

  return useMemo(() => {
    const parts = [before, now, after]
    return {
      loading: parts.some((p) => p.loading),
      // Any one of the three failing is the whole answer failing. A screen that
      // quietly drops the day it could not read would tell somebody a delivery
      // does not exist, which is the one thing a delivery screen must never do.
      error: parts.find((p) => p.error)?.error ?? null,
      data: parts
        .flatMap((p) => p.data ?? [])
        .sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate))),
    }
  }, [before, now, after])
}

/** Deliveries an outlet still has to count in. */
export function pendingDeliveries(arrivals = []) {
  return arrivals.filter((t) => t.direction !== 'return' && t.status === 'dispatched')
}

/** Stock an outlet has sent back that the hub still has to confirm. */
export function pendingReturns(arrivals = []) {
  return arrivals.filter((t) => t.direction === 'return' && t.status === 'dispatched')
}
