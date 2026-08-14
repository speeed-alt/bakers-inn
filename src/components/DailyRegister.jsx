import { BUSINESS_NAME } from '../config.js'
import { formatDate } from '../lib/dates.js'
import { formatMoney } from '../lib/money.js'

/**
 * The pad, printed.
 *
 * A deliberate copy of the ruled sheet the owner keeps by hand — the same
 * columns in the same order, grouped under the same two headings:
 *
 *   Date | Production | Distribution (×3) | Sale position (×3) | Total sale | Total stale
 *
 * Wide, so it goes on a sheet rather than a till roll — `printSheet` in
 * lib/paper.js forces A4 whatever receipts are set to. One line per day, most
 * recent at the top, so the fortnight reads at a glance the way his page does.
 *
 * The point is not that the system can produce a table. It is that he can stop
 * writing this one out, and still have exactly it.
 */
export default function DailyRegister({ register, from, to }) {
  const { rows, branches, totals } = register
  const money = (n) => (n === null || n === undefined ? '—' : formatMoney(n, { symbol: false }))

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h1>Daily register</h1>
        <p>
          {BUSINESS_NAME} · {formatDate(to)} back to {formatDate(from)} · all figures in rupees
        </p>
      </div>

      <div className="scroll-x">
        <table className="register">
          <thead>
            {/* Two header rows, because Distribution and Sale position are each
                one heading over three shops — which is how the pad has it. */}
            <tr>
              <th rowSpan={2}>Date</th>
              <th rowSpan={2} className="num">Production</th>
              <th colSpan={branches.length} className="group">Distribution</th>
              <th colSpan={branches.length} className="group">Sale position</th>
              <th rowSpan={2} className="num">Total sale</th>
              <th rowSpan={2} className="num">Total stale</th>
            </tr>
            <tr>
              {branches.map((b) => (
                <th key={`d-${b.id}`} className="num">{b.name}</th>
              ))}
              {branches.map((b) => (
                <th key={`s-${b.id}`} className="num">{b.name}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <td>
                  {formatDate(row.date)}
                  {/* A day still being traded is not a day's figures. Saying so
                      stops the top line being read as a short day. */}
                  {row.live && <span className="muted small"> · so far</span>}
                  {!row.live && !row.closed && <span className="muted small"> · not all shut</span>}
                </td>
                <td className="num">{money(row.production)}</td>
                {branches.map((b) => (
                  <td key={`d-${b.id}`} className="num">{money(row.perOutlet[b.id]?.distributed)}</td>
                ))}
                {branches.map((b) => (
                  <td key={`s-${b.id}`} className="num">{money(row.perOutlet[b.id]?.sold)}</td>
                ))}
                <td className="num"><b>{money(row.totalSale)}</b></td>
                <td className="num">{money(row.totalStale)}</td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr>
              <td><b>{totals.days} days</b></td>
              <td className="num"><b>{money(totals.production)}</b></td>
              {branches.map((b) => (
                <td key={`d-${b.id}`} className="num">{money(totals.perOutlet[b.id]?.distributed)}</td>
              ))}
              {branches.map((b) => (
                <td key={`s-${b.id}`} className="num">{money(totals.perOutlet[b.id]?.sold)}</td>
              ))}
              <td className="num"><b>{money(totals.totalSale)}</b></td>
              <td className="num"><b>{money(totals.totalStale)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="muted">
          No day in this stretch has been closed yet, so there is nothing to print.
        </p>
      )}

      <div className="sheet-block">
        <p>
          A dash means nobody closed that shop that day, so there is no figure anyone stands
          behind. Distribution is what left the bakery at what it sells for; the hub's own share
          counts as its distribution. Stale is only ever counted at closing.
        </p>
        <p>Checked by ______________________ on ______________________</p>
      </div>
    </div>
  )
}
