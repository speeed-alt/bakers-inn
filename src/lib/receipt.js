import { BUSINESS_ADDRESS, BUSINESS_NAME, BUSINESS_PHONE } from '../config.js'
import { formatMoney, lineTotal } from './money.js'
import { formatQuantity, weightOf } from './quantity.js'
import { amountInWords } from './words.js'
import { formatDate, formatTime } from './dates.js'
import { inDrawer, labelOf } from './payments.js'

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
    // The weight rides on the name — "Biscuits (1 kg)" — rather than in the
    // quantity column, which stays a column of bare whole numbers on every
    // printed bill people here already handle. The quantity is the portion
    // count, so it and the rate multiply out to the amount in plain sight: a
    // customer can check 4 × 350 = 1,400 without knowing what a portion is.
    name: weighed
      ? `${item.name ?? ''} (${weightOf(item.qty, item)})`
      : String(item.name ?? ''),
    rate: formatMoney(item.price, { symbol: false }),
    qty: formatQuantity(item.qty),
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
export function receiptModel(sale, branch) {
  const when = sale.localAt?.toDate?.() ?? null
  const items = sale.items ?? []

  // The whole outlet, or just its name for the callers that only have that.
  //
  // Three shops in three different places cannot share one address, which the
  // first version of this did — and it printed the shop's name immediately
  // above an address for a different shop. A customer coming back about a
  // wrong order needs the address of the counter they actually stood at.
  const outlet = typeof branch === 'string' ? { name: branch } : (branch ?? {})

  return {
    business: BUSINESS_NAME,
    address: outlet.address || BUSINESS_ADDRESS,
    phone: outlet.phone || BUSINESS_PHONE,
    outlet: outlet.name ?? sale.branchId,

    ref: sale.ref ?? '',
    till: String(sale.till ?? sale.device ?? '').trim(),
    date: formatDate(sale.businessDate),
    time: when ? formatTime(when) : '',
    cashier: sale.cashierName ?? '',

    // A refund slip that reads like a bill gets presented for payment twice.
    isRefund: sale.status === 'refund',

    // And the two other slips that must never pass for a bill.
    //
    // A voided sale keeps its Receipt button — nothing is ever deleted here —
    // so tapping it printed a clean, ordinary bill for a sale that had been
    // cancelled and taken out of every total. A customer handed that has proof
    // of a purchase the books say never happened.
    isVoided: sale.status === 'voided',
    // A practice tablet is deliberately a real till wired to the real
    // catalogue, so a trainee can be shown the actual job — which means a real
    // customer walking up mid-lesson gets a real-looking slip for a sale that
    // exists nowhere. The record is stamped `demo`; so is the paper now.
    isPractice: sale.demo === true,

    rows: items.map(itemRow),
    itemCount: itemCount(items),

    total: formatMoney(sale.total),
    cashGiven: sale.cashGiven != null ? formatMoney(sale.cashGiven) : null,
    changeGiven: sale.changeGiven != null ? formatMoney(sale.changeGiven) : null,
    // Only worth printing when there is no cash line to imply it.
    // Named, not the stored id: a slip reading "jazzcash" looks like a fault.
    // Shown whenever there is no cash line to imply it — which is now every
    // method except cash.
    payment: !inDrawer(sale.payment) && sale.status !== 'refund' ? labelOf(sale.payment) : null,

    // Under the figures, where it can be checked against them. A figure can be
    // altered with a pen; a line of words cannot.
    words: amountInWords(sale.total),
  }
}
