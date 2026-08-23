import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, formatTime, nextDate } from '../lib/dates.js'
import { extrasList, shortfalls } from '../lib/compile.js'
import { productionDoc } from '../data/production.js'
import { dispatchTransfer, receiveTransfer, startTransfer, transfersFrom } from '../data/transfers.js'
import { pendingReturns, useArrivals } from '../data/arrivals.js'
import { committedOut } from '../lib/dispatch.js'
import { weighedProps } from '../lib/quantity.js'
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
  const branches = useSnapshot(() => collection(db, 'branches'), [])

  // Outbound follows the list; inbound follows the goods.
  //
  // What goes out is a particular baking list, and the baker picks which one.
  // What comes back is crates in the room, and they arrive on nobody's
  // schedule: an outlet sends its leftovers at closing, so the note carries the
  // day that just ended, and the hub confirms it the next morning — after 04:00,
  // when that date is already yesterday. Pinned to the bake day, this query
  // could not match a single return that had ever been sent. See
  // src/data/arrivals.js.
  const inbound = useArrivals(branchId, today)

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
  if (todayList.loading || tomorrowList.loading || transfers.loading || inbound.loading || branches.loading) {
    return <div className="page"><div className="card"><Loading>Reading the delivery notes…</Loading></div></div>
  }

  const po = order.data
  const nameOf = (id) => branches.data?.find((b) => b.id === id)?.name ?? id
  const short = po ? shortfalls(po) : []

  const drafts = (transfers.data ?? []).filter((t) => t.status === 'draft')
  const sent = (transfers.data ?? []).filter((t) => t.status !== 'draft')

  // Computed here, above every early return, and rendered in all three states.
  //
  // These used to sit at the bottom of the final tree, which meant crates that
  // an outlet had already sent back could only be confirmed on a morning when
  // the baking list happened to exist and be finished. At 05:00, before the
  // list is made, the screen said "nothing to send yet" and there was no way
  // anywhere in the app to take yesterday's stock back in. Goods arriving have
  // nothing to do with whether goods are going out.
  const returns = pendingReturns(inbound.data)

  // Outlets with no note at all for this day, and anything baked that is not
  // already on one.
  const written = new Set((transfers.data ?? []).map((t) => t.toBranchId))
  const unwritten = (branches.data ?? []).filter((b) => !b.isMain && !written.has(b.id))

  // How much of each unordered tray is actually still at the hub.
  //
  // Every card used to offer the whole tray, capped at what was baked, and each
  // card decided that on its own — so thirty spare rusks could be given in full
  // to Gulberg and in full to Gulistan Colony, and the system would believe
  // sixty had been made. What is on a note is spoken for; only the rest can be
  // offered. Extras are never products from the compiled list — the Bake screen
  // will not let them be — so nothing else is subtracted here by mistake.
  const spokenFor = committedOut(branchId, transfers.data ?? [])
  const offerable = (po ? extrasList(po) : [])
    .map((e) => ({ ...e, qty: Math.max(0, (e.qty ?? 0) - (spokenFor[e.productId] ?? 0)) }))
    .filter((e) => e.qty > 0)
  const spare = offerable.reduce((n, e) => n + e.qty, 0)

  const returnCards = returns.map((transfer) => (
    <ReturnCard
      key={transfer.id}
      transfer={transfer}
      fromName={nameOf(transfer.fromBranch)}
      today={today}
      user={profile}
    />
  ))

  // A read that was refused is not the fact that nothing is happening. Said
  // plainly, because the alternative is a screen that calmly reports no work
  // to a person who has three vans waiting.
  if (transfers.error || inbound.error) {
    return (
      <div className="page">
        <div className="card">
          <h2>The delivery notes could not be read</h2>
          <p className="muted">
            This is not the same as there being nothing to send — the till was refused, so it
            cannot say either way. Sign out and back in. If it still will not load, tell whoever
            looks after the system rather than assuming there is no delivery.
          </p>
        </div>
        {returnCards}
      </div>
    )
  }

  if (!po) {
    return (
      <div className="page">
        {returnCards}
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
        {returnCards}
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

      {returnCards}

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
          <Empty>
            No outlet ordered anything for {formatDate(day)}, so nothing was made ready to send.
          </Empty>
        </div>
      )}

      {/* Somewhere to put a bake nobody ordered.
          Notes come pre-filled from the compile, one per outlet that ordered —
          which left the baker no way at all to send anything on a day when no
          outlet had. On a bakery whose hub is also its busiest shop that is an
          ordinary day, and it is exactly the day a spare tray gets baked.
          Offered only when there is a reason: a tray waiting to go somewhere,
          or a shop with no note at all. */}
      {unwritten.length > 0 && (offerable.length > 0 || drafts.length + sent.length === 0) && (
        <div className="card">
          <h3>Send something that was not ordered</h3>
          <p className="muted small">
            {offerable.length > 0
              ? `${spare} item${spare === 1 ? '' : 's'} were baked beyond the list and are not on any note yet. Start a note for whoever should get some.`
              : 'Nothing was ordered for this day. Start a note if a shop needs bread anyway.'}
          </p>
          <div className="row wrap">
            {unwritten.map((branch) => (
              <button
                key={branch.id}
                className="btn"
                onClick={() =>
                  startTransfer({
                    businessDate: day,
                    fromBranch: branchId,
                    toBranchId: branch.id,
                    user: profile,
                  })
                }
              >
                Start a note for {branch.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {drafts.map((transfer) => (
        <DispatchCard
          key={transfer.id}
          transfer={transfer}
          outletName={nameOf(transfer.toBranchId)}
          user={profile}
          extras={offerable}
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
function ReturnCard({ transfer, fromName, today, user }) {
  const [counted, setCounted] = useState(() =>
    Object.fromEntries(transfer.items.map((i) => [i.productId, i.qtySent])),
  )
  const short = transfer.items.filter((i) => counted[i.productId] !== i.qtySent)

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>
          Coming back — {transfer.ref}
          {/* Almost always last night's, since a return is sent at closing and
              confirmed the next morning. Naming the day is what stops somebody
              confirming yesterday's crates against today's. */}
          {transfer.businessDate !== today && (
            <span className="muted"> · from {formatDate(transfer.businessDate)}</span>
          )}
        </h2>
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
              onChange={(v) => setCounted((c) => ({ ...c, [i.productId]: v }))}
              label={`arrived, ${i.productName}`}
              {...weighedProps(i)}
              max={i.qtySent}
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
  const goingOut =
    transfer.items.reduce((n, i) => n + (sending[i.productId] ?? 0), 0) +
    Object.values(added).reduce((n, v) => n + (v ?? 0), 0)
  const nothingToSend = goingOut <= 0
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
              label={`sending, ${item.productName}`}
              {...weighedProps(item)}
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
                  onChange={(v) => setAdded((c) => ({ ...c, [e.productId]: v }))}
                  label={`extra ${e.productName} for ${outletName}`}
                  {...weighedProps(e)}
                  max={e.qty}
                />
                <span className="bill-amount muted">{e.qty} made</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* An empty note is not a delivery. A note started by hand begins with
          nothing on it, and sending it in that state dispatched a van with
          nothing in it — the outlet then gets a delivery to count in that
          contains no lines at all. */}
      <button className="btn primary big block" disabled={nothingToSend} onClick={send}>
        {nothingToSend
          ? 'Nothing on this note yet'
          : adjusted.length || addedLines.length
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
