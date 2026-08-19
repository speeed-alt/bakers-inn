import { useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, nextDate, previousDate } from '../lib/dates.js'
import { formatMoney, parseMoney } from '../lib/money.js'
import { summariseDay } from '../lib/report.js'
import { receivedAt } from '../lib/stock.js'
import { buildLeftovers, splitLeftovers, wasteValue, CARRY, RETURN, WASTE } from '../lib/leftovers.js'
import { carryoverFrom } from '../lib/dailyReport.js'
import { salesForDay } from '../data/sales.js'
import { closeDay, closingDoc, isClosed, reopenDay } from '../data/closings.js'
import { demandDoc } from '../data/demands.js'
import { productionDoc } from '../data/production.js'
import { sendReturn, transfersFrom } from '../data/transfers.js'
import { pendingDeliveries, useArrivals } from '../data/arrivals.js'
import { WASTE_REASONS } from '../config.js'
import { Empty, Loading, Modal, Money, Stepper } from '../components/ui.jsx'
import TomorrowsOrder from '../components/TomorrowsOrder.jsx'

const STEPS = ['Cash', 'Leftovers', "Tomorrow's order", 'Send']

/**
 * The end of the day, in one pass: count the drawer, count what is left on the
 * shelf, order for tomorrow, send. Every figure is filled in already — the
 * staff only correct the lines where the shop disagrees with the system.
 */
