import { arrayUnion, doc, Timestamp, writeBatch } from 'firebase/firestore'
import { useMemo } from 'react'
import { db } from '../firebase.js'
import { fireAndForget } from './errors.js'
import { useSnapshot } from '../lib/hooks.js'
import { businessDateOf, nextDate } from '../lib/dates.js'
import { adjustmentRef, handoverDocId, handoverRef } from '../lib/ids.js'
import { practiceStamp } from '../lib/practice.js'
import { validAdjustment } from '../lib/adjustments.js'
import { bakeStatus, handoverEntries, handoverItems, hubShare } from '../lib/handover.js'
import { adjustmentDoc } from './adjustments.js'
import { productionDoc } from './production.js'
import { transfersFrom } from './transfers.js'

// See src/lib/handover.js for why the hub counts in its bake without a
// delivery note of its own.

export function handoverDoc(branchId, businessDate) {
  return doc(db, 'bakeHandovers', handoverDocId(businessDate, branchId))
}

/**
 * Today's and tomorrow's bake, as the hub counter sees them.
 *
 * Both days, for the same reason deliveries look across three: the kitchen bakes
 * tomorrow's list tonight, so the bake that is ready right now is usually filed
 * under tomorrow. Asking only about today would tell the cashier nothing was
 * ready with the trays already out of the oven.
 *
 * A falsy branch subscribes to nothing, so App can call this unconditionally for
 * every signed-in person and pass a branch only for a cashier at the hub.
 */
export function useHubBake(branchId, today = businessDateOf()) {
  const tomorrow = nextDate(today)
  const when = (make) => (branchId ? make() : null)

  const poToday = useSnapshot(() => when(() => productionDoc(today)), [branchId, today])
  const poTomorrow = useSnapshot(() => when(() => productionDoc(tomorrow)), [branchId, tomorrow])
  const outToday = useSnapshot(() => when(() => transfersFrom(branchId, today)), [branchId, today])
  const outTomorrow = useSnapshot(
    () => when(() => transfersFrom(branchId, tomorrow)),
    [branchId, tomorrow],
  )
  const hoToday = useSnapshot(() => when(() => handoverDoc(branchId, today)), [branchId, today])
  const hoTomorrow = useSnapshot(
    () => when(() => handoverDoc(branchId, tomorrow)),
    [branchId, tomorrow],
  )

  return useMemo(() => {
    const parts = [poToday, poTomorrow, outToday, outTomorrow, hoToday, hoTomorrow]

    const day = (businessDate, label, po, out, ho) => {
      const production = po.data ?? null
      const outbound = out.data ?? []
      const handover = ho.data ?? null
      const share = hubShare({ branchId, production, outbound })
      return {
        businessDate,
        when: label,
        production,
        handover,
        share,
        status: bakeStatus({ production, outbound, handover, share }),
      }
    }

    const days = [
      day(today, 'today', poToday, outToday, hoToday),
      day(tomorrow, 'tomorrow', poTomorrow, outTomorrow, hoTomorrow),
    ]

    return {
      loading: Boolean(branchId) && parts.some((p) => p.loading),
      // One of the six failing is the whole answer failing: a counter told
      // "nothing is ready" because a read was refused stops waiting for bread.
      error: parts.find((p) => p.error)?.error ?? null,
      days,
      ready: days.filter((d) => d.status === 'ready'),
    }
  }, [branchId, today, tomorrow, poToday, poTomorrow, outToday, outTomorrow, hoToday, hoTomorrow])
}

/**
 * Count in one day's bake at the hub counter.
 *
 * The handover record and any corrections go in one batch, so they land
 * together or not at all. A count-in saved without its corrections would say
 * "counted 45" while the shelf still showed 50; corrections saved without the
 * record would leave the notice up, and a second confirm would book the same
 * short tray twice. The rules refuse a second handover for the same day, which
 * fails the whole batch — so a retry can never double the corrections either.
 *
 * Corrections are dated by the baking list, not by today: the hub's share is
 * counted onto its shelf on the list's own date, and the correction has to land
 * on the same day as the figure it corrects.
 */
export function recordHandover({ branchId, businessDate, share, counted, products, user }) {
  const at = new Date()
  const entries = handoverEntries({ share, counted, products, user, at }).filter((entry) =>
    validAdjustment(entry),
  )

  const batch = writeBatch(db)
  batch.set(handoverDoc(branchId, businessDate), {
    ...practiceStamp(),
    ref: handoverRef(businessDate, branchId),
    branchId,
    businessDate,
    items: handoverItems({ share, counted, products }),
    receivedBy: user?.id ?? '',
    receivedByName: user?.name ?? '',
    receivedAt: Timestamp.fromDate(at),
  })

  if (entries.length > 0) {
    batch.set(
      adjustmentDoc(branchId, businessDate),
      {
        ...practiceStamp(),
        ref: adjustmentRef(businessDate, branchId),
        branchId,
        businessDate,
        entries: arrayUnion(...entries),
      },
      { merge: true },
    )
  }

  fireAndForget(batch.commit(), `bake count-in at ${branchId}`)
  return entries.length
}
