import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { app, db, USE_EMULATOR } from '../firebase.js'
import { pinPassword, staffEmail } from '../lib/pin.js'

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'staff'
}

/**
 * Add a staff member without disturbing the owner's own session.
 *
 * Creating an account signs you in as that account, so it is done on a throwaway
 * secondary Firebase app. The staff document is still written through the main
 * connection, as the owner, which is what the security rules require.
 */
export async function createStaff({ name, role, branchId, pin }) {
  const loginId = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`
  const password = await pinPassword(loginId, pin)

  const secondary = initializeApp(app.options, `staff-signup-${Date.now()}`)
  const secondaryAuth = getAuth(secondary)
  if (USE_EMULATOR) {
    connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  }

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, staffEmail(loginId), password)
    await setDoc(doc(db, 'users', cred.user.uid), {
      loginId,
      name,
      role,
      branchId,
      active: true,
    })
    await signOut(secondaryAuth)
    // Their role and outlet reach their sign-in token via the syncStaffClaims
    // function, which fires on the write above. They are able to sign in as
    // soon as that lands — a second or two.
    return cred.user.uid
  } finally {
    await deleteApp(secondary)
  }
}

/**
 * Change somebody's name, role or outlet.
 *
 * Role and outlet are the ones that matter, and they only started working
 * today: the security rules read the *token*, not this document, so before
 * `syncStaffClaims` was deployed this write would have changed what the screen
 * said about a person while leaving what they could actually do untouched —
 * the claims-vs-document split that CLAUDE.md warns about. The function now
 * fires on this write and the token catches up within a second or two.
 *
 * The name is not cosmetic either. It is copied onto every sale that person
 * rings, so a misspelling goes out on receipts until it is corrected — and
 * correcting it here does not rewrite the sales already made, which is
 * deliberate: history keeps the name it was recorded under.
 */
export function updateStaff(id, { name, role, branchId }) {
  return updateDoc(doc(db, 'users', id), { name, role, branchId })
}

/**
 * Give somebody a new PIN.
 *
 * Goes to a Cloud Function, because setting another account's password needs
 * the Admin SDK and there is no version of that which belongs in a browser.
 * The region has to be named: the functions live beside the database in Mumbai,
 * and the default would look for them in us-central1 and find nothing.
 */
export async function changeStaffPin(uid, pin) {
  const functions = getFunctions(app, 'asia-south1')
  if (USE_EMULATOR) connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  await httpsCallable(functions, 'setStaffPin')({ uid, pin })
}