export default function CloseDay({ branchId, isMain }) {
  const { profile } = useAuth()
  const today = businessDateOf()
  const yesterday = previousDate(today)

  const yesterdaySales = useSnapshot(() => salesForDay(branchId, yesterday), [branchId, yesterday])
  const yesterdayClosing = useSnapshot(() => closingDoc(branchId, yesterday), [branchId, yesterday])

  const needsYesterday =
    !yesterdayClosing.loading &&
    !isClosed(yesterdayClosing.data) &&
    (yesterdaySales.data?.length ?? 0) > 0

  // Always the oldest day still owing a count, so a forgotten close is fixed
  // simply by opening this screen.
  const target = needsYesterday ? yesterday : today
  const late = needsYesterday

  const sales = useSnapshot(() => salesForDay(branchId, target), [branchId, target])
  const closing = useSnapshot(() => closingDoc(branchId, target), [branchId, target])
  const previous = useSnapshot(
    () => closingDoc(branchId, previousDate(target)),
    [branchId, target],
  )
  const products = useSnapshot(
    () => query(collection(db, 'products'), where('active', '==', true)),
    [],
  )
  // Across yesterday, today and tomorrow, then narrowed by the day the goods
  // were actually taken in. A note carries the day it was made for, so a
  // delivery baked for tomorrow and counted in this evening is stamped
  // tomorrow — and closing today used to read that shop as having received
  // nothing at all. See src/data/arrivals.js and `receivedAt`.
  const transfersIn = useArrivals(branchId, target)
  // The hub also needs what it sent out: what it kept is what it made less what
  // it put on a note, so without this it counted its own share of the bake even
  // on a day it gave the whole bake away. Subscribed for every outlet rather
  // than conditionally, because a hook cannot be called behind an `if`.
  const transfersOut = useSnapshot(() => transfersFrom(branchId, target), [branchId, target])
  const production = useSnapshot(() => productionDoc(target), [target])

  const [step, setStep] = useState(1)
  const [countedText, setCountedText] = useState('')
  const [floatText, setFloatText] = useState('')
  // Only used on a shop's very first close, when there is no yesterday to
  // carry a float from and the figure has to be asked for.
  const [openingText, setOpeningText] = useState('')
  const [counts, setCounts] = useState({})
  const [dispositions, setDispositions] = useState({})
  const [reasons, setReasons] = useState({})
  // Whether tomorrow's order has actually been sent during this visit to the
  // wizard, not merely reached. Nothing else in the UI caught a cashier
  // clicking through step 3 without pressing Send — the kitchen would simply
  // find no order when it came to bake, with no warning anywhere before then.
  const [orderSent, setOrderSent] = useState(false)

  // An order that is already in is already in.
  //
  // The gate above catches a cashier clicking past step 3 without pressing
  // Send. It cannot be the only test, because by closing time the order may
  // already have gone: sent earlier from the Stock tab, or — the case that
  // deadlocked the wizard — already locked, because the baker had compiled
  // tomorrow's list before the shop closed. A locked order has no Send button
  // to press, by design, so `orderSent` could never become true and the shop
  // could not finish closing its day at all.
  const tomorrowsOrder = useSnapshot(
    () => demandDoc(branchId, nextDate(target)),
    [branchId, target],
  )
  const orderIsIn =
    orderSent || ['submitted', 'locked'].includes(tomorrowsOrder.data?.status ?? '')

  const summary = useMemo(() => summariseDay(sales.data ?? []), [sales.data])

  // What the outlet had to sell: a delivery at a shop, what never went in a van
  // at the hub.
  //
  // Through `receivedAt`, which the owner's stock screen also uses. This was a
  // second copy of that arithmetic, and the two had already drifted: the figure
  // the cashier was asked to confirm at closing time was not the figure the
  // owner was reading at home.
  const received = useMemo(
    () =>
      receivedAt({
        branchId,
        isMain,
        transfers: [...(transfersIn.data ?? []), ...(transfersOut.data ?? [])],
        production: production.data,
        businessDate: target,
      }),
    [transfersIn.data, transfersOut.data, production.data, isMain, branchId, target],
  )

  const lines = useMemo(
    () =>
      buildLeftovers({
        products: products.data ?? [],
        received,
        sold: Object.fromEntries(summary.byProduct.map((p) => [p.productId, p.qty])),
        carriedIn: carryoverFrom(previous.data),
      }),
    [products.data, received, summary.byProduct, previous.data],
  )

  const stillLoading =
    yesterdayClosing.loading || sales.loading || closing.loading || previous.loading || products.loading

  if (stillLoading) {
    return <div className="page"><Loading>Loading today's figures…</Loading></div>
  }

  if (isClosed(closing.data)) {
    return (
      <ClosedView
        closing={closing.data}
        onReopen={(reason) => reopenDay({ branchId, businessDate: target, user: profile, reason })}
      />
    )
  }

  // A delivery still sitting unconfirmed would make the shelf count meaningless.
  //
  // Deliveries only. A note this outlet *sent* — leftovers going back to the
  // hub — is somebody else's to confirm, and at the hub only the baker can:
  // a cashier cannot reach the Dispatch screen at all. So a return sent from
  // Gulberg at nine o'clock blocked Susan Road's own close, every night, with
  // the remedy on a screen the person holding the tablet is not allowed to
  // open. `pendingDeliveries` is the same filter the Stock screen uses.
  const unconfirmed = pendingDeliveries(transfersIn.data)
  if (unconfirmed.length > 0) {
    return (
      <div className="page">
        <div className="card">
          <h2>Confirm today's delivery first</h2>
          <p className="muted">
            {unconfirmed[0].ref} has not been counted in yet. Until it is, the system does not know
            what was on the shelf, so the leftover count would be wrong.
          </p>
          <a className="btn primary big" href="/stock">Go to Stock</a>
        </div>
      </div>
    )
  }

  const counted = parseMoney(countedText)

  // The first close a shop ever does has no yesterday to carry a float from.
  //
  // This was `?? 0`, which quietly claimed the drawer had started empty — so
  // every outlet's very first close reported the whole float as a surplus, on
  // the one day nobody yet trusts the system. Worse, a blank float carries
  // forward: tomorrow starts from today's `nextFloat` and the error repeats
  // until somebody notices. On a first close the figure is simply asked for.
  const firstClose = !previous.loading && !previous.data
  const openingFloat = firstClose ? (parseMoney(openingText) ?? 0) : (previous.data?.nextFloat ?? 0)
  const nextFloat = floatText.trim() === '' ? openingFloat : parseMoney(floatText)
  const expected = openingFloat + summary.cashTotal
  const difference = counted === null ? null : counted - expected
  const noTrade = (sales.data?.length ?? 0) === 0 && lines.length === 0

  const priceOf = (id) => (products.data ?? []).find((p) => p.id === id)?.price ?? 0
  const { waste, carry, returns } = splitLeftovers(lines, counts, dispositions, reasons)
  const binnedValue = wasteValue(waste, priceOf)
  const needsReason = waste.filter((w) => !w.reason)

  function finish(over = {}) {
    if (returns.length > 0) {
      sendReturn({ fromBranch: branchId, businessDate: target, items: returns, user: profile })
    }
    closeDay({
      branchId,
      businessDate: target,
      openingFloat,
      countedCash: counted ?? 0,
      nextFloat: nextFloat ?? openingFloat,
      ...over,
      summary,
      waste,
      carry,
      returns,
      wasteValue: binnedValue,
      closedBy: profile,
      late,
      noTrade,
    })
  }

  if (noTrade) {
    return (
      <div className="page">
        <div className="card">
          <h2>Nothing happened on {formatDate(target)}</h2>
          <p className="muted small">
            No sales, no delivery. Close it so tomorrow can start clean.
          </p>
          {/* The drawer holds exactly what it opened with, because nothing
              opened it. Closing with `countedCash: 0` booked the whole float
              as missing money — a shop shut for Eid reported a Rs 5,000 cash
              shortage, on a screen whose entire purpose is telling the owner
              when cash has gone astray. The over/short works itself out from
              here: nothing was sold, so expected is the float too. */}
          <button
            className="btn primary big block"
            onClick={() => finish({ countedCash: openingFloat })}
          >
            Close — no trade
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {late && (
        <div className="strip block" style={{ borderRadius: 6, marginBottom: 14 }}>
          Closing {formatDate(target)} — this day was left open
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Close {formatDate(target)}</h2>
          <span className="muted small">step {step} of {STEPS.length}</span>
        </div>
        <div className="row wrap" style={{ marginTop: 10 }}>
          {STEPS.map((label, i) => (
            <button
              key={label}
              className={`chip ${step === i + 1 ? 'on' : ''}`}
              // Cannot jump ahead of a cash count that has not happened yet —
              // a cashier who taps straight to step 4 used to be able to reach
              // "Close day" having never counted the drawer at all.
              disabled={i > 0 && counted === null}
              onClick={() => setStep(i + 1)}
            >
              {/* A passed step shows a check rather than its number — useful
                  when a customer interrupts the wizard halfway through and
                  whoever comes back to it needs to see what is already done. */}
              {i + 1 < step ? '✓' : i + 1}. {label}
            </button>
          ))}
        </div>
      </div>

      {step === 1 && (
        <CashStep
          summary={summary}
          openingFloat={openingFloat}
          expected={expected}
          countedText={countedText}
          setCountedText={setCountedText}
          floatText={floatText}
          setFloatText={setFloatText}
          difference={difference}
          firstClose={firstClose}
          openingText={openingText}
          setOpeningText={setOpeningText}
        />
      )}

      {step === 2 && (
        <LeftoverStep
          lines={lines}
          counts={counts}
          setCounts={setCounts}
          dispositions={dispositions}
          setDispositions={setDispositions}
          reasons={reasons}
          setReasons={setReasons}
          isMain={isMain}
          binnedValue={binnedValue}
        />
      )}

      {step === 3 && (
        <div className="card">
          <h3>Order for {formatDate(nextDate(target))}</h3>
          <TomorrowsOrder
            branchId={branchId}
            businessDate={nextDate(target)}
            bare
            onSubmitted={() => setOrderSent(true)}
          />
        </div>
      )}

      {step === 4 && (
        <ReviewStep
          target={target}
          summary={summary}
          openingFloat={openingFloat}
          expected={expected}
          counted={counted}
          difference={difference}
          waste={waste}
          carry={carry}
          returns={returns}
          binnedValue={binnedValue}
          nextFloat={nextFloat}
          needsReason={needsReason}
          onClose={finish}
        />
      )}

      {/* On the last step this Next would be permanently disabled sitting
          right beneath ReviewStep's own working "Close day" button — a dead
          control adds noise exactly where the wizard most needs one
          unambiguous action. Back is still useful there, Next is not. */}
      {step < STEPS.length ? (
        <div className="grid2">
          <button className="btn" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
          <button
            // Demoted to a plain button while step 3 is not actually done yet,
            // so it never stands beside "Send order" at equal weight claiming
            // to be the way forward on its own.
            className={`btn ${(step === 1 && counted === null) || (step === 3 && !orderIsIn) ? '' : 'primary'}`}
            disabled={step === 1 ? counted === null : step === 3 && !orderIsIn}
            onClick={() => setStep((s) => s + 1)}
          >
            {step === 1 && counted === null
              ? 'Count the cash first'
              : step === 3 && !orderIsIn
                ? 'Send the order first'
                : 'Next'}
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
      )}
    </div>
  )
}

function CashStep({ summary, openingFloat, expected, countedText, setCountedText, floatText, setFloatText, difference, firstClose, openingText, setOpeningText }) {
  return (
    <>
      {firstClose && (
        <div className="card">
          <h3>What was in the drawer this morning</h3>
          <p className="muted small">
            This is the first close for this shop, so there is no yesterday to carry the float
            from. Enter the cash that was in the drawer before the first customer — after tonight
            it carries itself forward and you will not be asked again.
          </p>
          <div className="field">
            <label>Opening float</label>
            <input
              type="text"
              inputMode="numeric"
              value={openingText}
              onChange={(e) => setOpeningText(e.target.value)}
              placeholder="e.g. 5000"
            />
          </div>
          {openingText.trim() === '' && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              Left blank this counts as an empty drawer, and the whole float will read as a
              surplus tonight.
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h3>What the system expects</h3>
        <table>
          <tbody>
            <tr><td>Opening float</td><td className="num"><Money minor={openingFloat} /></td></tr>
            <tr><td>Cash sales</td><td className="num"><Money minor={summary.cashTotal} /></td></tr>
            <tr>
              <td><b>Cash expected in drawer</b></td>
              <td className="num"><b><Money minor={expected} /></b></td>
            </tr>
            {/* Every way anybody actually paid today. Cash is above, because
                that is the only figure the drawer is counted against; these are
                listed so the total still explains itself. */}
            {summary.byMethod.filter((m) => !m.drawer).map((m) => (
              <tr key={m.id}>
                <td className="muted">{m.label}</td>
                <td className="num muted"><Money minor={m.total} /></td>
              </tr>
            ))}
            <tr><td className="muted">Total takings</td><td className="num muted"><Money minor={summary.salesTotal} /></td></tr>
            {summary.voidedCount > 0 && (
              <tr><td className="muted">Voided (not counted)</td><td className="num muted">{summary.voidedCount}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Count the drawer</h3>
        <p className="muted small">
          Count everything in the drawer now, before you put tomorrow's float back in.
        </p>
        <div className="field">
          <label>Cash counted</label>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={countedText}
            onChange={(e) => setCountedText(e.target.value)}
            placeholder="0"
          />
        </div>

        {difference !== null && (
          <div className="total">
            <span className="muted">
              {difference === 0 ? 'Exact' : difference > 0 ? 'Over' : 'Short'}
            </span>
            <b className={difference === 0 ? '' : 'bad'}><Money minor={Math.abs(difference)} /></b>
          </div>
        )}

        <div className="field">
          <label>Float to leave for tomorrow (defaults to today's)</label>
          <input
            type="text"
            inputMode="numeric"
            value={floatText}
            onChange={(e) => setFloatText(e.target.value)}
            placeholder={formatMoney(openingFloat, { symbol: false })}
          />
        </div>
      </div>
    </>
  )
}

function LeftoverStep({ lines, counts, setCounts, dispositions, setDispositions, reasons, setReasons, isMain, binnedValue }) {
  if (lines.length === 0) {
    return (
      <div className="card">
        <h3>Nothing to count</h3>
        <Empty>No stock came in and nothing sold, so there is nothing left over.</Empty>
      </div>
    )
  }

  // The words are the ones already printed on the shop's own closing sheet —
  // stale, remaining stock — so nobody has to learn a second vocabulary.
  const choices = [
    { key: WASTE, label: 'Stale' },
    { key: CARRY, label: 'Remaining' },
    ...(isMain ? [] : [{ key: RETURN, label: 'Send back' }]),
  ]

  return (
    <div className="card">
      <h3>Closing stock</h3>
      <p className="muted small">
        Already filled in with what should be on the shelf. Change only the lines where the shop
        disagrees. Things that do not keep are counted stale by default; things that do stay as
        remaining stock.
      </p>

      <div className="bill">
        <div className="bill-row bill-head">
          <span>Code</span>
          <span>Item</span>
          <span>Remaining</span>
          <span className="bill-amount">Sold</span>
        </div>
        {lines.map((line) => {
          const qty = counts[line.productId] ?? line.expected
          const how = dispositions[line.productId] ?? line.disposition
          return (
            // "top", not the default centering: this is the one .bill-row that
            // can grow to several lines (name, detail, disposition chips,
            // waste-reason chips), and centering left the Stepper — the
            // control that actually matters here — floating mid-row instead
            // of level with the product name.
            <div className="bill-row top" key={line.productId}>
              <span className="bill-code">{line.code}</span>
              <span>
                <span className="bill-name">{line.productName}</span>
                <div className="muted small">
                  existing {line.carriedIn} · addition {line.received} · expected {line.expected}
                </div>
                {qty > 0 && (
                  <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                    {choices.map((c) => (
                      <button
                        key={c.key}
                        className={`chip ${how === c.key ? 'on' : ''}`}
                        onClick={() => setDispositions((s) => ({ ...s, [line.productId]: c.key }))}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {qty > 0 && how === WASTE && (
                  <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                    {WASTE_REASONS.map((r) => (
                      <button
                        key={r}
                        className={`chip ${(reasons[line.productId] ?? 'Unsold') === r ? 'on' : ''}`}
                        onClick={() => setReasons((s) => ({ ...s, [line.productId]: r }))}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </span>
              <Stepper
                value={qty}
                onChange={(v) => setCounts((s) => ({ ...s, [line.productId]: v }))}
              />
              <span className="bill-amount">{line.sold}</span>
            </div>
          )
        })}
      </div>

      <div className="total" style={{ marginTop: 14 }}>
        <span className="muted">Stale</span>
        <b className={binnedValue > 0 ? 'bad' : ''}><Money minor={binnedValue} /></b>
      </div>
    </div>
  )
}

function ReviewStep({ target, summary, openingFloat, expected, counted, difference, waste, carry, returns, binnedValue, nextFloat, needsReason, onClose }) {
  return (
    <>
      <div className="card">
        <h3>{formatDate(target)} in full</h3>
        <table>
          <tbody>
            <tr><td>Takings</td><td className="num"><Money minor={summary.salesTotal} /></td></tr>
            <tr><td className="muted">Cash</td><td className="num muted"><Money minor={summary.cashTotal} /></td></tr>
            {summary.digitalTotal !== 0 && (
              <tr>
                <td className="muted">Not in the drawer</td>
                <td className="num muted"><Money minor={summary.digitalTotal} /></td>
              </tr>
            )}
            <tr><td className="muted">Card</td><td className="num muted"><Money minor={summary.cardTotal} /></td></tr>
            <tr><td>Counted in drawer</td><td className="num">{counted === null ? '—' : <Money minor={counted} />}</td></tr>
            <tr>
              {/* Not counted yet is a different fact from "counted, and it was
                  exact" — falling through to "Short — Rs 0" here used to say
                  the drawer had been checked and was fine, when really nobody
                  had counted it at all. */}
              <td>
                {difference === null
                  ? 'Not counted yet'
                  : difference === 0
                    ? 'Exact'
                    : difference > 0
                      ? 'Over'
                      : 'Short'}
              </td>
              <td className={`num ${difference ? 'bad' : ''}`}>
                {difference === null ? '—' : <Money minor={Math.abs(difference)} />}
              </td>
            </tr>
            <tr><td>Stale</td><td className="num">{waste.reduce((s, w) => s + w.qty, 0)} items · <Money minor={binnedValue} /></td></tr>
            <tr><td>Remaining stock</td><td className="num">{carry.reduce((s, c) => s + c.qty, 0)} items</td></tr>
            {returns.length > 0 && (
              <tr><td>Going back to the main outlet</td><td className="num">{returns.reduce((s, r) => s + r.qty, 0)} items</td></tr>
            )}
            {/* The float is the last thing a cashier hand-types before this
                screen, and this is the last chance to catch a mistyped one
                before the day is actually closed — previously it only showed
                up afterwards, in ClosedView. */}
            <tr><td>Float left for tomorrow</td><td className="num"><Money minor={nextFloat} /></td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        {needsReason.length > 0 ? (
          <p className="bad small">Pick a reason for every stale line before closing.</p>
        ) : (
          <p className="muted small">
            Closing sends the day to the owner. It can still be reopened if something was wrong.
          </p>
        )}
        <button
          className="btn primary big block"
          disabled={counted === null || needsReason.length > 0}
          onClick={onClose}
        >
          Close day
        </button>
      </div>
    </>
  )
}

const REOPEN_REASONS = ['Closed by mistake', 'Still trading', 'Miscounted the drawer', 'Other']

function ClosedView({ closing, onReopen }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState(null)
  const reopens = (closing.events ?? []).filter((e) => e.action === 'reopened').length

  return (
    <div className="page">
      <div className="card">
        <h2>{formatDate(closing.businessDate)} is closed</h2>
        <p className="muted small">
          Closed by {closing.closedByName}.
          {reopens > 0 && ` Reopened ${reopens} time${reopens > 1 ? 's' : ''} today.`}
        </p>
        <table>
          <tbody>
            <tr><td>Takings</td><td className="num"><Money minor={closing.salesTotal} /></td></tr>
            <tr><td>Cash</td><td className="num"><Money minor={closing.cashTotal} /></td></tr>
            <tr><td>Card</td><td className="num"><Money minor={closing.cardTotal} /></td></tr>
            <tr><td>Counted</td><td className="num"><Money minor={closing.countedCash} /></td></tr>
            <tr>
              <td>{closing.overShort === 0 ? 'Exact' : closing.overShort > 0 ? 'Over' : 'Short'}</td>
              <td className={`num ${closing.overShort === 0 ? '' : 'bad'}`}>
                <Money minor={Math.abs(closing.overShort)} />
              </td>
            </tr>
            {closing.wasteValue > 0 && (
              <tr><td>Binned</td><td className="num bad"><Money minor={closing.wasteValue} /></td></tr>
            )}
            <tr><td>Float left for tomorrow</td><td className="num"><Money minor={closing.nextFloat} /></td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Closed this by mistake?</h3>
        <p className="muted small">
          Reopening puts the till back on and lets you count again. Nothing is erased — both counts
          stay on the record and the owner sees that it happened.
        </p>
        <button className="btn" onClick={() => setAsking(true)}>Reopen this day</button>
      </div>

      {asking && (
        <Modal title={`Reopen ${formatDate(closing.businessDate)}?`} onClose={() => setAsking(false)}>
          <p className="muted small">Why is it being reopened?</p>
          <div className="row wrap" style={{ marginBottom: 16 }}>
            {REOPEN_REASONS.map((r) => (
              <button key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <button
            className="btn primary big block"
            disabled={!reason}
            onClick={() => {
              onReopen(reason)
              setAsking(false)
            }}
          >
            Reopen the day
          </button>
        </Modal>
      )}
    </div>
  )
}
