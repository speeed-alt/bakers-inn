import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, nextDate } from '../lib/dates.js'
import { extrasList, extrasTotal, productionProgress } from '../lib/compile.js'
import { weighedProps } from '../lib/quantity.js'
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
import { transfersFrom } from '../data/transfers.js'
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
  const tomorrow = nextDate(today)

  // Which day is being baked for, which is not always today.
  //
  // A shop sends its order at closing time and files it under *tomorrow* —
  // that is what "tomorrow's order" means, and it has always been so. While a
  // 05:00 job existed that was invisible: the orders sent on Monday evening
  // were compiled on Tuesday morning, when Tuesday was "today", and it lined
  // up on its own.
  //
  // Taking the schedule away broke that quietly. The baker was left able to
  // compile only today — and today's orders came in yesterday. An order sent
  // an hour ago could not be reached at all, and the screen simply said no
  // orders, which looks exactly like the send having failed.
  //
  // So the day is his to choose. A bakery that starts at eleven at night is
  // baking for tomorrow; one that starts at five in the morning is baking for
  // today. Both are normal and the system should not have an opinion.
  const [bakeFor, setBakeFor] = useState(today)
  const [dayChosen, setDayChosen] = useState(false)

  const order = useSnapshot(() => productionDoc(bakeFor), [bakeFor])
  // So the screen can say what is actually waiting on Dispatch rather than
  // assuming. On a day when the only order came from the hub itself, nothing
  // goes in a van and no note is written — and this screen used to promise the
  // baker delivery notes that did not exist.
  const notes = useSnapshot(
    () => transfersFrom(profile.branchId, bakeFor),
    [profile.branchId, bakeFor],
  )
  const todayOrders = useSnapshot(() => demandsForDate(today), [today])
  const tomorrowOrders = useSnapshot(() => demandsForDate(tomorrow), [tomorrow])
  const products = useSnapshot(() => collection(db, 'products'), [])

  // Keyed by day as well as product. Keyed by product alone, a number typed on
  // one day's list and never saved was still sitting in the stepper when the
  // baker switched to the other day — so a line needing 12 showed 41, and one
  // tap wrote 41 against it. Nothing on screen would have looked wrong.
  const [draft, setDraft] = useState({})
  const keyFor = (productId) => `${bakeFor}:${productId}`

  const sent = (snap) => (snap.data ?? []).filter((d) => d.status !== 'draft')
  const todaySent = sent(todayOrders)
  const tomorrowSent = sent(tomorrowOrders)

  /** The baker picks the day; this only decides which one he is shown first. */
  const chooseDay = (date) => {
    setDayChosen(true)
    setBakeFor(date)
  }

  // Open on the day that actually has orders waiting.
  //
  // Shops send at closing time, filed under tomorrow. So on any evening the
  // orders that have just arrived are tomorrow's, and opening on today would
  // show "no orders" to a baker who watched three come in an hour ago. Only
  // until he picks for himself — after that the choice is his.
  //
  // Decided here rather than in the child that shows the picker: this is where
  // `bakeFor` lives, and setting a parent's state while a child renders is the
  // one thing React genuinely objects to. It worked, and it warned, and a
  // warning in a bakery's console is a warning nobody will ever read.
  if (!dayChosen && todaySent.length === 0 && tomorrowSent.length > 0 && bakeFor !== tomorrow) {
    setDayChosen(true)
    setBakeFor(tomorrow)
  }

  if (order.loading) {
    return <div className="page"><div className="card"><Loading>Reading the baking list…</Loading></div></div>
  }

  if (!order.data) {
    return (
      <div className="page">
        <MakeTheList
          today={today}
          tomorrow={tomorrow}
          bakeFor={bakeFor}
          chooseDay={chooseDay}
          todaySent={todaySent}
          tomorrowSent={tomorrowSent}
          user={profile}
        />
      </div>
    )
  }

  const po = order.data
  const produced = po.produced ?? {}
  const progress = productionProgress(po)

  /**
   * Record a line, then let the row fall back onto what is actually saved.
   *
   * Dropping the draft is the whole confirmation. Firestore applies the write
   * to the local cache before it leaves the tablet, so the listener has the new
   * figure by the next render — the number stays where the baker put it, the
   * button changes from "Change to 35" to "Recorded", and both of those are
   * facts about the server's copy rather than about what he typed.
   */
  // What is actually waiting on Dispatch, and what has already gone.
  const waiting = (notes.data ?? []).filter((t) => t.status === 'draft')
  const gone = (notes.data ?? []).filter((t) => t.status !== 'draft')

  function record(productId, qty) {
    recordProduced({ businessDate: bakeFor, productId, qty, user: profile })
    setDraft((current) => {
      const next = { ...current }
      delete next[keyFor(productId)]
      return next
    })
  }
  const perOutlet = (item) =>
    Object.entries(item.perOutlet ?? {})
      .filter(([, n]) => n > 0)
      .map(([b, n]) => `${b} ${n}`)
      .join(' · ')

  return (
    <div className="page">
      <div className="card">
        <div className="row between wrap">
          <h2 style={{ margin: 0 }}>
            Baking for {formatDate(po.businessDate)}
            {po.businessDate === tomorrow && <span className="muted small"> · tomorrow</span>}
          </h2>
          <span className="muted small">
            {progress.linesRecorded} of {progress.lines} lines recorded
          </span>
        </div>
        <p className="muted small">
          {po.ref} · added up from {po.compiledFrom?.length ?? 0} outlet orders.
          {po.autoFilled?.length
            ? ` ${po.autoFilled.join(', ')} did not order, so last week's was used.`
            : ''}
        </p>
        <button
          className="btn ghost small"
          onClick={() => chooseDay(bakeFor === today ? tomorrow : today)}
        >
          {bakeFor === today ? "Bake for tomorrow instead" : "Back to today's bake"}
        </button>
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
          const value = draft[keyFor(item.productId)] ?? recorded ?? item.qtyNeeded
          const isDone = recorded !== undefined
          // Whether pressing the button would actually do anything. The button
          // used to read "Change" whether or not there was a change to make, so
          // a baker who tapped it without moving the stepper — the obvious
          // thing to try — saw absolutely nothing happen, on a screen that
          // never confirms anything anyway. It read as a dead button, and it
          // was reported as one.
          const pending = isDone && value !== recorded
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
                  onChange={(v) => setDraft((c) => ({ ...c, [keyFor(item.productId)]: v }))}
                  label={`baked ${item.productName}`}
                  // Biscuits are sold by the kilo, so they are baked by the
                  // kilo. Without these the stepper is the default integer one
                  // and 2.5 kg out of the oven was recorded as 2 — half a kilo
                  // gone from the day, silently, before it ever left the hub.
                  {...weighedProps(item)}
                />
                <button
                  className={`btn small ${isDone && !pending ? 'ghost' : 'primary'}`}
                  disabled={isDone && !pending}
                  onClick={() => record(item.productId, value)}
                >
                  {!isDone ? 'Baked' : pending ? `Change to ${value}` : 'Recorded'}
                </button>
              </span>
              <span className="bill-amount">{item.qtyNeeded}</span>
            </div>
          )
        })}
      </div>

      <Extras
        order={po}
        today={bakeFor}
        user={profile}
        products={products.data ?? []}
      />

      {/* No inline marginTop needed: the preceding Extras card already supplies
          14px via its own margin-bottom, matching the rhythm used earlier on
          this same screen. Stacking both used to double the gap to 28px right
          before the primary submit button. */}
      <div className="card">
        {/* Shown in both states. It used to live only in the unfinished branch,
            so the moment a list was marked done the one number that reflects a
            correction disappeared — and correcting a line on a finished list
            then genuinely changed nothing visible anywhere on the screen. */}
        <div className="total">
          <span className="muted">Baked so far</span>
          <b>
            {progress.made} of {progress.needed}
            {extrasTotal(po) > 0 && <span className="muted small"> + {extrasTotal(po)} extra</span>}
          </b>
        </div>

        {po.status === 'done' ? (
          <>
            <p className="muted small">
              Marked finished by {po.doneByName}.{' '}
              {/* Read off the notes that exist, not assumed. When the only
                  order came from the hub itself nothing goes in a van, no note
                  is written, and this sentence used to send the baker to a
                  screen that had nothing on it — which is exactly how the
                  Dispatch tab came to look broken. */}
              {notes.loading
                ? 'Checking the delivery notes…'
                : waiting.length > 0
                  ? `${waiting.length} delivery note${waiting.length === 1 ? '' : 's'} ${
                      waiting.length === 1 ? 'is' : 'are'
                    } ready on the Dispatch screen.`
                  : gone.length > 0
                    ? 'Everything has been sent — nothing is left on Dispatch.'
                    : 'Nothing goes in a van today: every line on this list was for this outlet, so it stays here.'}
            </p>
            <button className="btn" onClick={() => reopenOrder({ businessDate: bakeFor })}>
              Still baking — reopen
            </button>
          </>
        ) : (
          <button
            className="btn primary big block"
            disabled={!progress.complete}
            onClick={() => markOrderDone({ businessDate: bakeFor, user: profile })}
          >
            {progress.complete
              ? 'All recorded — send to Dispatch'
              : `${progress.lines - progress.linesRecorded} line(s) still to record`}
          </button>
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
function MakeTheList({ today, tomorrow, bakeFor, chooseDay, todaySent, tomorrowSent, user }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [failed, setFailed] = useState(null)

  const orders = bakeFor === today ? todaySent : tomorrowSent

  async function build() {
    setBusy(true)
    setFailed(null)
    try {
      setResult(await compileNow({ businessDate: bakeFor, user }))
    } catch (error) {
      // Said out loud. A silent failure here reads as "the button does nothing",
      // and the next thing that happens is somebody bakes from memory.
      //
      // "Missing or insufficient permissions" is Firebase's words, and they
      // tell a baker at five in the morning exactly nothing. The realistic
      // cause is a sign-in that has gone stale — the rules read the token, not
      // the staff record, so a token issued before a change still carries the
      // old answer and every write is refused. Signing out and in fixes it.
      console.error('[bakery] compile failed', error)
      const denied = error?.code === 'permission-denied' ||
        /insufficient permissions/i.test(error?.message ?? '')
      setFailed(
        denied
          ? 'this tablet is not allowed to make the list. Sign out and back in, and if it still refuses, tell whoever looks after the system.'
          : `${error?.message ?? 'it did not work.'} Check the connection and try again.`,
      )
    } finally {
      setBusy(false)
    }
  }

  if (result?.items > 0) {
    return (
      <div className="card">
        <h2>Baking list ready</h2>
        <p className="muted">
          For {formatDate(bakeFor)} — {result.items} lines from {result.fromOutlets} outlet{' '}
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
      <h2>Make the baking list</h2>
      <p className="muted">
        The list is what the shops asked for, added up. Make it when you are ready to start —
        there is nothing to wait for.
      </p>

      {/* Which day, said plainly with the orders in hand for each. A bakery
          starting at eleven at night is baking for tomorrow; one starting at
          five is baking for today. */}
      <div className="field">
        <label>Which day are you baking for?</label>
        <div className="row wrap">
          {[
            { date: today, label: 'Today', sent: todaySent },
            { date: tomorrow, label: 'Tomorrow', sent: tomorrowSent },
          ].map((day) => (
            <button
              key={day.date}
              className={`chip ${bakeFor === day.date ? 'on' : ''}`}
              onClick={() => chooseDay(day.date)}
            >
              {day.label} · {formatDate(day.date)} · {day.sent.length} order
              {day.sent.length === 1 ? '' : 's'}
            </button>
          ))}
        </div>
      </div>

      {orders.length > 0 ? (
        <p className="muted small">
          {orders.length} order{orders.length === 1 ? '' : 's'} in for {formatDate(bakeFor)}. Any
          shop that has not sent one gets its last same weekday repeated.
        </p>
      ) : (
        <p className="muted small">
          No shop has sent an order for {formatDate(bakeFor)}. Making the list now would repeat
          last week for all three — worth doing only if you know their orders are not coming.
        </p>
      )}

      <button className="btn primary big block" disabled={busy} onClick={build}>
        {busy ? 'Adding up the orders…' : `Make the list for ${formatDate(bakeFor)}`}
      </button>

      {result?.items === 0 && (
        <p className="small" style={{ fontWeight: 600 }}>
          There is nothing to bake — no shop has ordered for {formatDate(bakeFor)} and none of them
          ordered on this weekday recently either. Ask the shops to send their orders.
        </p>
      )}
      {failed && (
        <p className="small" style={{ fontWeight: 600 }}>
          The list could not be made — {failed}
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
        <Stepper
          value={qty}
          onChange={setQty}
          label="how many extra"
          {...weighedProps(choices.find((p) => p.id === productId))}
        />
        <button className="btn primary" disabled={!productId || busy} onClick={add}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}
