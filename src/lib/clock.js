import { CLOCK_TOLERANCE_MINUTES } from '../config.js'

// The tablet's own clock decides which day a sale belongs to and what time it
// was rung up. That is the right trade — see the note in data/sales.js, business
// dates have to be stamped with no internet — but it means a tablet whose clock
// is wrong files a whole day's takings under the wrong date, quietly, and the
// daily report then reconciles against a day that never happened. Nobody would
// spot it until the numbers stopped adding up weeks later.
//
// So when there is a connection, ask the server what time it thinks it is and
// compare. Nothing is corrected automatically: silently rewriting timestamps
// would be a worse surprise than the drift. It just says so, plainly.

/**
 * How far ahead the device is, in milliseconds. Negative means it is behind.
 * Returns null when the server did not say, which is not an error — offline is
 * the normal state of a till.
 *
 * @param serverDate  the value of an HTTP `Date` header
 * @param deviceNow   the device's own idea of now
 */
export function clockDrift(serverDate, deviceNow = new Date()) {
  if (!serverDate) return null
  const server = new Date(serverDate)
  if (Number.isNaN(server.getTime())) return null
  return deviceNow.getTime() - server.getTime()
}

/** Whether a drift is big enough to be worth interrupting anyone about. */
export function driftMatters(ms) {
  return ms !== null && Math.abs(ms) >= CLOCK_TOLERANCE_MINUTES * 60_000
}

/**
 * Say the drift the way a person would. An HTTP `Date` header only carries
 * whole seconds, so anything finer would be false precision.
 */
export function describeDrift(ms) {
  if (ms === null) return ''
  const direction = ms > 0 ? 'fast' : 'slow'
  const minutes = Math.round(Math.abs(ms) / 60_000)

  if (minutes < 60) return `${minutes} minutes ${direction}`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ${direction}`

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ${direction}`
}
