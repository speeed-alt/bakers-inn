import { BUSINESS_NAME, RECEIPT_WIDTH } from '../config.js'
import { formatMoney, lineTotal } from './money.js'
import { formatQuantity } from './quantity.js'
import { amountInWords } from './words.js'
import { formatDate, formatTime } from './dates.js'

// A till roll is a fixed number of monospace characters wide, so every line is
// laid out by hand here. Nothing is ever truncated — a long product name wraps
// onto its own line rather than losing its ending, because "Birthday Cake (1 l"
// on a customer's receipt looks like a mistake.

export function centre(text, width = RECEIPT_WIDTH) {
  const pad = Math.max(0, Math.floor((width - text.length) / 2))
  return ' '.repeat(pad) + text
}

export function row(left, right, width = RECEIPT_WIDTH) {
  const gap = Math.max(1, width - left.length - right.length)
  return left + ' '.repeat(gap) + right
}

export function wrap(text, width = RECEIPT_WIDTH) {
  const lines = []
  let line = ''
  for (const word of String(text).trim().split(/\s+/)) {
    if (!word) continue
    if (!line) line = word
    else if (`${line} ${word}`.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
    // A single word longer than the roll still has to break somewhere.
    while (line.length > width) {
      lines.push(line.slice(0, width))
      line = line.slice(width)
    }
  }
  if (line) lines.push(line)
  return lines
}

// Four columns across the roll: what it was, what it cost, how many, and what
// that came to. Every figure a customer might want to check is on the slip, in
// the same place on every line, which is the whole reason for a column rather
// than a sentence.
//
// The widths add up to exactly the roll. Rate and quantity are narrow because
// they are small numbers; the name takes what is left, and wraps rather than
// truncating, because "Birthday Cake (1 l" on a receipt looks like a mistake.
const RATE_COL = 6
const QTY_COL = 5
const AMOUNT_COL = 7

export function nameWidth(width = RECEIPT_WIDTH) {
  return Math.max(8, width - RATE_COL - QTY_COL - AMOUNT_COL)
}

/** The three figure columns, right-aligned, as one string. */
function figures(rate, qty, amount) {
  return (
    String(rate).padStart(RATE_COL) +
    String(qty).padStart(QTY_COL) +
    String(amount).padStart(AMOUNT_COL)
  )
}

export function itemHeader(width = RECEIPT_WIDTH) {
  return 'Item'.padEnd(nameWidth(width)) + figures('Rate', 'Qty', 'Amount')
}

export function itemLines(item, width = RECEIPT_WIDTH) {
  const nameCol = nameWidth(width)
  const rate = formatMoney(item.price, { symbol: false })
  // The quantity column carries a bare number, as the printed bills here do.
  // "4.5 kg" is six characters in a five-wide column and pushed the whole line
  // off the roll; the unit rides on the name instead, where there is room for
  // it and where it reads better anyway — "Biscuits (kg)  1,400  4.5  6,300".
  const qty = item.soldByWeight
    ? String(Number(Number(item.qty ?? 0).toFixed(3)))
    : formatQuantity(item.qty, item)
  const amount = formatMoney(lineTotal(item), { symbol: false })
  const line = figures(rate, qty, amount)

  const name = item.soldByWeight
    ? `${item.name ?? ''} (${item.unit || 'kg'})`
    : String(item.name ?? '')
  if (name.length <= nameCol) return [name.padEnd(nameCol) + line]

  // Too long for its column: the name takes its own line(s) and the figures sit
  // underneath, still in their columns so the slip reads straight down.
  return [...wrap(name, width), ''.padEnd(nameCol) + line]
}

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

export function receiptText(sale, branchName, width = RECEIPT_WIDTH) {
  const rule = '-'.repeat(width)
  const thin = '='.repeat(width)
  const when = sale.localAt?.toDate?.() ?? null
  const items = sale.items ?? []

  return [
    centre(BUSINESS_NAME.toUpperCase(), width),
    centre(branchName ?? sale.branchId, width),
    '',
    // Ref and cashier on one line, date and time on the next — the same shape
    // as the boxed header on the printed bills people here already read.
    row(sale.ref, `Till ${sale.till ?? sale.device ?? ''}`.trim(), width),
    row(formatDate(sale.businessDate), when ? formatTime(when) : '', width),
    row(`Cashier: ${sale.cashierName ?? ''}`, '', width),
    sale.status === 'refund' ? centre('** REFUND **', width) : '',
    thin,
    itemHeader(width),
    rule,
    ...items.flatMap((i) => itemLines(i, width)),
    rule,
    row(`Items: ${itemCount(items)}`, '', width),
    row('TOTAL', formatMoney(sale.total), width),
    thin,
    sale.cashGiven != null ? row('Cash', formatMoney(sale.cashGiven, { symbol: false }), width) : '',
    sale.changeGiven != null
      ? row('Change', formatMoney(sale.changeGiven, { symbol: false }), width)
      : '',
    sale.cashGiven == null && sale.status !== 'refund' ? row('Paid by', sale.payment, width) : '',
    '',
    // The words go under the figures, where they can be checked against them.
    ...wrap(amountInWords(sale.total), width),
    '',
    centre('THANK YOU FOR YOUR VISIT', width),
  ]
    .filter((line) => line !== '')
    // Right-padding is how the columns line up, but it has no business hanging
    // off the end of a line with nothing after it — on a thermal roll that is
    // just a wider slip and a longer cut.
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
}
