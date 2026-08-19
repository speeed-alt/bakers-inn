import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, formatTime, previousDate } from '../lib/dates.js'
import { basketTotal, formatMoney, lineTotal, parseMoney, toMinor } from '../lib/money.js'
import { exactCodeMatch, findProducts } from '../lib/search.js'
import {
  changePaymentType,
  recordRefund,
  recordSale,
  salesForDay,
  voidSale,
} from '../data/sales.js'
import { closingDoc } from '../data/closings.js'
import { productionDoc } from '../data/production.js'
import { transfersFrom } from '../data/transfers.js'
import { useArrivals } from '../data/arrivals.js'
import { stockAt } from '../lib/stock.js'
import { oddLines } from '../lib/oddities.js'
import { isClosed, tillBlocked } from '../lib/closing.js'
import { priceOf, ratesNotSet, ratesOf } from '../lib/rates.js'
import { lineNameFor, variantsOf } from '../lib/grouping.js'
import { rateDoc } from '../data/rates.js'
import {
  formatQuantity,
  isWeighed,
  maxFor,
  parseQuantity,
  roundQuantity,
  stepFor,
  unitOf,
} from '../lib/quantity.js'
import { customLine, lastCustomPrice, rememberCustomPrice, validCustom } from '../lib/custom.js'
import { Empty, Loading, Modal, Money, Stepper } from '../components/ui.jsx'
import { PAYMENT_METHODS, QUICK_CASH_STEPS, VOID_REASONS } from '../config.js'
import { accountFor, inDrawer, labelOf, needsAccount } from '../lib/payments.js'
import Receipt from '../components/Receipt.jsx'
import { printReceipt } from '../lib/paper.js'

/**
 * Named, not counted: "eggs and bread" is worth reading before the cashier
 * starts typing. With no cap a morning where several rates are unset can wrap
 * onto multiple lines in the fixed-height entry area, pushing the box the
 * cashier is about to type into further down the screen.
 */
