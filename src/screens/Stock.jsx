import { useState } from 'react'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, nextDate } from '../lib/dates.js'
import { receiveTransfer } from '../data/transfers.js'
import { pendingDeliveries, useArrivals } from '../data/arrivals.js'
import { SHORT_REASONS } from '../config.js'
import { Loading, Stepper } from '../components/ui.jsx'
import TomorrowsOrder from '../components/TomorrowsOrder.jsx'

/**
 * The outlet's own two jobs: take in today's delivery, and order for tomorrow.
 * Neither involves typing a product name — one is pre-filled from the delivery
 * note, the other from what this outlet ordered on the same day last week.
 */
export default function Stock({ branchId, isMain }) {
  const today = businessDateOf()

  return (
    <div className="page">
      {!isMain && <ReceiveDelivery branchId={branchId} today={today} />}
      <TomorrowsOrder branchId={branchId} businessDate={nextDate(today)} />
    </div>
  )
}

function ReceiveDelivery({ branchId, today }) {
  const { profile } = useAuth()

  // Every note addressed here across yesterday, today and tomorrow — not just
  // today. See src/data/arrivals.js: a note carries the day it was *made for*,
  // and the baker making tomorrow's bread tonight is the normal case, not the
  // strange one. Asking only about today told this shop "nothing on its way"
  // with the van already loaded.
  const incoming = useArrivals(branchId, today)

  // Not null. An empty space here says "nothing is coming", and a cashier who
  // believes that stops waiting for the van.
  if (incoming.loading) {
    return (
      <div className="card">
        {/* Rendered in the loading state too, so the card does not visibly
            shift once the delivery data actually arrives. */}
        <h3>Delivery</h3>
        <Loading inline>Checking for deliveries…</Loading>
      </div>
    )
  }

  // A read that failed is not the same fact as a delivery that was not sent,
  // and only one of the two is safe to say out loud.
  if (incoming.error) {
    return (
      <div className="card">
        <h3>Delivery</h3>
        <p className="muted small" style={{ margin: 0 }}>
          The delivery notes could not be read on this tablet, so this is not a reliable answer.
          Sign out and back in, and if it still will not load, ring the main outlet before assuming
          nothing is coming.
        </p>
      </div>
    )
  }

  const arriving = (incoming.data ?? []).filter((t) => t.direction !== 'return')
  const pending = pendingDeliveries(incoming.data)
  const done = arriving.filter((t) => t.status === 'received')

  return (
    <>
      {pending.map((transfer) => (
        <ReceiveCard key={transfer.id} transfer={transfer} today={today} user={profile} />
      ))}

      {pending.length === 0 && (
        <div className="card">
          <h3>Delivery</h3>
          {done.length > 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              {done.length === 1 ? 'The delivery is' : `All ${done.length} deliveries are`} confirmed
              — {done.map((t) => t.ref).join(', ')}, received by{' '}
              {done[done.length - 1].receivedByName}.
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Nothing on its way yet. The delivery note appears here the moment the main outlet
              sends it.
            </p>
          )}
        </div>
      )}
    </>
  )
}

function ReceiveCard({ transfer, today, user }) {
  // Pre-filled with what was sent: a normal day is one tap.
  const [counted, setCounted] = useState(() =>
    Object.fromEntries(transfer.items.map((i) => [i.productId, i.qtySent ?? i.qtyDemanded])),
  )
  const [reasons, setReasons] = useState({})

  const changed = transfer.items.filter((i) => counted[i.productId] !== (i.qtySent ?? 0))
  const ready = changed.every((i) => reasons[i.productId])

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>
          Delivery in — {transfer.ref}
          {/* Named only when it is not today's, which is the case that used to
              be invisible. Saying "for tomorrow" on every normal delivery would
              be noise; saying nothing on the one that matters was the bug. */}
          {transfer.businessDate !== today && (
            <span className="muted"> · for {formatDate(transfer.businessDate)}</span>
          )}
        </h2>
        <span className="muted small">sent by {transfer.dispatchedByName}</span>
      </div>
      <p className="muted small">
        Count what actually arrived. Anything that does not match needs a reason — a short delivery
        is never counted as your waste.
      </p>

      <div className="bill" style={{ marginBottom: 14 }}>
        <div className="bill-row bill-head">
          <span>Code</span>
          <span>Item</span>
          <span>Counted</span>
          <span className="bill-amount">Sent</span>
        </div>
        {transfer.items.map((item) => {
          const short = counted[item.productId] !== item.qtySent
          return (
            <div className="bill-row" key={item.productId}>
              <span className="bill-code">{item.code}</span>
              <span>
                <span className="bill-name">{item.productName}</span>
                {short && (
                  <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                    {SHORT_REASONS.map((r) => (
                      <button
                        key={r}
                        className={`chip ${reasons[item.productId] === r ? 'on' : ''}`}
                        onClick={() => setReasons((c) => ({ ...c, [item.productId]: r }))}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </span>
              <Stepper
                value={counted[item.productId]}
                onChange={(v) => setCounted((c) => ({ ...c, [item.productId]: v }))}
              />
              <span className="bill-amount">{item.qtySent}</span>
            </div>
          )
        })}
      </div>

      <button
        className="btn primary big block"
        disabled={!ready}
        onClick={() => receiveTransfer({ transfer, counted, reasons, user })}
      >
        {changed.length === 0
          ? 'Confirm all — everything arrived'
          : ready
            ? `Confirm — ${changed.length} line${changed.length > 1 ? 's' : ''} adjusted`
            : 'Pick a reason for each adjusted line'}
      </button>
    </div>
  )
}
