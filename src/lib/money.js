import { CURRENCY_DECIMALS, CURRENCY_SYMBOL, MINOR_UNITS } from '../config.js'

// Every amount is an integer in the currency's smallest unit — whole rupees
// here. Never store a fractional currency value; all arithmetic stays exact.

const groups = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 })

export function formatMoney(minor, { symbol = true } = {}) {
  const n = Math.round(minor ?? 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)

  let text = groups.format(Math.floor(abs / MINOR_UNITS))
  if (CURRENCY_DECIMALS > 0) {
    text += `.${String(abs % MINOR_UNITS).padStart(CURRENCY_DECIMALS, '0')}`
  }

  return symbol ? `${sign}${CURRENCY_SYMBOL} ${text}` : `${sign}${text}`
}

/** Parse a typed amount into minor units. Returns null if unusable. */
export function parseMoney(text) {
  if (text === null || text === undefined) return null
  const cleaned = String(text).replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * MINOR_UNITS)
}

export function toMinor(major) {
  return Math.round(major * MINOR_UNITS)
}

/**
 * What one line comes to.
 *
 * Rounded, and that rounding is load-bearing. Counted items give whole rupees
 * on their own — three loaves at 220 is 660 however you multiply it — but a
 * weighed line does not: 4.55 kg of biscuits at Rs 1,399 is 6,365.45, and a
 * fractional rupee has nowhere to live in a system whose amounts are integers.
 * Left unrounded it would reach a document, and every total built on it would
 * be a hair out for as long as that sale existed.
 *
 * Rounding each line rather than the basket is deliberate: the line total is
 * what the customer sees on the slip, and the sum has to be the sum of the
 * numbers printed in front of them.
 */
export function lineTotal(line) {
  return Math.round((line.price ?? 0) * (line.qty ?? 0))
}

export function basketTotal(lines) {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0)
}