function unpricedList(products, max = 3) {
  const names = products.map((p) => p.name)
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

export default function Sell({ branchId, branch }) {
  const branchName = branch?.name ?? branchId
  const { profile } = useAuth()
  const today = businessDateOf()
  const yesterday = previousDate(today)

  const products = useSnapshot(
    () => query(collection(db, 'products'), where('active', '==', true)),
    [],
  )
  const todaySales = useSnapshot(() => salesForDay(branchId, today), [branchId, today])
  const yesterdaySales = useSnapshot(() => salesForDay(branchId, yesterday), [branchId, yesterday])
  const yesterdayClosing = useSnapshot(() => closingDoc(branchId, yesterday), [branchId, yesterday])
  const todayClosing = useSnapshot(() => closingDoc(branchId, today), [branchId, today])

  // What the system believes is on the shelf, so a line can *say* when it is
  // selling past it. Never to refuse a sale — the belief is worked out rather
  // than counted, and it is wrong most often early in the morning, exactly when
  // a shop is busiest. The inputs are the same ones the Stock tab and the
  // owner's report use, so all three agree by construction rather than by luck.
  //
  // Every one of these is served from the tablet's own cache when the line is
  // down, like the rest of the till.
  const arrivals = useArrivals(branchId, today)
  const production = useSnapshot(() => productionDoc(today), [today])
  const sentOut = useSnapshot(() => transfersFrom(branchId, today), [branchId, today])

  const [text, setText] = useState('')
  const [lines, setLines] = useState([])
  const [paying, setPaying] = useState(false)
  // Set when Pay was pressed on a bill with something odd on it.
  const [checking, setChecking] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  // The name typed into the entry box when the cashier asked to sell it as a
  // one-off. Null when the dialogue is closed.
  const [customFor, setCustomFor] = useState(null)
  const [picking, setPicking] = useState(null)
  const entry = useRef(null)

  // This morning's rates for the items that are priced fresh. A missing sheet
  // is not an error — the till falls back to each product's last known rate and
  // says so in a strip, rather than refusing to sell.
  const todayRates = useSnapshot(() => rateDoc(today), [today])
  const prices = ratesOf(todayRates.data)
  const catalogue = products.data ?? []
  const unpriced = ratesNotSet(catalogue, prices)
  // An empty box lists the whole catalogue, so the same panel is both the
  // search result and the price list a new cashier reads codes off.
  const results = useMemo(() => findProducts(catalogue, text), [catalogue, text])

  // Derived, not stored. This used to be a piece of state set only inside the
  // Enter handler, which meant the till knew nothing matched the moment the
  // third letter was typed and said so only if you asked it.
  const typed = text.trim()
  const noMatch = typed.length > 0 && results.length === 0
  const total = basketTotal(lines)

  // Yesterday had takings but was never closed: that has to be fixed before a
  // new day's cash can be counted against the drawer.
  // Product by product, from `stockAt`. Null until it can be worked out, which
  // reads as "no opinion" downstream rather than as "none".
  const onShelf = useMemo(() => {
    if (products.loading || arrivals.loading || todaySales.loading) return null
    const shelf = stockAt({
      products: products.data ?? [],
      branch: { id: branchId, name: branchName, isMain: branch?.isMain ?? false },
      transfers: [...(arrivals.data ?? []), ...(sentOut.data ?? [])],
      production: branch?.isMain ? production.data : null,
      sales: todaySales.data ?? [],
      previousClosing: yesterdayClosing.data,
      businessDate: today,
    })
    return Object.fromEntries(shelf.lines.map((l) => [l.productId, l.expected]))
  }, [
    products.loading, products.data, arrivals.loading, arrivals.data, sentOut.data,
    production.data, todaySales.loading, todaySales.data, yesterdayClosing.data,
    branchId, branchName, branch, today,
  ])

  // What on this bill is worth a second look. Never blocks; asks once.
  const odd = useMemo(() => oddLines(lines, { onShelf }), [lines, onShelf])
  const oddOf = (productId) => odd.find((o) => o.productId === productId)

  // Which of today's sales already have a refund against them. `refundOf` was
  // being written and read by nothing; this is the read.
  const refundedRefs = new Set(
    (todaySales.data ?? []).filter((x) => x.refundOf).map((x) => x.refundOf),
  )

  const mustCloseYesterday =
    !yesterdayClosing.loading &&
    tillBlocked({
      closing: yesterdayClosing.data,
      salesYesterday: yesterdaySales.data?.length ?? 0,
    })

  function addProduct(p, variant = null) {
    // Several names can share one id — five cakes at the same price are one
    // stock line and one code. Which one the customer asked for still has to be
    // chosen, so the slip says Lotus rather than "cakes at 2,000".
    const choices = variantsOf(p)
    if (choices.length > 0 && !variant) {
      setPicking(p)
      return
    }

    // The price is resolved once, here, and copied onto the line. Whatever
    // happens to a rate later, this sale keeps what the customer was charged.
    const price = priceOf(p, prices)
    const weighed = isWeighed(p)
    const lineName = lineNameFor(p, variant)

    setLines((cur) => {
      // Two variants of one product are two lines, not one — a customer buying
      // a Lotus and a VIP should see both on the slip. They still share an id,
      // so stock and the reports treat them as the same thing.
      const at = cur.findIndex((l) => l.productId === p.id && l.name === lineName)
      if (at === -1) {
        return [
          ...cur,
          {
            productId: p.id,
            code: p.code ?? '',
            name: lineName,
            price,
            // A weighed item starts at a quarter rather than one: a whole kilo
            // is a big default to have to correct, and the cashier is about to
            // type the real figure anyway.
            qty: weighed ? stepFor(p) : 1,
            soldByWeight: weighed || null,
            unit: weighed ? unitOf(p) : null,
          },
        ]
      }
      const next = [...cur]
      next[at] = { ...next[at], qty: roundQuantity(next[at].qty + (weighed ? stepFor(p) : 1), p) }
      return next
    })
    setText('')
    entry.current?.focus()
  }

  // By position, not by product id. Two variants of one merged product share an
  // id, so keying on it would change both lines at once — put two Lotus on the
  // bill and the VIP beside it would silently become two as well.
  function setQty(index, qty) {
    setLines((cur) =>
      qty <= 0
        ? cur.filter((_, i) => i !== index)
        : cur.map((l, i) => (i === index ? { ...l, qty } : l)),
    )
  }

  function onEntryKey(e) {
    if (e.key === 'Escape') {
      setText('')
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!typed) return
    // A typed code wins outright, even if some product name contains the digits.
    const pick = exactCodeMatch(catalogue, text) ?? results[0]
    if (pick) {
      addProduct(pick)
      return
    }
    // Enter on something that matches nothing means "I meant that". Nothing is
    // committed by opening the dialogue: a mistyped code lands there with a
    // number for a name and an empty price, which reads wrong at a glance and
    // still needs a price typed and a deliberate tap before it reaches a bill.
    setCustomFor(typed)
  }

  /**
   * Put a typed-in item on the bill.
   *
   * Always its own line, never merged into an existing one even for the same
   * name: two Cokes at different prices is a real thing that happens when the
   * second one is the big bottle, and silently folding them together would
   * make the slip disagree with what the customer was told.
   */
  function addCustom({ name, price, qty }) {
    rememberCustomPrice(name, price)
    setLines((cur) => [...cur, customLine({ name, price, qty })])
    setCustomFor(null)
    setText('')
    entry.current?.focus()
  }

  function takePayment(payment, cashGiven = null) {
    const sale = recordSale({
      branchId,
      cashier: { id: profile.id, name: profile.name },
      lines,
      payment,
      cashGiven,
    })
    setLines([])
    setPaying(false)
    setReceipt(sale)
    entry.current?.focus()
  }

  // Nothing can be rung up without a catalogue, and a till showing an empty one
  // is worse than a till showing nothing: the cashier types a code, is told it
  // does not exist, and starts doubting the system in front of a customer.
  // After the first load this is instant — Firestore answers from the device.
  if (products.loading) {
    return (
      <div className="page">
        <div className="card">
          <Loading>Reading the catalog…</Loading>
        </div>
      </div>
    )
  }

  // Without this, the whole interactive till — entry box, bill, Pay — could
  // render before the app has confirmed today is not already closed. A
  // cashier who starts a bill in that window would watch it vanish under
  // "Today is closed" mid-entry, with a customer standing there.
  if (todayClosing.loading) {
    return (
      <div className="page">
        <div className="card">
          <Loading>Checking today's status…</Loading>
        </div>
      </div>
    )
  }

  if (mustCloseYesterday) {
    return (
      <div className="page">
        <div className="card">
          <h2>Close yesterday first</h2>
          <p className="muted">
            Yesterday's takings were never counted, so today's drawer cannot be checked. It takes
            about a minute.
          </p>
          <Link className="btn primary big" to="/close">
            Close yesterday
          </Link>
        </div>
      </div>
    )
  }

  // The drawer has been counted and the day signed off. A later sale would land
  // on a day whose figures are already settled, so the till stops here.
  if (isClosed(todayClosing.data)) {
    return (
      <div className="page">
        <div className="card">
          <h2>Today is closed</h2>
          <p className="muted">
            {todayClosing.data.closedByName} counted the drawer and closed {formatDate(today)}, so
            the till is off. If that was a mistake, or there is still trade to ring up, reopen the
            day — the count is kept and can be done again.
          </p>
          <Link className="btn primary big" to="/close">
            Go to today's close
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="till">
      {/* Not a blocker. The till charges the last rate it knows and keeps
          trading; this is here so nobody finds out at closing time. */}
      {unpriced.length > 0 && (
        <div className="strip block no-print">
          Today's rate is not set for {unpricedList(unpriced)} — selling at yesterday's until the
          owner sets it.
        </div>
      )}
      <div className="till-entry">
        <input
          ref={entry}
          type="text"
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value)
          }}
          onKeyDown={onEntryKey}
          placeholder="Type item code or name, then press Enter"
          aria-label="Add an item by code or name"
        />
        {/* No "not found" message here any more. The results panel already
            says so the moment it is true, and repeating it under the box meant
            the same fact appeared twice, a keypress apart, in two wordings. */}
      </div>

      <div className="till-body">
        <div className="till-left">
          <Bill lines={lines} onQty={setQty} oddOf={oddOf} />
          <RecentSales sales={todaySales.data ?? []} onVoid={setVoidTarget} onReprint={setReceipt} />
        </div>

        <div className="till-right">
          {/* Side by side these two panels are obviously different things.
              Stacked on a phone they read as one long list, and a cashier
              cannot tell what is on the bill from what is merely on offer. */}
          <div className="till-results-label">
            {text.trim() ? `Matches for "${text.trim()}"` : 'All items — tap to add'}
          </div>
          <div className="till-results">
            {/* The way out belongs here, next to the dead end, and it has to
                appear while the cashier is still typing. It used to be hidden
                behind pressing Enter first — so someone holding a bottle of
                Coke saw "Nothing matches" and nothing else, which is exactly
                the moment they give up and take the money by hand. */}
            {noMatch && (
              <div style={{ padding: '4px 2px' }}>
                <Empty>Nothing matches "{typed}"</Empty>
                <button className="btn block" onClick={() => setCustomFor(typed)}>
                  Sell "{typed}" as a one-off
                </button>
                <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
                  For something the bakery does not make — a Coke out of the fridge, a packet of
                  crisps. You give it a price. Pressing Enter does the same thing.
                </p>
              </div>
            )}
            {results.length === 0 && !typed && <Empty>No products yet</Empty>}
            {results.map((p, i) => (
              <button
                key={p.id}
                className={`result ${text.trim() && i === 0 ? 'top' : ''}`}
                onClick={() => addProduct(p)}
              >
                <span className="result-code">{p.code}</span>
                <span className="result-name">{p.name}</span>
                <span className="result-price">
                  {formatMoney(priceOf(p, prices), { symbol: false })}
                  {isWeighed(p) && <span className="muted">/{unitOf(p)}</span>}
                </span>
              </button>
            ))}
          </div>

          <div className="till-total">
            <div className="amount">
              <span className="muted">Total</span>
              <b>{formatMoney(total)}</b>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              {/* Ghost, not a matching filled button: Clear and Pay sitting at
                  equal visual weight side by side invites a mis-tap that
                  silently throws away a whole bill with no undo. Confirmation
                  only kicks in once there is real work to lose — a single item
                  is cheap enough to just clear. */}
              <button
                className="btn ghost"
                disabled={!lines.length}
                onClick={() => {
                  if (lines.length > 1 && !window.confirm('Clear the whole bill?')) return
                  setLines([])
                }}
              >
                Clear
              </button>
              <button
                className="btn primary"
                disabled={!lines.length}
                // Asked once, and only when something on the bill is worth
                // asking about — a line past what the shop is thought to have,
                // or one big enough that it is more likely a slipped finger
                // than an order. On every ordinary bill this is a single tap,
                // exactly as before.
                onClick={() => (odd.length > 0 ? setChecking(true) : setPaying(true))}
              >
                Pay
              </button>
            </div>
          </div>
        </div>
      </div>

      {customFor !== null && (
        <CustomModal
          initialName={customFor}
          onAdd={addCustom}
          onClose={() => {
            setCustomFor(null)
            entry.current?.focus()
          }}
        />
      )}

      {picking && (
        <Modal title={picking.name} onClose={() => setPicking(null)}>
          <p className="muted small">
            These share a code and a price. Which one is it? The slip will say the name you pick.
          </p>
          <div className="grid2">
            {variantsOf(picking).map((variant) => (
              <button
                key={variant}
                className="btn big"
                onClick={() => {
                  const product = picking
                  setPicking(null)
                  addProduct(product, variant)
                }}
              >
                {variant}
              </button>
            ))}
          </div>
          <button
            className="btn ghost block"
            style={{ marginTop: 12 }}
            onClick={() => setPicking(null)}
          >
            Cancel
          </button>
        </Modal>
      )}

      {checking && (
        <Modal title="Does this look right?" onClose={() => setChecking(false)}>
          <p className="muted small">
            Nothing is wrong with taking this — the shelf figure is worked out rather than counted,
            so it is often behind. This is only here so a slipped finger does not become a day's
            takings.
          </p>
          <div className="bill" style={{ margin: '12px 0' }}>
            {odd.map((o) => (
              <div className="bill-row" key={o.productId}>
                <span></span>
                <span className="bill-name">{o.name}</span>
                <span className="small bad">{o.say}</span>
                <span className="bill-amount">
                  {formatMoney(
                    lineTotal(lines.find((l) => l.productId === o.productId) ?? {}),
                    { symbol: false },
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="total" style={{ marginBottom: 14 }}>
            <span className="muted">Bill total</span>
            <b>{formatMoney(total)}</b>
          </div>
          <button
            className="btn primary big block"
            onClick={() => {
              setChecking(false)
              setPaying(true)
            }}
          >
            Yes — take {formatMoney(total)}
          </button>
          <button
            className="btn ghost block"
            style={{ marginTop: 12 }}
            onClick={() => setChecking(false)}
          >
            Go back and fix it
          </button>
        </Modal>
      )}

      {paying && (
        <PaymentModal
          total={total}
          branch={branch}
          onClose={() => setPaying(false)}
          onTake={takePayment}
        />
      )}

      {receipt && (
        <Modal title="Receipt" onClose={() => setReceipt(null)}>
          <Receipt sale={receipt} branch={branch} />
          <div className="grid2 no-print" style={{ marginTop: 16 }}>
            <button className="btn" onClick={printReceipt}>Print</button>
            <button className="btn primary" onClick={() => setReceipt(null)}>Done</button>
          </div>
        </Modal>
      )}

      {voidTarget && (
        <VoidModal
          sale={voidTarget}
          refunded={refundedRefs.has(voidTarget.ref)}
          onClose={() => setVoidTarget(null)}
          onVoid={(reason) => {
            voidSale(voidTarget, reason, { id: profile.id })
            setVoidTarget(null)
          }}
          onRefund={() => {
            const refund = recordRefund({
              original: voidTarget,
              cashier: { id: profile.id, name: profile.name },
            })
            setVoidTarget(null)
            setReceipt(refund)
          }}
          onRepay={(method) => {
            changePaymentType(voidTarget, method, { id: profile.id })
            setVoidTarget(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Selling something that is not in the catalogue.
 *
 * The shop sells a few things it does not bake — a bottle of Coke out of the
 * fridge, a packet of crisps. Before this the cashier had no way to ring one,
 * so the money went into the drawer without a line against it and the till read
 * over at close, every time, with nothing to explain it.
 *
 * The price is the whole reason this is a dialogue rather than one tap: it is
 * the only figure in the app that nobody has checked, so it gets its own field,
 * its own keyboard, and the last price this tablet charged already filled in.
 */
function CustomModal({ initialName, onAdd, onClose }) {
  const [name, setName] = useState(initialName ?? '')
  const remembered = lastCustomPrice(initialName ?? '')
  const [price, setPrice] = useState(
    remembered != null ? formatMoney(remembered, { symbol: false }) : '',
  )
  const [qty, setQty] = useState(1)

  const minor = parseMoney(price)
  const ok = validCustom({ name, price: minor }) && qty > 0
  const total = ok ? minor * qty : 0

  return (
    <Modal title="Something not on the list" onClose={onClose}>
      <div className="field">
        <label>What is it? — this is what the receipt will say</label>
        <input
          type="text"
          value={name}
          autoFocus={!initialName}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coke"
        />
      </div>

      <div className="field">
        <label>Price for one</label>
        <input
          type="text"
          inputMode="numeric"
          value={price}
          autoFocus={Boolean(initialName)}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="e.g. 80"
        />
        {remembered != null && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Last time this tablet sold {initialName} it was{' '}
            {formatMoney(remembered)}. Change it if that is wrong.
          </p>
        )}
      </div>

      <div className="field">
        <label>How many</label>
        <Stepper value={qty} onChange={setQty} min={1} />
      </div>

      {ok && qty > 1 && (
        <p className="small" style={{ marginTop: 0 }}>
          {qty} × {formatMoney(minor)} = <b>{formatMoney(total)}</b>
        </p>
      )}

      <p className="muted small">
        It goes on the bill and in today's takings like anything else. It is not
        added to the catalogue and the kitchen is never asked to bake it — if you
        find yourself typing the same thing every day, ask the owner to add it
        properly.
      </p>

      <div className="grid2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!ok}
          onClick={() => onAdd({ name: name.trim(), price: minor, qty })}
        >
          Add to bill
        </button>
      </div>
    </Modal>
  )
}

function Bill({ lines, onQty, oddOf = () => null }) {
  return (
    <div className="bill">
      <div className="bill-row bill-head">
        <span>Code</span>
        <span>Item</span>
        <span>Qty</span>
        <span className="bill-amount">Amount</span>
      </div>
      {lines.length === 0 && <Empty>Type a code or name above to start the bill</Empty>}
      {lines.map((l, index) => (
        // Position is part of the key. Two one-offs typed with the same name
        // are deliberately separate lines — the second Coke may be the big
        // bottle at a different price — so id-and-name alone is not unique.
        <div className="bill-row" key={`${l.productId}::${l.name}::${index}`}>
          <span className="bill-code">{l.code || (l.custom ? '—' : '')}</span>
          <span>
            <span className="bill-name">{l.name}</span>
            <span className="muted small">
              {' · '}
              {formatMoney(l.price, { symbol: false })} {l.soldByWeight ? `per ${l.unit}` : 'each'}
              {l.custom && ' · one-off'}
            </span>
            {/* Said on the line itself, where the number that caused it is.
                It never stops the sale: what is on the shelf is worked out,
                not counted, so it is wrong most often first thing — and a till
                that argues with a customer holding real bread is worse than
                one whose figure is out. */}
            {oddOf(l.productId) && (
              <div className="small bad">{oddOf(l.productId).say}</div>
            )}
          </span>
          {/* The line carries its own kind, so the stepper takes a quarter kilo
              at a time for biscuits and one at a time for loaves without the
              bill having to look the product up again. */}
          <Stepper
            value={l.qty}
            onChange={(q) => onQty(index, q)}
            label={`quantity of ${l.name}`}
            step={stepFor(l)}
            // Not the stepper's own 9,999, which for a per-kilo line is nine
            // and a half tonnes of biscuits — one stuck `+` away from putting
            // Rs 13,998,600 into the day's takings.
            max={maxFor(l)}
            parse={(raw) => parseQuantity(raw, l)}
            format={(n) => (l.soldByWeight ? String(Number(Number(n ?? 0).toFixed(3))) : String(Math.round(n ?? 0)))}
          />
          <span className="bill-amount">
            {formatMoney(lineTotal(l), { symbol: false })}
          </span>
        </div>
      ))}
    </div>
  )
}

function RecentSales({ sales, onVoid, onReprint }) {
  if (!sales.length) return null
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3>Today's sales</h3>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Time</th>
              <th>Paid</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sales.slice(0, 10).map((s) => (
              <tr key={s.id} className={s.status === 'voided' ? 'sale-voided' : undefined}>
                <td className="mono small">{s.ref}</td>
                <td className="small">{formatTime(s.localAt?.toDate?.())}</td>
                <td className="small">
                  {s.status === 'voided'
                    ? 'voided'
                    : s.status === 'refund'
                      ? 'refund'
                      : labelOf(s.payment)}
                </td>
                <td className="num">
                  <Money minor={s.total} />
                </td>
                <td className="num">
                  <button className="btn ghost small" onClick={() => onReprint(s)}>Receipt</button>
                  {s.status === 'normal' && (
                    <button className="btn ghost small" onClick={() => onVoid(s)}>Fix</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PaymentModal({ total, branch, onClose, onTake }) {
  const [method, setMethod] = useState(null)
  const [givenText, setGivenText] = useState('')

  // The bill rounded up to each note the customer is likely to hand over.
  // These are shortcuts that fill the box below — never the only way to pay.
  const suggestions = useMemo(() => {
    const set = new Set([total])
    for (const step of QUICK_CASH_STEPS) {
      const note = toMinor(step)
      const roundedUp = Math.ceil(total / note) * note
      if (roundedUp > total) set.add(roundedUp)
    }
    return [...set].sort((a, b) => a - b).slice(0, 5)
  }, [total])

  if (!method) {
    // Cash stays first and stays the filled button — it is most of the day, and
    // the one the thumb should find without looking.
    return (
      <Modal title={`Take ${formatMoney(total)}`} onClose={onClose}>
        <div className="grid2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.id}
              className={`btn big ${m.id === 'cash' ? 'primary' : ''}`}
              onClick={() => setMethod(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onClose}>
          Cancel
        </button>
      </Modal>
    )
  }

  // Everything that is not cash. A card terminal needs nothing from this
  // screen; a wallet or a bank transfer needs the opposite of what the till
  // first asked for. The customer is not carrying a receipt to be typed in —
  // they are standing there wanting to know where to send the money.
  //
  // So the till turns round and shows them. Large enough to read at arm's
  // length across a counter, because that is the actual posture.
  if (!inDrawer(method)) {
    const account = needsAccount(method) ? accountFor(method, branch) : null

    return (
      <Modal title={`${labelOf(method)} · ${formatMoney(total)}`} onClose={onClose}>
        {needsAccount(method) ? (
          account ? (
            <>
              <p className="muted small">
                Show this to the customer. They send {formatMoney(total)} to:
              </p>
              <div className="pay-to">{account}</div>
            </>
          ) : (
            // Never a blank space beside an amount: a customer looking at an
            // empty screen asks the cashier, and the cashier recites a number
            // from memory.
            <p className="small" style={{ fontWeight: 600 }}>
              No {labelOf(method)} details have been set for this shop yet. Ask the owner to add
              them under Catalogue → Outlets before taking payment this way.
            </p>
          )
        ) : (
          <p className="muted small">Run the card, then confirm here.</p>
        )}

        <button
          className="btn primary big block"
          disabled={needsAccount(method) && !account}
          onClick={() => onTake(method)}
        >
          {labelOf(method)} received
        </button>
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setMethod(null)}>
          Back
        </button>
      </Modal>
    )
  }

  const given = parseMoney(givenText)
  const short = given !== null && given < total
  const done = given !== null && !short

  return (
    <Modal title={`${labelOf(method)} · ${formatMoney(total)}`} onClose={onClose}>
      <div className="field">
        <label>Amount received from customer</label>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={givenText}
          onChange={(e) => setGivenText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && done && onTake('cash', given)}
          placeholder="Type any amount"
        />
      </div>

      <div className="row wrap" style={{ marginBottom: 16 }}>
        {suggestions.map((amount) => (
          <button
            key={amount}
            className={`chip ${given === amount ? 'on' : ''}`}
            onClick={() => setGivenText(formatMoney(amount, { symbol: false }))}
          >
            {amount === total ? 'Exact' : formatMoney(amount, { symbol: false })}
          </button>
        ))}
      </div>

      <div className="total">
        <span className="muted">{short ? 'Still needed' : 'Change to give'}</span>
        <b className={short ? 'bad' : undefined}>
          {given === null ? '—' : formatMoney(short ? total - given : given - total)}
        </b>
      </div>

      <button className="btn primary big block" disabled={!done} onClick={() => onTake('cash', given)}>
        Done
      </button>
      <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setMethod(null)}>
        Back
      </button>
    </Modal>
  )
}

function VoidModal({ sale, onClose, onVoid, onRefund, onRepay, refunded = false }) {
  const [reason, setReason] = useState(null)
  const [newMethod, setNewMethod] = useState(null)

  return (
    <Modal title={`Fix ${sale.ref}`} onClose={onClose}>
      <p className="muted small">
        Nothing is ever deleted. Voiding keeps the sale on the record and takes it out of the
        totals; a refund adds a matching negative sale.
      </p>

      {/* The commonest mistake on the till, and until now the only one with no
          remedy: the customer paid by JazzCash and it was rung as cash. The
          money is right and the drawer is wrong, and at closing time somebody
          gets asked where the extra came from. */}
      <h3>Paid a different way?</h3>
      <p className="muted small">
        Was <b>{labelOf(sale.payment)}</b>. Changing it moves the money between the drawer and the
        statements — it does not change what the customer paid.
      </p>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        {PAYMENT_METHODS.filter((m) => m.id !== sale.payment).map((m) => (
          <button
            key={m.id}
            className={`chip ${newMethod === m.id ? 'on' : ''}`}
            onClick={() => setNewMethod(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button className="btn block" disabled={!newMethod} onClick={() => onRepay(newMethod)}>
        {newMethod ? `It was paid by ${labelOf(newMethod)}` : 'Pick how it was really paid'}
      </button>

      <hr style={{ margin: '20px 0', border: 0, borderTop: '1px solid var(--border)' }} />

      <h3>Void it — why?</h3>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        {VOID_REASONS.map((r) => (
          <button key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <button className="btn danger block" disabled={!reason} onClick={() => onVoid(reason)}>
        Void this sale
      </button>

      <hr style={{ margin: '20px 0', border: 0, borderTop: '1px solid var(--border)' }} />

      {/* A refund already given cannot be given again.
          `refundOf` has been written on every refund since the feature
          shipped and read by nothing, so the button stayed live: tapping Fix
          twice — which is exactly what somebody does when they are not sure
          the first one went through, since the write is never awaited — handed
          the money back a second time and left the day's takings short by the
          full amount, with two refund slips and no warning anywhere. */}
      {refunded ? (
        <p className="muted small" style={{ margin: 0 }}>
          This sale has already been refunded. The refund is on today's list as its own slip —
          nothing more to do here.
        </p>
      ) : (
        <button className="btn block" onClick={onRefund}>
          Refund instead ({formatMoney(sale.total)} back)
        </button>
      )}

      <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onClose}>
        Cancel
      </button>
    </Modal>
  )
}
