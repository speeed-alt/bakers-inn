import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore'

// With no real project configured we run entirely against the local emulators,
// so `npm run dev` works on a fresh clone with no cloud account.
export const USE_EMULATOR =
  import.meta.env.VITE_USE_EMULATOR === 'true' || !import.meta.env.VITE_FB_API_KEY

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY ?? 'demo-api-key',
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN ?? 'localhost',
  // A 'demo-' project id keeps the Firebase CLI fully offline, so a fresh clone
  // runs against the emulators with no cloud account and no login.
  projectId: import.meta.env.VITE_FB_PROJECT_ID ?? 'demo-bakery',
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FB_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FB_APP_ID ?? '',
}

export const app = initializeApp(firebaseConfig)

// Persistent local cache is what makes selling work with no internet: reads are
// served from disk and writes queue locally until the connection returns.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const auth = getAuth(app)
// Keep the session across reloads so a tablet that restarts offline stays signed in.
setPersistence(auth, browserLocalPersistence)

if (USE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

// Offline selling is the one behaviour that must never regress, so make it easy
// to exercise by hand from the browser console:
//   __bakery.goOffline()   ring some sales   __bakery.goOnline()
// Vite strips this block from production builds.
if (import.meta.env.DEV) {
  window.__bakery = {
    db,
    goOffline: () => disableNetwork(db),
    goOnline: () => enableNetwork(db),
  }
}
