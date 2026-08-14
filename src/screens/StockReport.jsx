import { useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { businessDateOf, formatDate, previousDate } from '../lib/dates.js'
import { formatMoney } from '../lib/money.js'
import { byProduct, stockReport, stockTotals } from '../lib/stock.js'
import { productionDoc } from '../data/production.js'
import { printSheet } from '../lib/paper.js'
import { Empty, Loading, Modal, Money } from '../components/ui.jsx'
import { BUSINESS_NAME } from '../config.js'

/**
 * What is on the shelf right now, at all three outlets.
 *
 * Nothing counts stock continuously, so this is worked out the same way the
 * close wizard does — yesterday's leftovers, plus today's deliveries, less
 * what has been sold. That matters: the figure the owner reads at eleven is the
 * one the cashier will be asked to confirm at closing, so a disagreement is a
 * real discrepancy rather than two screens doing their own arithmetic.
 *
 * One row per product and a column per outlet, because the question this
 * answers is "who still has bread?" — which is a row, not three lists.
 */
export default function StockReport() {
  const today = businessDateOf()
  const yesterday = previousDate(today)

  const products = useSnapshot(() => collection(db, 'products'), [])
  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const sales = useSnapshot(
    () => query(collection(db, 'sales'), where('businessDate', '==', today)),
    [today],
  )
  const transfers = useSnapshot(
    () => query(collection(db, 'transfers'), where('businessDate', '==', today)),
    [today],
  )
  const production = useSnapshot(() => productionDoc(today), [today])
  const closings = useSnapshot(
    () => query(collection(db, 'closings'), where('businessDate', '==', yesterday)),
    [yesterday],
  )

  const loading =
    products.loading || branches.loading || sales.loading || transfers.loading || closings.loading

  const report = useMemo(
    () =>
      stockReport({
        products: products.data ?? [],
        branches: branches.data ?? [],
        transfers: transfers.data ?? [],
        production: production.data,
        sales: sales.data ?? [],
        closings: closings.data ?? [],
        businessDate: today,
        previousDate: yesterday,
      }),
    [products.data, branches.data, transfers.data, production.data, sales.data, closings.data, today, yesterday],
  )

  const rows = useMemo(() => byProduct(report), [report])
  const totals = useMemo(() => stockTotals(rows), [rows])
  const outlets = report.outlets
  const [sheet, setSheet] = useState(false)

  if (loading) {
    return (
      <div className="page">
        <div className="card"><Loading>Working out what is on the shelves…</Loading></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Stock on hand</h2>
          <span className="muted small">{formatDate(today)}</span>
        </div>
        <p className="muted small">
          Worked out, not counted: what yesterday left, plus what has been delivered and counted in
          today, less what has been sold. A delivery still in the van is not counted — that is why a
          shop can look empty just after a bake.
        </p>
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="label">Left on the shelves</div>
            <div className="value">{totals.left}</div>
          </div>
          <div className="stat">
            <div className="label">Worth</div>
            <div className="value sub">{formatMoney(totals.worth)}</div>
          </div>
          <div className="stat">
            <div className="label">Sold today</div>
            <div className="value sub">{totals.sold}</div>
          </div>
          <div className="stat">
            <div className="label">Taken</div>
            <div className="value sub">{formatMoney(totals.soldValue)}</div>
          </div>
          <div className="stat">
            <div className="label">Had to sell</div>
            <div className="value sub">{totals.available}</div>
          </div>
          <div className="stat">
            <div className="label">Sold through</div>
            <div className="value sub">
              {totals.available > 0
                ? `${Math.round((totals.sold / totals.available) * 100)}%`
                : '—'}
            </div>
          </div>
          {totals.unaccounted > 0 && (
            <div className="stat">
              <div className="label">Not accounted for</div>
              <div className="value sub bad">{totals.unaccounted}</div>
            </div>
          )}
        </div>
        {totals.unaccounted > 0 && (
          <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
            {totals.unaccounted} sold that never showed up as delivered — so{' '}
            {totals.available} less {totals.sold} does not come to {totals.left}. Usually stock
            reached a shop without the delivery being counted in. Worth asking about rather than
            worth hiding.
          </p>
        )}
        <div className="steps" style={{ marginTop: 12 }}>
          {outlets.map((o) => (
            <div className="step" key={o.branchId}>
              <span className="mark" />
              <span className="what">{o.branchName}</span>
              <span className="detail">
                {o.onShelf} left · {formatMoney(o.value)}
              </span>
            </div>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setSheet(true)}>
          Print stock report
        </button>
      </div>

      <div className="card no-print">
        <h3>By item</h3>
        {rows.length === 0 && (
          <Empty>
            Nothing on the shelves yet today. Once a delivery is counted in, or yesterday's
            leftovers are carried over, they appear here.
          </Empty>
        )}
        {rows.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Item</th>
                  <th className="num">Had</th>
                  <th className="num">Sold</th>
                  {outlets.map((o) => (
                    <th className="num" key={o.branchId}>{o.branchName}</th>
                  ))}
                  <th className="num">Left</th>
                  <th className="num">Worth</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.productId}>
                    <td className="mono small muted">{row.code}</td>
                    <td>
                      {row.productName}
                      {!row.keeps && row.left > 0 && (
                        <div className="muted small">stale tonight if unsold</div>
                      )}
                    </td>
                    <td className="num muted">{row.available}</td>
                    <td className="num">{row.sold || '–'}</td>
                    {outlets.map((o) => {
                      const at = row.perOutlet[o.branchId]
                      return (
                        <td className={`num ${at?.left ? '' : 'muted'}`} key={o.branchId}>
                          {at ? at.left : '–'}
                          {at && at.sold > 0 && (
                            <div className="muted small">sold {at.sold}</div>
                          )}
                        </td>
                      )
                    })}
                    <td className="num"><b>{row.left}</b></td>
                    <td className="num muted"><Money minor={row.worth} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td><b>All items</b></td>
                  <td className="num muted">{totals.available}</td>
                  <td className="num">{totals.sold}</td>
                  {outlets.map((o) => (
                    <td className="num muted" key={o.branchId}>{o.onShelf}</td>
                  ))}
                  <td className="num"><b>{totals.left}</b></td>
                  <td className="num"><b><Money minor={totals.worth} /></b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* The sheet has to be inside a Modal, which portals it to <body>.
          Printing collapses #root entirely — that is what stops the whole app
          appearing behind a receipt — so anything left in the app tree prints
          as a blank page. It did. */}
      {sheet && (
        // No title prop here: StockSheet supplies its own heading through
        // .sheet-head, and passing one too stacked two headings with nothing
        // between them.
        <Modal onClose={() => setSheet(false)} wide>
          <StockSheet report={report} rows={rows} />
          <div className="grid2 no-print" style={{ marginTop: 16 }}>
            <button className="btn" onClick={printSheet}>Print</button>
            <button className="btn primary" onClick={() => setSheet(false)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * The printed version.
 *
 * Blank columns down the right on purpose: this goes out on a clipboard so
 * somebody can walk the shelves and write what is really there beside what the
 * system thinks. That comparison is the whole reason to print it.
 */
function StockSheet({ report, rows }) {
  const outlets = report.outlets

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h1>Stock on hand</h1>
        <p>
          {BUSINESS_NAME} · {formatDate(report.businessDate)} · {report.onShelf} items,{' '}
          {formatMoney(report.value)}
        </p>
      </div>

      {/* Print ignores this — @media print already forces the sheet to full
          page width. It is the on-screen preview, in a fixed-width modal on
          the owner's phone, that needs somewhere for a wide table to go. */}
      <div className="scroll-x">
        <table>
          <thead>
            <tr className="sheet-head">
              <th>Code</th>
              <th>Item</th>
              <th className="num">Had</th>
              <th className="num">Sold</th>
              {outlets.map((o) => (
                <th className="num" key={o.branchId}>{o.branchName}</th>
              ))}
              <th className="num">Left</th>
              <th className="num">Counted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId}>
                <td>{row.code}</td>
                <td>{row.productName}</td>
                <td className="num">{row.available}</td>
                <td className="num">{row.sold}</td>
                {outlets.map((o) => (
                  <td className="num" key={o.branchId}>
                    {row.perOutlet[o.branchId]?.left ?? '–'}
                  </td>
                ))}
                <td className="num">{row.left}</td>
                <td className="num"><span className="blank" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sheet-block">
        <p>
          Counted by ______________________ at ____________ on{' '}
          {formatDate(report.businessDate)}
        </p>
      </div>
    </div>
  )
}
