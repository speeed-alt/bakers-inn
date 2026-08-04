// Staff sign in by tapping their name and entering a 4-digit PIN. Underneath,
// each person is a real Firebase Auth account so every record carries a genuine
// uid and the security rules have something to check.
//
// This file is imported by both the browser app and the Node seed script, so it
// must stay dependency-free and derive the same password in both.

export const STAFF_EMAIL_DOMAIN = 'staff.bakery.local'

export function staffEmail(userId) {
  return `${userId}@${STAFF_EMAIL_DOMAIN}`
}

/**
 * Derive the Firebase Auth password from a user id and PIN. The PIN itself
 * never travels and is never stored; a per-user salt means two people sharing a
 * PIN do not share a password. This is deliberate obscurity, not real secrecy —
 * the actual protection is the Firestore rules plus the tablet being physically
 * behind the counter.
 */
export async function pinPassword(userId, pin) {
  const bytes = new TextEncoder().encode(`bakery-pin-v1:${userId}:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

export function isValidPin(pin) {
  return /^\d{4}$/.test(pin)
}
