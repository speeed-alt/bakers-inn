import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate } from '../lib/dates.js'
import { extrasList, extrasTotal, productionProgress } from '../lib/compile.js'
import {
  addExtra,
  compileNow,
  markOrderDone,
  productionDoc,
  recordProduced,
  removeExtra,
  reopenOrder,
} from '../data/production.js'
import { demandsForDate } from '../data/demands.js'
import { byCategoryThenName } from '../lib/search.js'
import { Empty, Loading, Stepper } from '../components/ui.jsx'

/**
 * Today's baking list. Nobody wrote it — it is the three outlets' orders added
 * together, on the morning the baker starts. The kitchen adds one number per
 * line: how many actually came out. That number is pre-filled with what was
 * asked for, so a normal morning is a tap per line.
 */
export default function Bake() {
  const { profile } = useAuth()
  const today = businessDateOf()

  const order = useSnapshot(() => productionDoc(today), [today])
  const demands = useSnapshot(() => demandsForDate(today), [today])
  const products = useSnapshot(() => collection(db, 'products'), [])

  const [draft, setDraft] = useState({})

  if (order.loading) {
    return <div className="page"><div className="card"><Loading>Reading today's baking list…</Loading></div></div>
  }

  if (!order.data) {
    return (
      <div className="page">
        <MakeTheList today={today} demands={demands.data ?? []} user={profile} />
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
        <div className="row between wrap">
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
            <div className={`bill-row${isDone ? ' bill-row-done' : ''}`} key={item.productId}>
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

      <Extras
        order={po}
        today={today}
        user={profile}
        products={products.data ?? []}
      />

      {/* No inline marginTop needed: the preceding Extras card already supplies
          14px via its own margin-bottom, matching the rhythm used earlier on
          this same screen. Stacking both used to double the gap to 28px right
          before the primary submit button. */}
      <div className="card">
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
              <b>
                {progress.made} of {progress.needed}
                {extrasTotal(po) > 0 && (
                  <span className="muted small"> + {extrasTotal(po)} extra</span>
                )}
              </b>
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

/**
 * Where the day's baking actually begins.
 *
 * There was a 05:00 job that did this. It decided, at a fixed hour, what the
 * bakery would bake — so the kitchen's morning depended on a clock and a
 * network neither of them could see, and a morning it did not run was a morning
 * nobody in the building could do anything about.
 *
 * The baker starts the bake now. Same arithmetic — `compileDemands`, the shops'
 * own orders added up — just triggered by the person about to light the ovens.
 * It is not a manual entry screen: nobody types what to bake.
 */
function MakeTheList({ today, demands, user }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [failed, setFailed] = useState(null)

  const orders = demands.filter((d) => d.status !== 'draft')

  async function build() {
    setBusy(true)
    setFailed(null)
    try {
      setResult(await compileNow({ businessDate: today, user }))
    } catch (error) {
      // Said out loud. A silent failure here reads as "the button does nothing",
      // and the next thing that happens is somebody bakes from memory.
      console.error('[bakery] manual compile failed', error)
      setFailed(error?.message ?? 'It did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (result?.items > 0) {
    return (
      <div className="card">
        <h2>Baking list ready</h2>
        <p className="muted">
          {result.items} lines from {result.fromOutlets} outlet{' '}
          {result.fromOutlets === 1 ? 'order' : 'orders'}
          {result.transfers > 0 && `, and ${result.transfers} delivery notes on Dispatch`}.
        </p>
        {result.autoFilled?.length > 0 && (
          <p className="muted small">
            Repeated last week for: {result.autoFilled.join(', ')} — they had not ordered.
          </p>
        )}
        <button className="btn primary" onClick={() => window.location.reload()}>
          Open the list
        </button>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Today's baking list</h2>
      <p className="muted">
        The list is what the three shops asked for last night, added up. Make it when you are
        ready to start — there is nothing to wait for.
      </p>

      {orders.length > 0 ? (
        <p className="muted small">
          {orders.length} of {demands.length} outlet orders are in.
          {orders.length < demands.length &&
            ' The shops that have not sent one get their last same weekday repeated.'}
        </p>
      ) : (
        <p className="muted small">
          No shop has sent an order for today yet. Making the list now would repeat last week for
          all three — worth doing only if you know their orders are not coming.
        </p>
      )}

      <button className="btn primary big" disabled={busy} onClick={build}>
        {busy ? 'Adding up the orders…' : "Make today's list"}
      </button>

      {result?.items === 0 && (
        <p className="small" style={{ fontWeight: 600 }}>
          There is nothing to bake — no outlet has ordered today and none of them ordered on this
          weekday recently either. Ask the shops to send their orders.
        </p>
      )}
      {failed && (
        <p className="small" style={{ fontWeight: 600 }}>
          The list could not be made — {failed} Check the connection and try again.
        </p>
      )}
    </div>
  )
}

/**
 * Things baked that nobody ordered.
 *
 * A second bake because the bread went by ten, a tray of donuts made because
 * the oven was free. These are kept apart from the compiled list rather than
 * added into it: the list is what the outlets asked for, and if extras were
 * folded in, tomorrow's suggested order would learn from a demand that was
 * never made.
 *
 * Anything added here shows up on the Dispatch screen, where whoever is loading
 * the van decides which outlet it goes to. Nobody rations it behind their back.
 */
function Extras({ order, today, user, products }) {
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)

  const extras = extrasList(order)
  const onList = new Set((order.items ?? []).map((i) => i.productId))
  // Something already on the list is recorded against its own line, not added
  // twice — otherwise the same bake would be counted in two places.
  const choices = products
    .filter((p) => p.active !== false && !onList.has(p.id))
    .sort(byCategoryThenName)

  async function add() {
    const product = choices.find((p) => p.id === productId)
    if (!product || qty <= 0) return
    setBusy(true)
    try {
      await addExtra({ businessDate: today, product, qty, user })
      setProductId('')
      setQty(1)
    } catch (error) {
      console.error('[bakery] extra failed to save', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row between wrap">
        <h3 style={{ margin: 0 }}>Also baked today</h3>
        {extras.length > 0 && (
          <span className="muted small">{extrasTotal(order)} extra</span>
        )}
      </div>
      <p className="muted small">
        Anything made beyond the list — a second bake, or something nobody ordered. It goes out on
        Dispatch, where whoever loads the van decides which outlet gets it.
      </p>

      {extras.length > 0 && (
        <div className="bill" style={{ marginBottom: 12 }}>
          <div className="bill-row bill-head">
            <span>Code</span>
            <span>Item</span>
            <span></span>
            <span className="bill-amount">Qty</span>
          </div>
          {extras.map((e) => (
            <div className="bill-row" key={e.productId}>
              <span className="bill-code">{e.code}</span>
              <span>
                <span className="bill-name">{e.productName}</span>
                <div className="muted small">added by {e.byName}</div>
              </span>
              <button
                className="btn ghost small"
                onClick={() => removeExtra({ businessDate: today, productId: e.productId })}
              >
                Remove
              </button>
              <span className="bill-amount">{e.qty}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8 }}>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
          aria-label="Something else baked"
        >
          <option value="">Choose what was baked…</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <Stepper value={qty} onChange={setQty} label="how many extra" />
        <button className="btn primary" disabled={!productId || busy} onClick={add}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}
