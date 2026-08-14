import { formatDate } from '../lib/dates.js'
import { Money } from './ui.jsx'

/**
 * The owner's own daily sheet, filled in by itself.
 *
 * He keeps one ruled line a day on a scrap of paper: date, production,
 * distribution to each of the three shops, sale position at each, total sale,
 * total stale. It is the only record he reads end to end, and until now the
 * system held every number on it and could not show him the line.
 *
 * So this is a deliberate copy of his layout, not an improvement on it — his
 * column headings, his order, his units. The point is that he should recognise
 * it before he trusts it. Everything below this card is the detail that
 * produced these figures; this card is the thing he already knows.
 *
 * Transposed to one row per outlet rather than his three-across grid, because a
 * nine-column table on a phone is unreadable and he reads this on a phone. The
 * totals stay where he expects them: at the end.
 */
export default function DailySheet({ sheet, onPrint }) {
  const { production, outlets, distributed, totalSale, totalStale, unsold } = sheet
  const nothingYet = production.value === 0 && distributed === 0 && totalSale === 0

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Daily sheet</h2>
        <span className="muted small">{formatDate(sheet.businessDate)}</span>
      </div>
      <p className="muted small">
        The same line you write on the pad, worked out from what the tills and the kitchen have
        recorded today.
      </p>
      {onPrint && (
        <button className="btn" style={{ marginBottom: 12 }} onClick={onPrint}>
          Print the register
        </button>
      )}

      {nothingYet ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Nothing baked or sold yet today. This fills itself in as the kitchen records the bake and
          the shops start selling.
        </p>
      ) : (
        <>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th className="num">Distribution</th>
                  <th className="num">Sale position</th>
                  <th className="num">Stale</th>
                </tr>
              </thead>
              <tbody>
                {outlets.map((o) => (
                  <tr key={o.branchId}>
                    <td>
                      {o.branchName}
                      {o.isMain && <div className="muted small">kept from the bake</div>}
                    </td>
                    <td className="num"><Money minor={o.distributed} /></td>
                    <td className="num"><Money minor={o.sold} /></td>
                    <td className="num">
                      {o.stale === null ? (
                        <span className="muted">not shut yet</span>
                      ) : (
                        <Money minor={o.stale} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><b>Total</b></td>
                  <td className="num"><b><Money minor={distributed} /></b></td>
                  <td className="num"><b><Money minor={totalSale} /></b></td>
                  <td className="num">
                    {totalStale === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <b><Money minor={totalStale} /></b>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="stats" style={{ marginTop: 12 }}>
            <div className="stat">
              <div className="label">Production</div>
              <div className="value">
                {production.linesRecorded === 0 ? '—' : <Money minor={production.value} />}
              </div>
            </div>
            <div className="stat">
              <div className="label">Total sale</div>
              <div className="value sub"><Money minor={totalSale} /></div>
            </div>
            <div className="stat">
              <div className="label">Total stale</div>
              <div className="value sub">
                {totalStale === null ? '—' : <Money minor={totalStale} />}
              </div>
            </div>
          </div>

          <Notes sheet={sheet} unsold={unsold} />
        </>
      )}
    </div>
  )
}

/**
 * The lines his paper does not have room for.
 *
 * Kept underneath rather than as extra columns: the table above has to stay the
 * shape he recognises. But a total that does not add up is the fastest way to
 * lose somebody's trust in a screen, so where the difference went is said
 * plainly rather than left for him to notice.
 */
function Notes({ sheet, unsold }) {
  const { production, outlets, distributed, totalStale } = sheet
  const notes = []

  if (production.linesRecorded === 0 && production.planned > 0) {
    notes.push(
      `The kitchen has not recorded what came out of the oven yet. Today's list asks for ` +
        `${money(production.planned)} worth.`,
    )
  } else if (production.linesRecorded > 0 && production.linesRecorded < production.lines) {
    notes.push(
      `${production.linesRecorded} of ${production.lines} lines recorded so far, so production ` +
        `will still climb.`,
    )
  }

  // The gap on his own sheet: sent out 2,00,000, sold 1,80,000, stale 5,000 —
  // and 15,000 written nowhere. It is not missing money, it is bread on a
  // shelf, and the Stock screen can say which bread.
  if (unsold > 0 && distributed > 0) {
    const onShelf = totalStale === null ? unsold : unsold - totalStale
    notes.push(
      totalStale === null
        ? `${money(unsold)} of what went out has not sold yet — still on the shelves, or coming ` +
          `back to the hub. Nothing is counted as stale until a shop shuts.`
        : `${money(unsold)} did not sell. ${money(totalStale)} of that was thrown out; the other ` +
          `${money(onShelf)} is stock still on hand. Stock on hand has the item-by-item version.`,
    )
  }

  if (production.linesRecorded > 0 && distributed > production.value) {
    notes.push(
      `More has gone out than the kitchen has recorded baking. Usually a line of the bake not ` +
        `entered yet rather than stock appearing from nowhere, but worth a look.`,
    )
  }

  const notShut = outlets.filter((o) => !o.closed).length
  if (notShut > 0 && notShut < outlets.length) {
    notes.push(`${notShut} of ${outlets.length} shops have not closed yet, so the day is not final.`)
  }

  if (notes.length === 0) return null

  return (
    <div style={{ marginTop: 10 }}>
      {notes.map((line, i) => (
        <p className="muted small" key={i} style={{ marginBottom: i === notes.length - 1 ? 0 : 6 }}>
          {line}
        </p>
      ))}
    </div>
  )
}

// Plain text, for inside a sentence — <Money> renders an element.
function money(minor) {
  return `Rs ${Number(minor ?? 0).toLocaleString('en-PK')}`
}
