import { BUSINESS_ADDRESS, BUSINESS_NAME, BUSINESS_PHONE } from '../config.js'
import { formatMoney, lineTotal } from './money.js'
import { formatQuantity } from './quantity.js'
import { amountInWords } from './words.js'
import { formatDate, formatTime } from './dates.js'

// The slip, as data. What it looks like is `components/Receipt.jsx`.
//
// This used to lay the whole receipt out by hand, padding every line with
// spaces to a fixed character count so that columns would line up in a
// monospace font. That is how you print to a till roll over a serial cable, and
// it is not what happens here: the slip is HTML, printed through the browser,
// on whatever printer the shop owns. Drawing columns out of spaces on top of a
// layout engine that does columns properly meant fighting it — the name column
// had to truncate or wrap by hand, a rupee sign cost a character of product
// name, and the rules between sections were rows of dashes that print as a
// dotted grey line rather than a rule.
//
// So the arithmetic and the wording live here, where they can be tested, and
// the ruling and alignment are left to the thing that is good at them.

/**
 * How many things were sold, for the "Items" line.
 *
 * The sum of the quantities rather than the number of lines: somebody who
 * bought thirty small breads and nine large ones bought thirty-nine things.
 *
 * A weighed line counts as one thing, not as its weight. Adding 4.5 kg of
 * biscuits to a count of loaves gives "67.5 items", which is not a number of
 * anything — the weight is already on its own line for whoever wants it.
 */
export function itemCount(items = []) {
  return items.reduce(
    (sum, i) => sum + (i.soldByWeight ? 1 : Math.round(Number(i.qty) || 0)),
    0,
  )
}

/**
 * One line of the bill, formatted for printing.
 *
 * The unit rides on the name — "Biscuits (kg)" — rather than in the quantity
 * column. A quantity column reads as a column of bare numbers on every printed
 * bill people here already handle, and "4.5 kg" in it breaks that scan.
 */
export function itemRow(item, index = 0) {
  const weighed = Boolean(item.soldByWeight)
  return {
    // Position, not product id: two variants of one merged product share an id,
    // and two one-offs can share a name and a price.
    key: `${item.productId ?? 'x'}:${index}`,
    name: weighed ? `${item.name ?? ''} (${item.unit || 'kg'})` : String(item.name ?? ''),
    rate: formatMoney(item.price, { symbol: false }),
    qty: weighed
      ? String(Number(Number(item.qty ?? 0).toFixed(3)))
      : formatQuantity(item.qty, item),
    amount: formatMoney(lineTotal(item), { symbol: false }),
  }
}

/**
 * Everything the printed slip needs, in the order it is printed.
 *
 * `total` keeps its currency symbol and the line figures do not, which is not
 * an oversight: repeating "Rs" down a column of amounts is noise, and the one
 * figure the customer checks against the money in their hand is the one worth
 * spelling out.
 */
export function receiptModel(sale, branchName) {
  const when = sale.localAt?.toDate?.() ?? null
  const items = sale.items ?? []

  return {
    business: BUSINESS_NAME,
    address: BUSINESS_ADDRESS,
    phone: BUSINESS_PHONE,
    outlet: branchName ?? sale.branchId,

    ref: sale.ref ?? '',
    till: String(sale.till ?? sale.device ?? '').trim(),
    date: formatDate(sale.businessDate),
    time: when ? formatTime(when) : '',
    cashier: sale.cashierName ?? '',

    // A refund slip that reads like a bill gets presented for payment twice.
    isRefund: sale.status === 'refund',

    rows: items.map(itemRow),
    itemCount: itemCount(items),

    total: formatMoney(sale.total),
    cashGiven: sale.cashGiven != null ? formatMoney(sale.cashGiven) : null,
    changeGiven: sale.changeGiven != null ? formatMoney(sale.changeGiven) : null,
    // Only worth printing when there is no cash line to imply it.
    payment: sale.cashGiven == null && sale.status !== 'refund' ? sale.payment : null,

    // Under the figures, where it can be checked against them. A figure can be
    // altered with a pen; a line of words cannot.
    words: amountInWords(sale.total),
  }
}
