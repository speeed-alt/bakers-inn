import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf, formatDate, formatTime, previousDate } from '../lib/dates.js'
import { basketTotal, formatMoney, parseMoney, toMinor } from '../lib/money.js'
import { exactCodeMatch, findProducts } from '../lib/search.js'
import { recordRefund, recordSale, salesForDay, voidSale } from '../data/sales.js'
import { closingDoc, isClosed } from '../data/closings.js'
import { Empty, Modal, Money, Stepper } from '../components/ui.jsx'
import { QUICK_CASH_STEPS, VOID_REASONS } from '../config.js'
import Receipt from '../components/Receipt.jsx'
import { printReceipt } from '../lib/paper.js'

export default function Sell({ branchId, branchName }) {
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

  const [text, setText] = useState('')
  const [lines, setLines] = useState([])
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [notFound, setNotFound] = useState('')
  const entry = useRef(null)

  const catalogue = products.data ?? []
  // An empty box lists the whole catalogue, so the same panel is both the
  // search result and the price list a new cashier reads codes off.
  const results = useMemo(() => findProducts(catalogue, text), [catalogue, text])
  const total = basketTotal(lines)

  // Yesterday had takings but was never closed: that has to be fixed before a
  // new day's cash can be counted against the drawer.
  const mustCloseYesterday =
    !yesterdayClosing.loading &&
    !isClosed(yesterdayClosing.data) &&
    (yesterdaySales.data?.length ?? 0) > 0

  function addProduct(p) {
    setLines((cur) => {
      const at = cur.findIndex((l) => l.productId === p.id)
      if (at === -1) {
        return [...cur, { productId: p.id, code: p.code ?? '', name: p.name, price: p.price, qty: 1 }]
      }
      const next = [...cur]
      next[at] = { ...next[at], qty: next[at].qty + 1 }
      return next
    })
    setText('')
    setNotFound('')
    entry.current?.focus()
  }

  function setQty(productId, qty) {
    setLines((cur) =>
      qty <= 0
        ? cur.filter((l) => l.productId !== productId)
        : cur.map((l) => (l.productId === productId ? { ...l, qty } : l)),
    )
  }

  function onEntryKey(e) {
    if (e.key === 'Escape') {
      setText('')
      setNotFound('')
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!text.trim()) return
    // A typed code wins outright, even if some product name contains the digits.
    const pick = exactCodeMatch(catalogue, text) ?? results[0]
    if (pick) addProduct(pick)
    else setNotFound(`No item matches "${text.trim()}"`)
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
      <div className="till-entry">
        <input
          ref={entry}
          type="text"
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setNotFound('')
          }}
          onKeyDown={onEntryKey}
          placeholder="Type item code or name, then press Enter"
          aria-label="Add an item by code or name"
        />
        {notFound && <p className="bad small" style={{ margin: '8px 2px 0' }}>{notFound}</p>}
      </div>

      <div className="till-body">
        <div className="till-left">
          <Bill lines={lines} onQty={setQty} />
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
            {results.length === 0 && (
              <Empty>{text.trim() ? 'Nothing matches' : 'No products yet'}</Empty>
            )}
            {results.map((p, i) => (
              <button
                key={p.id}
                className={`result ${text.trim() && i === 0 ? 'top' : ''}`}
                onClick={() => addProduct(p)}
              >
                <span className="result-code">{p.code}</span>
                <span className="result-name">{p.name}</span>
                <span className="result-price">{formatMoney(p.price, { symbol: false })}</span>
              </button>
            ))}
          </div>

          <div className="till-total">
            <div className="amount">
              <span className="muted">Total</span>
              <b>{formatMoney(total)}</b>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <button className="btn" disabled={!lines.length} onClick={() => setLines([])}>
                Clear
              </button>
              <button
                className="btn primary"
                disabled={!lines.length}
                onClick={() => setPaying(true)}
              >
                Pay
              </button>
            </div>
          </div>
        </div>
      </div>

      {paying && (
        <PaymentModal total={total} onClose={() => setPaying(false)} onTake={takePayment} />
      )}

      {receipt && (
        <Modal title="Receipt" onClose={() => setReceipt(null)}>
          <Receipt sale={receipt} branchName={branchName} />
          <div className="grid2 no-print" style={{ marginTop: 16 }}>
            <button className="btn" onClick={printReceipt}>Print</button>
            <button className="btn primary" onClick={() => setReceipt(null)}>Done</button>
          </div>
        </Modal>
      )}

      {voidTarget && (
        <VoidModal
          sale={voidTarget}
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
        />
      )}
    </div>
  )
}

function Bill({ lines, onQty }) {
  return (
    <div className="bill">
      <div className="bill-row bill-head">
        <span>Code</span>
        <span>Item</span>
        <span>Qty</span>
        <span className="bill-amount">Amount</span>
      </div>
      {lines.length === 0 && <Empty>Type a code or name above to start the bill</Empty>}
      {lines.map((l) => (
        <div className="bill-row" key={l.productId}>
          <span className="bill-code">{l.code}</span>
          <span>
            <span className="bill-name">{l.name}</span>
            <span className="muted small"> · {formatMoney(l.price, { symbol: false })} each</span>
          </span>
          <Stepper value={l.qty} onChange={(q) => onQty(l.productId, q)} />
          <span className="bill-amount">{formatMoney(l.price * l.qty, { symbol: false })}</span>
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
              <tr key={s.id} style={s.status === 'voided' ? { opacity: 0.5 } : undefined}>
                <td className="mono small">{s.ref}</td>
                <td className="small">{formatTime(s.localAt?.toDate?.())}</td>
                <td className="small">
                  {s.status === 'voided' ? 'voided' : s.status === 'refund' ? 'refund' : s.payment}
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

function PaymentModal({ total, onClose, onTake }) {
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
    return (
      <Modal title={`Take ${formatMoney(total)}`} onClose={onClose}>
        <div className="grid2">
          <button className="btn big primary" onClick={() => setMethod('cash')}>Cash</button>
          <button className="btn big" onClick={() => setMethod('card')}>Card</button>
        </div>
      </Modal>
    )
  }

  if (method === 'card') {
    return (
      <Modal title={`Card · ${formatMoney(total)}`} onClose={onClose}>
        <p className="muted small">Run the card, then confirm here.</p>
        <button className="btn primary big block" onClick={() => onTake('card')}>
          Card payment taken
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
    <Modal title={`Cash · ${formatMoney(total)}`} onClose={onClose}>
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

function VoidModal({ sale, onClose, onVoid, onRefund }) {
  const [reason, setReason] = useState(null)
  return (
    <Modal title={`Fix ${sale.ref}`} onClose={onClose}>
      <p className="muted small">
        Nothing is ever deleted. Voiding keeps the sale on the record and takes it out of the
        totals; a refund adds a matching negative sale.
      </p>

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

      <button className="btn block" onClick={onRefund}>
        Refund instead ({formatMoney(sale.total)} back)
      </button>
    </Modal>
  )
}
