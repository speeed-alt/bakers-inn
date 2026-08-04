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
