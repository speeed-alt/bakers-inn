import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth'
import { doc, onSnapshot, waitForPendingWrites } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import { pinPassword, staffEmail } from './lib/pin.js'

const BRANCH_KEY = 'bakery.branchId'

const AuthContext = createContext(null)

/** The outlet this tablet belongs to, chosen once at setup. */
export function deviceBranchId() {
  return localStorage.getItem(BRANCH_KEY)
}

export function setDeviceBranchId(branchId) {
  localStorage.setItem(BRANCH_KEY, branchId)
}

/** Send the tablet back to setup — it was set to the wrong outlet, or moved. */
export function clearDeviceBranchId() {
  localStorage.removeItem(BRANCH_KEY)
}

// How long to wait for sign-in to settle before admitting something is wrong.
const STARTUP_PATIENCE_MS = 8000

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stalled, setStalled] = useState(false)
  const [claimsStale, setClaimsStale] = useState(false)

  // A spinner that never resolves is the worst thing a till can show: the
  // cashier has no idea whether to wait or fetch help. If the browser's stored
  // data is damaged, Firebase Auth simply never reports back — so after a
  // reasonable wait, say so and offer a way out.
  useEffect(() => {
    if (!loading) {
      setStalled(false)
      return
    }
    const timer = setTimeout(() => setStalled(true), STARTUP_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [loading])

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (!u) {
        setProfile(null)
        setLoading(false)
      }
    })
  }, [])

  // A listener, not a one-off read. onSnapshot answers immediately from the
  // local cache, so a tablet that restarts with no internet still knows who is
  // signed in — and it cannot leave the app stuck on a spinner the way a
  // getDoc that never resolves can. It also means a change the owner makes to
  // someone's role or outlet reaches their screen without a restart.
  useEffect(() => {
    if (!user) return
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setLoading(false)
      },
      () => {
        setProfile(null)
        setLoading(false)
      },
    )
  }, [user])

  // The screen takes its role from the staff record; the security rules take
  // theirs from the sign-in token. When those two disagree — a token minted
  // before the owner set someone up, or before their outlet changed — the app
  // looks perfectly normal while every write is refused. That is the worst kind
  // of fault, so it is checked for, fixed by refreshing the token, and said out
  // loud if the refresh does not settle it.
  useEffect(() => {
    if (!user || !profile) return
    let alive = true

    async function reconcile() {
      try {
        let claims = (await user.getIdTokenResult()).claims
        if (claims.role !== profile.role || claims.branchId !== profile.branchId) {
          claims = (await user.getIdTokenResult(true)).claims
        }
        if (!alive) return
        setClaimsStale(claims.role !== profile.role || claims.branchId !== profile.branchId)
      } catch {
        if (alive) setClaimsStale(false)
      }
    }

    reconcile()
    return () => {
      alive = false
    }
  }, [user, profile])

  const value = useMemo(() => {
    // `loginId` is the stable handle on the staff record. It is separate from
    // the document id because in-app created accounts get their uid from
    // Firebase, and the login credential has to be derivable before sign-in.
    async function signInWithPin(loginId, pin) {
      const password = await pinPassword(loginId, pin)
      await signInWithEmailAndPassword(auth, staffEmail(loginId), password)
    }
    return {
      user,
      profile,
      loading,
      stalled,
      claimsStale,
      role: profile?.role ?? null,
      // The owner works in whichever outlet he is looking at; everyone else is
      // pinned to the outlet on their own record.
      branchId: profile?.branchId ?? null,
      signInWithPin,

      /**
       * Sign out, but not on top of sales that have not reached the server.
       *
       * Every write on the selling path is deliberately never awaited — that
       * is what lets a shop keep trading through a dead line — so they sit in
       * Firestore's queue until the connection returns. That queue belongs to
       * the signed-in user. Signing out at the end of a shift with the wifi
       * down swapped it for the next cashier's empty one, and an afternoon of
       * real sales, and the close, and the order for tomorrow, were simply
       * gone: off the till, never on the server, with nothing said.
       *
       * So it waits, briefly, for the queue to drain, and if it cannot it
       * hands the caller the truth to act on rather than signing out anyway.
       * Ten seconds is long enough for a slow line and short enough that
       * nobody at a shift change decides the tablet has frozen.
       */
      signOut: async ({ force = false, timeoutMs = 10_000 } = {}) => {
        if (!force) {
          const drained = await Promise.race([
            waitForPendingWrites(db).then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
          ]).catch(() => false)
          if (!drained) return { ok: false, reason: 'unsent' }
        }
        await fbSignOut(auth)
        return { ok: true }
      },
    }
  }, [user, profile, loading, stalled, claimsStale])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
