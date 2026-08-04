import { useState } from 'react'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate } from '../lib/dates.js'
import { productionProgress } from '../lib/compile.js'
import { markOrderDone, productionDoc, recordProduced, reopenOrder } from '../data/production.js'
import { demandsForDate } from '../data/demands.js'
import { Empty, Stepper } from '../components/ui.jsx'

/**
 * Today's baking list. Nobody wrote it — it is the three outlets' orders added
 * together by the system at 5am. The kitchen adds one number per line: how many
 * actually came out. That number is pre-filled with what was asked for, so a
 * normal morning is a tap per line.
 */
export default function Bake() {
  const { profile } = useAuth()
  const today = businessDateOf()

  const order = useSnapshot(() => productionDoc(today), [today])
  const demands = useSnapshot(() => demandsForDate(today), [today])

  const [draft, setDraft] = useState({})

  if (order.loading) return <div className="page"><p className="muted">Loading…</p></div>

  if (!order.data) {
    const waiting = demands.data ?? []
    return (
      <div className="page">
        <div className="card">
          <h2>No baking list for {formatDate(today)} yet</h2>
          <p className="muted">
            The list is put together automatically at 5am from what the outlets ordered the evening
            before. Nobody has to make it.
          </p>
          {waiting.length > 0 && (
            <p className="muted small">
              {waiting.filter((d) => d.status !== 'draft').length} of {waiting.length} outlet orders
              are in so far.
            </p>
          )}
        </div>
      </div>
    )
  }

  const po = order.data
  const produced = po.produced ?? {}
  const progress = productionProgress(po)
  const perOutlet = (item) =>
    Object.entries(item.perOutlet ?? {})
      .filter(([, n]) => n > 0)
      .map(([b, n]) => `${b} ${n}`)
      .join(' · ')

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{po.ref} — {formatDate(po.businessDate)}</h2>
          <span className="muted small">
            {progress.linesRecorded} of {progress.lines} lines recorded
          </span>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Added up from {po.compiledFrom?.length ?? 0} outlet orders.
          {po.autoFilled?.length
            ? ` ${po.autoFilled.join(', ')} missed the cutoff, so last week's order was used.`
            : ''}
        </p>
      </div>

      <div className="bill">
        <div className="bill-row bill-head">
          <span>Code</span>
          <span>Item</span>
          <span>Baked</span>
          <span className="bill-amount">Needed</span>
        </div>
        {po.items.length === 0 && <Empty>Nothing on the list.</Empty>}
        {po.items.map((item) => {
          const recorded = produced[item.productId]
          const value = draft[item.productId] ?? recorded ?? item.qtyNeeded
          const isDone = recorded !== undefined
          return (
            <div className="bill-row" key={item.productId} style={isDone ? { opacity: 0.62 } : undefined}>
              <span className="bill-code">{item.code}</span>
              <span>
                <span className="bill-name">{item.productName}</span>
                {item.withdrawn && <span className="muted small"> · order withdrawn</span>}
                <div className="muted small">{perOutlet(item)}</div>
              </span>
              <span className="row" style={{ gap: 8 }}>
                <Stepper
                  value={value}
                  onChange={(v) => setDraft((c) => ({ ...c, [item.productId]: v }))}
                />
                <button
                  className={`btn small ${isDone ? 'ghost' : 'primary'}`}
                  onClick={() =>
                    recordProduced({
                      businessDate: today,
                      productId: item.productId,
                      qty: value,
                      user: profile,
                    })
                  }
                >
                  {isDone ? 'Change' : 'Baked'}
                </button>
              </span>
              <span className="bill-amount">{item.qtyNeeded}</span>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        {po.status === 'done' ? (
          <>
            <h3>Finished</h3>
            <p className="muted small">
              Marked finished by {po.doneByName}. The delivery notes are ready on the Dispatch
              screen.
            </p>
            <button className="btn" onClick={() => reopenOrder({ businessDate: today })}>
              Still baking — reopen
            </button>
          </>
        ) : (
          <>
            <div className="total">
              <span className="muted">Baked so far</span>
              <b>{progress.made} of {progress.needed}</b>
            </div>
            <button
              className="btn primary big block"
              disabled={!progress.complete}
              onClick={() => markOrderDone({ businessDate: today, user: profile })}
            >
              {progress.complete
                ? 'All recorded — send to Dispatch'
                : `${progress.lines - progress.linesRecorded} line(s) still to record`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
