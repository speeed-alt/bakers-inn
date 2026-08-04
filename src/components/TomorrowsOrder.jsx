import { useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { formatDate, weekdayName } from '../lib/dates.js'
import { byCategoryThenName } from '../lib/search.js'
import { demandDoc, lastSameWeekdayDemand, saveDemand } from '../data/demands.js'
import { Empty, Stepper } from '../components/ui.jsx'

/**
 * Tomorrow's order.
 *
 * Lives in its own component because it appears twice — on the Stock screen and
 * again as a step of the daily close — and both must be the same thing, not two
 * screens that drift apart.
 */
export default function TomorrowsOrder({ branchId, businessDate, bare = false, onSubmitted }) {
  const { profile } = useAuth()

  const products = useSnapshot(
    () => query(collection(db, 'products'), where('active', '==', true)),
    [],
  )
  const existing = useSnapshot(() => demandDoc(branchId, businessDate), [branchId, businessDate])

  const [qty, setQty] = useState(null)
  const [history, setHistory] = useState(undefined)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    lastSameWeekdayDemand(branchId, businessDate).then((d) => alive && setHistory(d))
    return () => {
      alive = false
    }
  }, [branchId, businessDate])

  const catalog = useMemo(() => [...(products.data ?? [])].sort(byCategoryThenName), [products.data])

  // Seed the steppers once: this outlet's saved order if it has one, otherwise
  // last same weekday's, otherwise blank.
  useEffect(() => {
    if (qty !== null || existing.loading || history === undefined) return
    const source = existing.data?.items?.length ? existing.data.items : history?.items
    setQty(Object.fromEntries((source ?? []).map((i) => [i.productId, i.qty])))
  }, [qty, existing.loading, existing.data, history])

  if (products.loading || existing.loading || history === undefined || qty === null) {
    return <p className="muted">Loading…</p>
  }

  const order = existing.data
  const locked = order?.status === 'locked'
  const lastWeek = Object.fromEntries((history?.items ?? []).map((i) => [i.productId, i.qty]))
  const total = Object.values(qty).reduce((a, b) => a + (b || 0), 0)

  function send() {
    saveDemand({
      branchId,
      businessDate,
      items: catalog
        .filter((p) => qty[p.id] > 0)
        .map((p) => ({ productId: p.id, code: p.code, name: p.name, qty: qty[p.id] })),
      user: profile,
      submit: true,
    })
    setSaved(true)
    onSubmitted?.()
  }

  const body = locked ? (
    <>
      <p className="muted small">
        This order is with the kitchen now, so it can no longer be changed here. Ring the main
        outlet if something has to change today.
      </p>
      <OrderTable catalog={catalog} qty={qty} readOnly />
    </>
  ) : (
    <>
      <p className="muted small">
        {history
          ? `Filled in from last ${weekdayName(history.businessDate)}. Change what you need and send.`
          : 'No history for this outlet yet, so this one starts blank. From next week it fills itself in.'}
      </p>

      <OrderTable
        catalog={catalog}
        qty={qty}
        lastWeek={lastWeek}
        onQty={(id, v) => {
          setQty((c) => ({ ...c, [id]: v }))
          setSaved(false)
        }}
      />

      <div className="total" style={{ marginTop: 14 }}>
        <span className="muted">Items ordered</span>
        <b>{total}</b>
      </div>

      <button className="btn primary big block" disabled={total === 0} onClick={send}>
        {saved ? 'Sent ✓' : order?.status === 'submitted' ? 'Send again' : 'Send order'}
      </button>
      <p className="muted small center" style={{ marginBottom: 0 }}>
        You can change it any time until the kitchen list is made at 5am.
      </p>
    </>
  )

  if (bare) return body

  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Order for {formatDate(businessDate)}</h2>
        <span className="muted small">
          {locked ? 'with the kitchen' : order?.status === 'submitted' ? 'sent' : 'not sent yet'}
        </span>
      </div>
      {body}
    </div>
  )
}

function OrderTable({ catalog, qty, lastWeek = {}, onQty, readOnly = false }) {
  const rows = readOnly ? catalog.filter((p) => qty[p.id] > 0) : catalog
  if (rows.length === 0) return <Empty>No products in the catalog yet.</Empty>

  return (
    <div className="bill">
      <div className="bill-row bill-head">
        <span>Code</span>
        <span>Item</span>
        <span>{readOnly ? '' : 'Order'}</span>
        <span className="bill-amount">{readOnly ? 'Qty' : 'Last week'}</span>
      </div>
      {rows.map((p) => (
        <div className="bill-row" key={p.id}>
          <span className="bill-code">{p.code}</span>
          <span>
            <span className="bill-name">{p.name}</span>
            <span className="muted small"> · {p.category}</span>
          </span>
          {readOnly ? <span /> : <Stepper value={qty[p.id] ?? 0} onChange={(v) => onQty(p.id, v)} />}
          <span className="bill-amount">{readOnly ? qty[p.id] : (lastWeek[p.id] ?? '–')}</span>
        </div>
      ))}
    </div>
  )
}
