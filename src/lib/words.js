import { CURRENCY_DECIMALS, MINOR_UNITS } from '../config.js'

// The amount spelled out, the way a bill is written in Pakistan:
//
//   RUPEES SIX THOUSAND NINE HUNDRED EIGHTY-SIX ONLY
//
// It is not decoration. A figure can be altered with a pen; a line of words
// cannot, which is why every printed bill here carries one and why customers
// look for it. It also settles arguments about a smudged digit.
//
// Counting is in lakh and crore rather than million and billion, because that
// is what the number means to the person reading it.

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
  'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
]

const TENS = [
  '', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY',
]

/** 0–99. Hyphenated above twenty — EIGHTY-SIX, as the printed bills have it. */
function underHundred(n) {
  if (n < 20) return ONES[n]
  const tens = TENS[Math.floor(n / 10)]
  const ones = ONES[n % 10]
  return ones ? `${tens}-${ones}` : tens
}

/** 0–999. */
function underThousand(n) {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts = []
  if (hundreds) parts.push(`${ONES[hundreds]} HUNDRED`)
  if (rest) parts.push(underHundred(rest))
  return parts.join(' ')
}

/**
 * A whole number in words, in the South Asian scale.
 *
 * Grouped 2-2-3 above a thousand — 12,34,567 is TWELVE LAKH THIRTY-FOUR
 * THOUSAND FIVE HUNDRED SIXTY-SEVEN.
 */
export function numberInWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0))
  if (n === 0) return 'ZERO'

  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest = n % 1000

  const parts = []
  if (crore) parts.push(`${numberInWords(crore)} CRORE`)
  if (lakh) parts.push(`${underThousand(lakh)} LAKH`)
  if (thousand) parts.push(`${underThousand(thousand)} THOUSAND`)
  if (rest) parts.push(underThousand(rest))
  return parts.join(' ')
}

/**
 * The line that goes under the total.
 *
 * Negative amounts are refunds, and say so — a refund slip that reads like a
 * bill is exactly the sort of thing that gets paid twice.
 */
export function amountInWords(minor) {
  const value = Math.round(Number(minor) || 0)
  const negative = value < 0
  const abs = Math.abs(value)

  const whole = Math.floor(abs / MINOR_UNITS)
  const fraction = abs % MINOR_UNITS

  let text = `RUPEES ${numberInWords(whole)}`
  if (CURRENCY_DECIMALS > 0 && fraction > 0) {
    text += ` AND ${numberInWords(fraction)} PAISA`
  }
  text += ' ONLY'
  return negative ? `${text} REFUNDED` : text
}
