import { useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { formatDate, weekdayName } from '../lib/dates.js'
import { byCategoryThenName } from '../lib/search.js'
import { demandDoc, lastSameWeekdayDemand, saveDemand } from '../data/demands.js'
import { branchReportsQuery } from '../data/reports.js'
import { sameWeekdayReports, suggestOrder } from '../lib/suggest.js'
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
  const reports = useSnapshot(() => branchReportsQuery(branchId), [branchId])

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

  // What the shop's own closing reports say this weekday usually needs.
  const suggestion = useMemo(
    () => suggestOrder(sameWeekdayReports(reports.data ?? [], businessDate)),
    [reports.data, businessDate],
  )

  // Seed the steppers once, from the best source available:
  //   1. an order this outlet already saved for the day — never overwrite that
  //   2. what the closing reports suggest
  //   3. the last same weekday's order, which is all there was before
  //   4. blank, in a shop's first week
  useEffect(() => {
    if (qty !== null || existing.loading || reports.loading || history === undefined) return

    if (existing.data?.items?.length) {
      setQty(Object.fromEntries(existing.data.items.map((i) => [i.productId, i.qty])))
    } else if (suggestion.days > 0) {
      setQty(Object.fromEntries(Object.entries(suggestion.items).map(([id, s]) => [id, s.qty])))
    } else {
      setQty(Object.fromEntries((history?.items ?? []).map((i) => [i.productId, i.qty])))
    }
  }, [qty, existing.loading, existing.data, reports.loading, suggestion, history])

  if (products.loading || existing.loading || reports.loading || history === undefined || qty === null) {
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
        {suggestion.days > 0
          ? `Worked out from the last ${suggestion.days} ${weekdayName(businessDate)}s — what actually sold, plus a little more on anything that ran out. Change what you need and send.`
          : history
            ? `Filled in from last ${weekdayName(history.businessDate)}. Change what you need and send.`
            : 'No history for this outlet yet, so this one starts blank. Once it has closed a few days it fills itself in.'}
      </p>

      <OrderTable
        catalog={catalog}
        qty={qty}
        lastWeek={lastWeek}
        suggestion={suggestion}
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

function OrderTable({ catalog, qty, lastWeek = {}, suggestion = null, onQty, readOnly = false }) {
  const rows = readOnly ? catalog.filter((p) => qty[p.id] > 0) : catalog
  if (rows.length === 0) return <Empty>No products in the catalog yet.</Empty>

  const suggested = suggestion?.days > 0 ? suggestion.items : null
  const rightHeading = readOnly ? 'Qty' : suggested ? 'Suggested' : 'Last week'

  return (
    <div className="bill">
      <div className="bill-row bill-head">
        <span>Code</span>
        <span>Item</span>
        <span>{readOnly ? '' : 'Order'}</span>
        <span className="bill-amount">{rightHeading}</span>
      </div>
      {rows.map((p) => {
        const basis = suggested?.[p.id]
        return (
          <div className="bill-row" key={p.id}>
            <span className="bill-code">{p.code}</span>
            <span>
              <span className="bill-name">{p.name}</span>
              <span className="muted small"> · {p.category}</span>
              {/* Said out loud because it is the one case where the suggestion
                  is knowingly above what the records show was sold. */}
              {basis?.ranOut > 0 && (
                <span className="muted small">
                  {' '}· ran out {basis.ranOut} of {suggestion.days}
                </span>
              )}
            </span>
            {readOnly ? <span /> : <Stepper value={qty[p.id] ?? 0} onChange={(v) => onQty(p.id, v)} />}
            <span className="bill-amount">
              {readOnly ? qty[p.id] : suggested ? (basis?.qty ?? '–') : (lastWeek[p.id] ?? '–')}
            </span>
          </div>
        )
      })}
    </div>
  )
}
