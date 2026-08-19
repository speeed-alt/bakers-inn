import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, formatTime, nextDate } from '../lib/dates.js'
import { extrasList, shortfalls } from '../lib/compile.js'
import { productionDoc } from '../data/production.js'
import { dispatchTransfer, receiveTransfer, transfersFrom, transfersTo } from '../data/transfers.js'
import { Empty, Loading, Stepper } from '../components/ui.jsx'

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
  const tomorrow = nextDate(today)

  // Dispatch follows the bake, not the clock.
  //
  // The baker chooses which day he is baking for, because a shop's order sent
  // at closing time is filed under tomorrow. A bakery that lights its ovens at
  // eleven at night is making tomorrow's bread while the business date still
  // says today — and the van it loads at midnight was carrying delivery notes
  // this screen could not see until four in the morning. It said "the baking
  // list has not been made yet" to somebody who had just finished making it.
  //
  // So it looks for today's list and falls back to tomorrow's, and only offers
  // a choice when both exist. Nobody has to know which day a note is filed
  // under; that is bookkeeping, and bookkeeping is the software's job.
  const todayList = useSnapshot(() => productionDoc(today), [today])
  const tomorrowList = useSnapshot(() => productionDoc(tomorrow), [tomorrow])
  const [chosen, setChosen] = useState(null)

  const bothDays = Boolean(todayList.data && tomorrowList.data)
  const day = chosen ?? (todayList.data || !tomorrowList.data ? today : tomorrow)
  const order = day === today ? todayList : tomorrowList

  const transfers = useSnapshot(() => transfersFrom(branchId, day), [branchId, day])
  const inbound = useSnapshot(() => transfersTo(branchId, day), [branchId, day])
  const branches = useSnapshot(() => collection(db, 'branches'), [])

  /** Shown only when there is genuinely a choice to make. */
  const dayToggle = bothDays ? (
    <button className="btn ghost small" onClick={() => setChosen(day === today ? tomorrow : today)}>
      {day === today ? "Send tomorrow's instead" : "Back to today's delivery"}
    </button>
  ) : null

  // branches is included here, not just order/transfers: without it, every
  // card headed by nameOf(...) below could briefly render a raw branch id
  // ("B2 — DN-0142") instead of a name while branches is still in flight —
  // on shop wifi that reads as a bug, not as a loading state, because a raw
  // id looks exactly like real data.
  if (todayList.loading || tomorrowList.loading || transfers.loading || branches.loading) {
    return <div className="page"><div className="card"><Loading>Reading the delivery notes…</Loading></div></div>
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
            No baking list has been made for {formatDate(today)} or {formatDate(tomorrow)}. The
            kitchen makes it from the outlets' orders.
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
            The delivery notes for {formatDate(day)} are ready and waiting, but the baking list is
            not finished yet. Record the last lines on the Bake screen and they will open here.
          </p>
          {dayToggle}
        </div>
      </div>
    )
  }

  const returns = (inbound.data ?? []).filter(
    (t) => t.direction === 'return' && t.status === 'dispatched',
  )

  return (
    <div className="page">
      {/* Said out loud only when it is not the obvious answer. On a normal
          morning the notes are today's and naming the day is noise; the moment
          a van is loading tomorrow's bread at midnight it is the single most
          important thing on the screen. */}
      {(bothDays || day !== today) && (
        <div className="card">
          <h2>
            Sending for {formatDate(day)}
            {day !== today && <span className="muted"> · tomorrow</span>}
          </h2>
          {dayToggle}
        </div>
      )}

      {returns.map((transfer) => (
        <ReturnCard
          key={transfer.id}
          transfer={transfer}
          fromName={nameOf(transfer.fromBranch)}
          user={profile}
        />
      ))}

      {short.length > 0 && (
        <div className="card">
          <h3>Short</h3>
          <p className="muted small">
            Less came out of the oven than the outlets asked for. Decide who gets what — the notes
            below still show what each outlet ordered.
          </p>
          <table>
            <thead>
              <tr><th>Item</th><th className="num">Short</th></tr>
            </thead>
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
          <Empty>No deliveries needed for {formatDate(day)} — no other outlet ordered anything.</Empty>
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

/**
 * What actually came back, not just a blind confirmation of what was sent.
 *
 * The "Short today" section above exists because the app's own philosophy is
 * that a shortfall gets a person's decision, never a formula quietly papering
 * over it — a delivery going the other way, back to the hub, deserves the same
 * treatment. Breakage or a miscount at the sending outlet is real, and it needs
 * somewhere to go rather than being recorded as if every last one arrived.
 */
function ReturnCard({ transfer, fromName, user }) {
  const [counted, setCounted] = useState(() =>
    Object.fromEntries(transfer.items.map((i) => [i.productId, i.qtySent])),
  )
  const short = transfer.items.filter((i) => counted[i.productId] !== i.qtySent)

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Coming back — {transfer.ref}</h2>
        <span className="muted small">from {fromName}</span>
      </div>
      <p className="muted small">
        {fromName} sent this back at closing. Count what actually arrived — the figures start at
        what was sent, so a normal return is no changes.
      </p>
      <div className="bill" style={{ margin: '12px 0' }}>
        <div className="bill-row bill-head">
          <span></span>
          <span>Item</span>
          <span>Arrived</span>
          <span className="bill-amount">Sent</span>
        </div>
        {transfer.items.map((i) => (
          <div className="bill-row" key={i.productId}>
            <span></span>
            <span className="bill-name">{i.productName}</span>
            <Stepper
              value={counted[i.productId]}
              max={i.qtySent}
              onChange={(v) => setCounted((c) => ({ ...c, [i.productId]: v }))}
              label={`arrived, ${i.productName}`}
            />
            <span className="bill-amount muted">{i.qtySent}</span>
          </div>
        ))}
      </div>
      <button
        className="btn primary big block"
        onClick={() => receiveTransfer({ transfer, counted, user })}
      >
        {short.length > 0 ? `Confirm — ${short.length} short` : 'Confirm it all came back'}
      </button>
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
            <div className="bill-row bill-head">
              <span>Code</span>
              <span>Item</span>
              <span>Sending</span>
              <span className="bill-amount">Made</span>
            </div>
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
