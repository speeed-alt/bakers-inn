/**
 * A reopened day is an open day again.
 *
 * Kept here, free of Firestore, so the till, the close screen and the owner's
 * dashboard all answer "was this day shut?" the same way — and so it can be
 * tested. Three screens disagreeing about this would be a nasty bug: one would
 * refuse to sell while another insisted the day was open.
 */
export function isClosed(closing) {
  return Boolean(closing) && closing.status !== 'reopened'
}

export function reopenCount(closing) {
  return (closing?.events ?? []).filter((e) => e.action === 'reopened').length
}

/**
 * Is this outlet's till blocked until somebody counts yesterday?
 *
 * A day that took money and was never closed has to be counted before a new
 * day's cash can be counted against the drawer. A day that took nothing does
 * not: a shop shut for Eid owes nobody a drawer count, and the first morning a
 * bakery ever opens has no yesterday at all.
 *
 * Here rather than in the till, because the owner's dashboard says out loud
 * which outlets are blocked — and it was saying it from a different rule. On a
 * system that had never traded it announced all three tills blocked, which was
 * simply untrue, and it would have said the same every Monday after a Sunday
 * closure. A warning that is wrong on day one is a warning nobody reads on
 * day fifty.
 */
export function tillBlocked({ closing, salesYesterday = 0 }) {
  return !isClosed(closing) && salesYesterday > 0
}
