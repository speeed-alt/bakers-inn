import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, formatTime } from '../lib/dates.js'
import { extrasList, shortfalls } from '../lib/compile.js'
import { productionDoc } from '../data/production.js'
import { dispatchTransfer, receiveTransfer, transfersFrom, transfersTo } from '../data/transfers.js'
import { Empty, Stepper } from '../components/ui.jsx'

/**
 * Sending the day's goods out to the other two outlets.
 *
 * Each note is already filled in with exactly what that outlet ordered, so on a
 * normal day this is one tap per outlet. When the ovens fell short the gap is
 * shown per item and the person dispatching decides who gets what — no formula
 * quietly rationing stock behind their back.
 */
export default function Dispatch({ branchId }) {
  const { profile } = useAuth()
  const today = businessDateOf()

  const order = useSnapshot(() => productionDoc(today), [today])
  const transfers = useSnapshot(() => transfersFrom(branchId, today), [branchId, today])
  const inbound = useSnapshot(() => transfersTo(branchId, today), [branchId, today])
  const branches = useSnapshot(() => collection(db, 'branches'), [])

  if (order.loading || transfers.loading) {
    return <div className="page"><p className="muted">Loading…</p></div>
  }

  const po = order.data
  const nameOf = (id) => branches.data?.find((b) => b.id === id)?.name ?? id
  const short = po ? shortfalls(po) : []

  const drafts = (transfers.data ?? []).filter((t) => t.status === 'draft')
  const sent = (transfers.data ?? []).filter((t) => t.status !== 'draft')

  if (!po) {
    return (
      <div className="page">
        <div className="card">
          <h2>Nothing to send yet</h2>
          <p className="muted">
            Today's baking list has not been made. It is put together at 5am from the outlets'
            orders.
          </p>
        </div>
      </div>
    )
  }

  if (po.status !== 'done' && drafts.length > 0) {
    return (
      <div className="page">
        <div className="card">
          <h2>Still baking</h2>
          <p className="muted">
            The delivery notes for {formatDate(today)} are ready and waiting, but the baking list is
            not finished yet. Record the last lines on the Bake screen and they will open here.
          </p>
        </div>
      </div>
    )
  }

  const returns = (inbound.data ?? []).filter(
    (t) => t.direction === 'return' && t.status === 'dispatched',
  )

  return (
    <div className="page">
      {returns.map((transfer) => (
        <div className="card" key={transfer.id}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>Coming back — {transfer.ref}</h2>
            <span className="muted small">from {nameOf(transfer.fromBranch)}</span>
          </div>
          <p className="muted small">
            {nameOf(transfer.fromBranch)} sent this back at closing. Confirm what actually arrived.
          </p>
          <table>
            <tbody>
              {transfer.items.map((i) => (
                <tr key={i.productId}>
                  <td>{i.productName}</td>
                  <td className="num">{i.qtySent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn primary big block"
            onClick={() => receiveTransfer({ transfer, user: profile })}
          >
            Confirm it all came back
          </button>
        </div>
      ))}

      {short.length > 0 && (
        <div className="card">
          <h3>Short today</h3>
          <p className="muted small">
            Less came out of the oven than the outlets asked for. Decide who gets what — the notes
            below still show what each outlet ordered.
          </p>
          <table>
            <tbody>
              {short.map((s) => (
                <tr key={s.productId}>
                  <td>{s.productName}</td>
                  <td className="num bad">short {s.short}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drafts.length === 0 && sent.length === 0 && (
        <div className="card">
          <Empty>No deliveries needed today — no other outlet ordered anything.</Empty>
        </div>
      )}

      {drafts.map((transfer) => (
        <DispatchCard
          key={transfer.id}
          transfer={transfer}
          outletName={nameOf(transfer.toBranchId)}
          user={profile}
          extras={extrasList(po)}
        />
      ))}

      {sent.map((transfer) => (
        <div className="card" key={transfer.id}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{nameOf(transfer.toBranchId)} — {transfer.ref}</h2>
            <span className="muted small">
              {transfer.status === 'received'
                ? `received by ${transfer.receivedByName}`
                : `sent ${formatTime(transfer.dispatchedAt?.toDate?.())}`}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Ordered</th>
                <th className="num">Sent</th>
                <th className="num">Received</th>
              </tr>
            </thead>
            <tbody>
              {transfer.items.map((i) => (
                <tr key={i.productId}>
                  <td>{i.productName}</td>
                  <td className="num muted">{i.qtyDemanded}</td>
                  <td className="num">{i.qtySent}</td>
                  <td className={`num ${i.qtyReceived != null && i.qtyReceived !== i.qtySent ? 'bad' : ''}`}>
                    {i.qtyReceived ?? '–'}
                    {i.shortReason ? ` · ${i.shortReason}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function DispatchCard({ transfer, outletName, user, extras = [] }) {
  // Pre-filled with what the outlet ordered: a normal day is one tap.
  const [sending, setSending] = useState(() =>
    Object.fromEntries(transfer.items.map((i) => [i.productId, i.qtyDemanded])),
  )
  // Extras this outlet is getting a share of. Nothing is pre-filled — a tray of
  // spare donuts is not owed to anybody, and splitting it evenly behind the
  // dispatcher's back is exactly the sort of quiet decision this system avoids.
  const [added, setAdded] = useState({})

  const adjusted = transfer.items.filter((i) => sending[i.productId] !== i.qtyDemanded)
  const onNote = new Set(transfer.items.map((i) => i.productId))
  const offerable = extras.filter((e) => !onNote.has(e.productId))
  const addedLines = Object.entries(added).filter(([, n]) => n > 0)

  function send() {
    // An extra becomes a real line on the note, ordered zero and sent what was
    // decided here, so the outlet counting it in sees the same shape as
    // everything else and a short delivery still needs a reason.
    const extraItems = addedLines.map(([productId, qty]) => {
      const extra = extras.find((e) => e.productId === productId)
      return {
        productId,
        code: extra?.code ?? '',
        productName: extra?.productName ?? productId,
        qtyDemanded: 0,
        qtySent: qty,
        extra: true,
      }
    })
    dispatchTransfer({
      transfer: { ...transfer, items: [...transfer.items, ...extraItems] },
      sent: sending,
      user,
    })
  }

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{outletName} — {transfer.ref}</h2>
        <span className="muted small">{transfer.items.length} items</span>
      </div>

      <div className="bill" style={{ margin: '12px 0' }}>
        <div className="bill-row bill-head">
          <span>Code</span>
          <span>Item</span>
          <span>Sending</span>
          <span className="bill-amount">Ordered</span>
        </div>
        {transfer.items.map((item) => (
          <div className="bill-row" key={item.productId}>
            <span className="bill-code">{item.code}</span>
            <span className="bill-name">{item.productName}</span>
            <Stepper
              value={sending[item.productId]}
              onChange={(v) => setSending((c) => ({ ...c, [item.productId]: v }))}
            />
            <span className="bill-amount">{item.qtyDemanded}</span>
          </div>
        ))}
      </div>

      {offerable.length > 0 && (
        <>
          <h3>Also baked today</h3>
          <p className="muted small">
            Nobody ordered these. Send this outlet as much or as little as you like — whatever is
            left stays at the hub.
          </p>
          <div className="bill" style={{ marginBottom: 12 }}>
            {offerable.map((e) => (
              <div className="bill-row" key={e.productId}>
                <span className="bill-code">{e.code}</span>
                <span className="bill-name">{e.productName}</span>
                <Stepper
                  value={added[e.productId] ?? 0}
                  max={e.qty}
                  onChange={(v) => setAdded((c) => ({ ...c, [e.productId]: v }))}
                  label={`extra ${e.productName} for ${outletName}`}
                />
                <span className="bill-amount muted">{e.qty} made</span>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn primary big block" onClick={send}>
        {adjusted.length || addedLines.length
          ? `Send — ${[
              adjusted.length && `${adjusted.length} adjusted`,
              addedLines.length && `${addedLines.length} extra`,
            ]
              .filter(Boolean)
              .join(', ')}`
          : 'Send everything ordered'}
      </button>
    </div>
  )
}
