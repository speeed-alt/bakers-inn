import { useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, nextDate, previousDate } from '../lib/dates.js'
import { receiveTransfer, transfersFrom } from '../data/transfers.js'
import { pendingDeliveries, useArrivals } from '../data/arrivals.js'
import { salesForDay } from '../data/sales.js'
import { closingDoc } from '../data/closings.js'
import { productionDoc } from '../data/production.js'
import { stockAt } from '../lib/stock.js'
import { adjustmentDoc, entriesOf, reasonsFor, recordAdjustment } from '../data/adjustments.js'
import { weighedProps } from '../lib/quantity.js'
import { findProducts } from '../lib/search.js'
import { SHORT_REASONS } from '../config.js'
import { Empty, Loading, Modal, Stepper } from '../components/ui.jsx'
import TomorrowsOrder from '../components/TomorrowsOrder.jsx'

/**
 * The outlet's own two jobs: take in today's delivery, and order for tomorrow.
 * Neither involves typing a product name — one is pre-filled from the delivery
 * note, the other from what this outlet ordered on the same day last week.
 */
export default function Stock({ branchId, branchName, isMain }) {
  const today = businessDateOf()

  return (
    <div className="page">
      {!isMain && <ReceiveDelivery branchId={branchId} today={today} />}
      <OnTheShelf branchId={branchId} branchName={branchName} isMain={isMain} today={today} />
      <TomorrowsOrder branchId={branchId} businessDate={nextDate(today)} />
    </div>
  )
}

/**
 * What is actually on the shelf, right now.
 *
 * The tab has been called Stock since the first week and did not show any. A
 * cashier confirmed a delivery, watched the card turn into one line of grey
 * text, and had no way — anywhere in the app — to see what her own shop was
 * holding. The one screen that answered it was the owner's.
 *
 * Worked out by `stockAt`, the same function behind the owner's report and the
 * close wizard, so all three agree by construction. Nobody counts continuously:
 * this is yesterday's leftovers, plus what has been counted in today, less what
 * has been sold. A delivery still waiting to be confirmed is deliberately not
 * in it — the card above is what turns it into stock, and that is the point of
 * having to confirm at all.
 */
