import { useState } from 'react'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, nextDate } from '../lib/dates.js'
import { receiveTransfer, transfersTo } from '../data/transfers.js'
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
      {!isMain && <ReceiveDelivery branchId={branchId} businessDate={today} />}
      <TomorrowsOrder branchId={branchId} businessDate={nextDate(today)} />
    </div>
  )
}

function ReceiveDelivery({ branchId, businessDate }) {
  const { profile } = useAuth()
  const incoming = useSnapshot(() => transfersTo(branchId, businessDate), [branchId, businessDate])

  // Not null. An empty space here says "nothing is coming", and a cashier who
  // believes that stops waiting for the van.
  if (incoming.loading) {
    return (
      <div className="card">
        <Loading inline>Checking for deliveries…</Loading>
      </div>
    )
  }

  const arriving = (incoming.data ?? []).filter((t) => t.direction !== 'return')
  const pending = arriving.filter((t) => t.status === 'dispatched')
  const done = arriving.filter((t) => t.status === 'received')

  return (
    <>
      {pending.map((transfer) => (
        <ReceiveCard key={transfer.id} transfer={transfer} user={profile} />
      ))}

      {pending.length === 0 && (
        <div className="card">
          <h3>Delivery</h3>
          {done.length > 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Today's delivery is confirmed — {done[0].ref}, received by {done[0].receivedByName}.
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

function ReceiveCard({ transfer, user }) {
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
        <h2 style={{ margin: 0 }}>Delivery in — {transfer.ref}</h2>
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
