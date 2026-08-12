import { BUSINESS_NAME } from '../config.js'
import { formatDate, formatTime, toISODate } from '../lib/dates.js'
import { formatMoney } from '../lib/money.js'
import { daysOfStock, isLow, stockValue } from '../lib/materials.js'

/**
 * The stock situation on one page.
 *
 * Two jobs at once: it tells the owner where he stands, and it is the sheet
 * someone carries round the store room to do the count — so every line has a
 * blank to write the real figure in. A printed sheet that cannot be written on
 * just gets copied onto the back of an envelope.
 */
export default function StockSheet({ materials = [], reports = [], branches = [], countMode = false }) {
  const now = new Date()
  const live = materials.filter((m) => m.active !== false)
  const sorted = [...live].sort((a, b) => a.name.localeCompare(b.name))
  const short = live.filter((m) => isLow(m))

  // What each outlet still had on the shelf at its last close.
  const shelves = branches
    .map((branch) => {
      const latest = reports
        .filter((r) => r.branchId === branch.id)
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0]
      const rows = (latest?.byProduct ?? []).filter((p) => p.leftover > 0)
      return { branch, businessDate: latest?.businessDate, rows }
    })
    .filter((s) => s.rows.length > 0)

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{BUSINESS_NAME} — stock {countMode ? 'count sheet' : 'situation'}</h2>
        <div className="when">
          {/* Local calendar date, not the UTC one: printing at 2am in Karachi
              would otherwise put yesterday's date on the sheet. */}
          {formatDate(toISODate(now))} at {formatTime(now)}
          {countMode && ' · write the counted figure in the last column'}
        </div>
      </div>

      {short.length > 0 && (
        <div className="sheet-block">
          <h3>Running low — {short.length} of {live.length}</h3>
          {/* Print takes its own width from the @media print rules; this
              scroll container is for the on-screen preview, in a fixed-width
              modal, before anyone has clicked Print. */}
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="num">On hand</th>
                  <th className="num">Days left</th>
                </tr>
              </thead>
              <tbody>
                {short.map((m) => {
                  const days = daysOfStock(m)
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td className="num">{m.onHand ?? 0} {m.unit}</td>
                      <td className="num">{days === null ? 'not known' : `${Math.floor(days)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3>Raw materials</h3>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">On hand</th>
              <th className="num">Used / day</th>
              <th className="num">Days left</th>
              <th className="num">Value</th>
              <th className="num">{countMode ? 'Counted' : 'Low'}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const days = daysOfStock(m)
              return (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="num">{m.onHand ?? 0} {m.unit}</td>
                  <td className="num">{m.usagePerDay ? `${m.usagePerDay} ${m.unit}` : '—'}</td>
                  <td className="num">{days === null ? '—' : Math.floor(days)}</td>
                  <td className="num">{formatMoney((m.onHand ?? 0) * (m.costPerUnit ?? 0))}</td>
                  <td className="num">
                    {countMode ? <span className="blank">&nbsp;</span> : isLow(m) ? 'yes' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="muted">
        Total value of raw materials: <b>{formatMoney(stockValue(live))}</b>
      </p>

      {shelves.length > 0 && (
        <div className="sheet-block">
          <h3>Left on the shelf at each outlet</h3>
          {shelves.map(({ branch, businessDate, rows }) => (
            <div key={branch.id} style={{ marginBottom: 10 }}>
              <b>{branch.name}</b>{' '}
              <span className="muted">at close on {formatDate(businessDate)}</span>
              <div className="scroll-x">
                <table>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.productId}>
                        <td>{r.productName}</td>
                        <td className="num">{r.leftover}</td>
                        <td className="num">{countMode ? <span className="blank">&nbsp;</span> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ marginTop: 18 }}>
        Counted by <span className="blank">&nbsp;</span>
        &nbsp;&nbsp;Date <span className="blank">&nbsp;</span>
      </p>
    </div>
  )
}
