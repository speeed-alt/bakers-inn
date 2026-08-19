import { receiptModel } from '../lib/receipt.js'

/**
 * The printed slip.
 *
 * Modelled on the bills the shops here already hand out: a ruled box for who
 * and when, a ruled table of what was bought with the figures in columns, a
 * ruled box for the totals, and the amount written out in words underneath.
 * Customers already know how to read that shape, which is the entire argument
 * for it — a receipt is not a place to have ideas.
 *
 * Real table borders, not rows of dashes. Dashes were what this did before,
 * and on a thermal printer they come out as a dotted grey line that looks like
 * the printer is running out, rather than as a rule.
 */
export default function Receipt({ sale, branch, branchName }) {
  const r = receiptModel(sale, branch ?? branchName)

  const totals = [
    { label: 'Total', value: r.total, grand: true },
    ...(r.payment ? [{ label: 'Paid by', value: r.payment }] : []),
    ...(r.cashGiven ? [{ label: 'Cash', value: r.cashGiven }] : []),
    ...(r.changeGiven ? [{ label: 'Change', value: r.changeGiven }] : []),
  ]

  return (
    <div className="receipt">
      <div className="receipt-head">
        <div className="receipt-business">{r.business}</div>
        <div className="receipt-where">{r.outlet}</div>
        {r.address && <div className="receipt-where">{r.address}</div>}
        {r.phone && <div className="receipt-where">Ph: {r.phone}</div>}
      </div>

      {r.isRefund && <div className="receipt-stamp">** REFUND **</div>}
      {r.isVoided && <div className="receipt-stamp">** VOIDED — NOT A BILL **</div>}
      {r.isPractice && <div className="receipt-stamp">** PRACTICE — NOT A REAL SALE **</div>}

      <table className="receipt-meta">
        <tbody>
          <tr>
            <td>{r.date}</td>
            <td>{r.time}</td>
            <td>{r.till ? `Till ${r.till}` : ''}</td>
          </tr>
          <tr>
            <td colSpan={2}>{r.ref}</td>
            <td>{r.cashier}</td>
          </tr>
        </tbody>
      </table>

      <table className="receipt-items">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Rate</th>
            <th className="num">Qty</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row) => (
            <tr key={row.key}>
              {/* The name is the only thing allowed to wrap. Truncating it puts
                  "Birthday Cake (1 l" on a customer's receipt, which reads as a
                  fault in the till rather than as a long name. */}
              <td className="receipt-name">{row.name}</td>
              <td className="num">{row.rate}</td>
              <td className="num">{row.qty}</td>
              <td className="num">{row.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Built as a list first so the rowSpan below cannot drift out of step
          with the rows it is spanning — a card sale has no cash or change
          line, and a hand-counted rowSpan would leave the box open-sided. */}
      <table className="receipt-totals">
        <tbody>
          {totals.map((line, i) => (
            <tr key={line.label}>
              {i === 0 && (
                <td className="receipt-aside" rowSpan={totals.length}>
                  <div className="receipt-items-count">Items: {r.itemCount}</div>
                  <div className="receipt-thanks">THANK YOU FOR YOUR VISIT</div>
                </td>
              )}
              <th>{line.label}</th>
              <td className={`num ${line.grand ? 'receipt-grand' : ''}`}>{line.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-words">{r.words}</div>
    </div>
  )
}
