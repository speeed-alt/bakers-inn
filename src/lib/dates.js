import { DAY_ROLLOVER_HOUR } from '../config.js'

// A business date is a plain local 'YYYY-MM-DD' string, stamped by the device at
// the moment a record is created. That is what makes an offline sale rung at
// 19:50 and synced at 08:00 the next morning land on the correct day.

export function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function businessDateOf(when = new Date()) {
  const d = new Date(when)
  if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1)
  return toISODate(d)
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function nextDate(iso) {
  return addDays(iso, 1)
}

export function weekdayName(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })
}

export function previousDate(iso) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return toISODate(d)
}

/** '2026-07-29' -> '20260729' — used inside document ids so they sort by date. */
export function compactDate(iso) {
  return iso.replaceAll('-', '')
}

/** '2026-07-29' -> '0729' — the short form staff see on printed refs. */
export function shortDate(iso) {
  return compactDate(iso).slice(4)
}

export function formatDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatTime(date) {
  if (!date) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
