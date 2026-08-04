import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
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
