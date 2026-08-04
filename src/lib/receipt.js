import { BUSINESS_NAME, RECEIPT_WIDTH } from '../config.js'
import { formatMoney } from './money.js'
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

export function itemLines(item, width = RECEIPT_WIDTH) {
  const amount = formatMoney(item.price * item.qty, { symbol: false })
  const label = `${item.qty} x ${item.name}`
  if (label.length + 1 + amount.length <= width) return [row(label, amount, width)]

  // Too long for one line: give the name its own line(s), then the sum below.
  return [
    ...wrap(item.name, width),
    row(`  ${item.qty} x ${formatMoney(item.price, { symbol: false })}`, amount, width),
  ]
}

export function receiptText(sale, branchName, width = RECEIPT_WIDTH) {
  const rule = '-'.repeat(width)
  const when = sale.localAt?.toDate?.() ?? null

  return [
    centre(BUSINESS_NAME.toUpperCase(), width),
    centre(branchName ?? sale.branchId, width),
    rule,
    sale.ref,
    `${formatDate(sale.businessDate)}${when ? `  ${formatTime(when)}` : ''}`,
    sale.status === 'refund' ? centre('** REFUND **', width) : '',
    rule,
    ...sale.items.flatMap((i) => itemLines(i, width)),
    rule,
    row('TOTAL', formatMoney(sale.total), width),
    sale.cashGiven != null ? row('Cash', formatMoney(sale.cashGiven, { symbol: false }), width) : '',
    sale.changeGiven != null
      ? row('Change', formatMoney(sale.changeGiven, { symbol: false }), width)
      : '',
    sale.cashGiven == null && sale.status !== 'refund' ? row('Paid by', sale.payment, width) : '',
    rule,
    `Served by ${sale.cashierName}`,
    '',
    centre('Thank you', width),
  ]
    .filter((line) => line !== '')
    .join('\n')
}