function OnTheShelf({ branchId, branchName, isMain, today }) {
  const yesterday = previousDate(today)
  const { profile } = useAuth()
  // The product a correction is being written against, or `true` for the button
  // at the top of the card, which starts with nothing chosen.
  const [correcting, setCorrecting] = useState(null)

  const products = useSnapshot(
    () => query(collection(db, 'products'), where('active', '==', true)),
    [],
  )
  const sales = useSnapshot(() => salesForDay(branchId, today), [branchId, today])
  const previous = useSnapshot(() => closingDoc(branchId, yesterday), [branchId, yesterday])
  const arrivals = useArrivals(branchId, today)
  // The hub keeps what it baked and did not put on a note, so it needs both the
  // list and its own outgoing notes. A shop subscribes to them too rather than
  // behind a condition — a hook cannot be asked for conditionally — and simply
  // has none.
  const production = useSnapshot(() => productionDoc(today), [today])
  const outbound = useSnapshot(() => transfersFrom(branchId, today), [branchId, today])
  const corrections = useSnapshot(() => adjustmentDoc(branchId, today), [branchId, today])

  const loading =
    products.loading || sales.loading || previous.loading || arrivals.loading ||
    production.loading || outbound.loading || corrections.loading

  if (loading) {
    return (
      <div className="card">
        <h3>On the shelf</h3>
        <Loading inline>Working out what is left…</Loading>
      </div>
    )
  }

  const shelf = stockAt({
    products: products.data ?? [],
    branch: { id: branchId, name: branchName, isMain },
    transfers: [...(arrivals.data ?? []), ...(outbound.data ?? [])],
    production: isMain ? production.data : null,
    sales: sales.data ?? [],
    previousClosing: previous.data,
    businessDate: today,
    adjustments: corrections.data,
  })

  // A line whose only event today is a correction still belongs here — write off
  // six dropped loaves and watching the row disappear is how a cashier decides
  // the button did not work and writes them off again.
  const lines = shelf.lines.filter((l) => l.expected > 0 || l.sold > 0 || l.adjusted !== 0)
  const written = entriesOf(corrections.data)

  return (
    <div className="card">
      <div className="row between wrap">
        <h3 style={{ margin: 0 }}>On the shelf</h3>
        <span className="muted small">{shelf.onShelf} item{shelf.onShelf === 1 ? '' : 's'} left</span>
      </div>
      <p className="muted small">
        Yesterday's leftovers plus today's delivery, less what has sold. A delivery you have not
        counted in yet is not on this list.
      </p>

      {lines.length === 0 ? (
        <Empty>Nothing has come in or gone out today yet.</Empty>
      ) : (
        <div className="bill">
          <div className="bill-row bill-head">
            <span>Code</span>
            <span>Item</span>
            <span>Sold</span>
            <span className="bill-amount">Left</span>
          </div>
          {lines.map((line) => (
            <div className="bill-row" key={line.productId}>
              <span className="bill-code">{line.code}</span>
              <span>
                <span className="bill-name">{line.productName}</span>
                <div className="muted small">
                  {line.carriedIn > 0 && `${line.carriedIn} carried · `}
                  {line.received} in
                  {/* Said on the line rather than folded into the figure. A
                      correction that disappears into a total looks exactly like
                      stock going missing, which is the one thing the closing
                      count exists to notice. */}
                  {line.adjusted !== 0 &&
                    ` · ${line.adjusted > 0 ? '+' : ''}${line.adjusted} corrected`}
                </div>
              </span>
              <span className="muted">{line.sold}</span>
              <span className="bill-amount">
                {line.expected}
                <button
                  className="btn ghost small"
                  style={{ marginLeft: 8 }}
                  onClick={() => setCorrecting(line.productId)}
                >
                  Correct
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Separate from the rows, because the commonest correction is for
          something that is not on them: a tray the kitchen carried over without
          paperwork, of an item today's delivery never included. */}
      <button className="btn block" style={{ marginTop: 12 }} onClick={() => setCorrecting(true)}>
        Correct the shelf — something dropped, spoiled or arrived
      </button>

      {written.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Corrections today — kept for the owner, and cannot be unsaid.
          </div>
          <div className="bill">
            {written.map((e) => (
              <div className="bill-row" key={`${e.productId}-${e.at}`}>
                <span className="bill-code">{e.code}</span>
                <span>
                  <span className="bill-name">{e.productName}</span>
                  <div className="muted small">{e.reason} · {e.byName}</div>
                </span>
                <span />
                <span className={`bill-amount ${e.delta < 0 ? 'bad' : ''}`}>
                  {e.delta > 0 ? '+' : ''}{e.delta}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {correcting && (
        <CorrectShelf
          products={products.data ?? []}
          preset={typeof correcting === 'string' ? correcting : null}
          shelf={shelf}
          onClose={() => setCorrecting(null)}
          onSave={(fields) => {
            recordAdjustment({ branchId, businessDate: today, user: profile, ...fields })
            setCorrecting(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Write down a change to the shelf that the arithmetic cannot know about.
 *
 * Asked as two questions rather than as a signed number: more or fewer, then how
 * many. A stepper that runs through zero into negatives is a thing a developer
 * finds obvious and a cashier gets wrong at the second attempt, and getting it
 * wrong here moves the figure her own closing count is checked against.
 *
 * The reason is required and the list depends on the direction, because a list
 * offering "dropped" as the explanation for six extra loaves is a list nobody
 * reads — and a cashier who stops reading it picks the first item every time.
 */
function CorrectShelf({ products, preset, shelf, onClose, onSave }) {
  const [text, setText] = useState('')
  const [productId, setProductId] = useState(preset)
  const [direction, setDirection] = useState('fewer')
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState(null)

  const product = products.find((p) => p.id === productId)
  const matches = findProducts(products, text).slice(0, 8)
  const delta = direction === 'fewer' ? -qty : qty
  const onShelf = shelf.lines.find((l) => l.productId === productId)?.expected ?? 0

  return (
    <Modal title="Correct the shelf" onClose={onClose}>
      {!product ? (
        <>
          <div className="field">
            <label>Which item?</label>
            <input
              type="text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a code or name"
              aria-label="Find the item to correct"
            />
          </div>
          <div className="bill">
            {matches.map((p) => (
              <button className="result" key={p.id} onClick={() => setProductId(p.id)}>
                <span className="result-code">{p.code}</span>
                <span className="result-name">{p.name}</span>
                <span />
              </button>
            ))}
            {matches.length === 0 && <Empty>Nothing matches "{text}"</Empty>}
          </div>
        </>
      ) : (
        <>
          <div className="row between wrap" style={{ marginBottom: 12 }}>
            <b>{product.name}</b>
            <button className="btn ghost small" onClick={() => setProductId(null)}>Change item</button>
          </div>
          <p className="muted small">
            The system thinks there {onShelf === 1 ? 'is' : 'are'} <b>{onShelf}</b> on the shelf.
            Say what changed — this is kept with your name against it, and the owner sees it.
          </p>

          <div className="field">
            <label>Is there more, or fewer?</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {[['fewer', 'Fewer than that'], ['more', 'More than that']].map(([key, label]) => (
                <button
                  key={key}
                  className={`chip ${direction === key ? 'on' : ''}`}
                  onClick={() => {
                    setDirection(key)
                    // The reasons differ by direction, so one chosen for the
                    // other direction is not an answer to this question.
                    setReason(null)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>How many?</label>
            <Stepper value={qty} onChange={setQty} label="how many" min={1} {...weighedProps(product)} />
          </div>

          <div className="field">
            <label>Why?</label>
            <div className="row wrap" style={{ gap: 6 }}>
              {reasonsFor(delta).map((r) => (
                <button
                  key={r}
                  className={`chip ${reason === r ? 'on' : ''}`}
                  onClick={() => setReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn primary big block"
            disabled={!reason || qty < 1}
            onClick={() => onSave({ product, delta, reason })}
          >
            {reason
              ? `Save — ${delta > 0 ? '+' : ''}${delta}, ${reason.toLowerCase()}`
              : 'Pick a reason'}
          </button>
        </>
      )}
    </Modal>
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
          The delivery notes could not be read on this till, so this is not a reliable answer.
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
                label={`counted, ${item.productName}`}
                {...weighedProps(item)}
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
