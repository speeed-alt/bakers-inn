import { useEffect, useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { isValidPin } from '../lib/pin.js'
import { Loading } from '../components/ui.jsx'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

export default function Login({ branchId, branchName, onChangeOutlet }) {
  const { signInWithPin } = useAuth()
  const users = useSnapshot(() => collection(db, 'users'), [])
  const [picked, setPicked] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The PIN can be typed.
  //
  // The pad is still there and still the thing to tap, because it is the only
  // sensible control on a touch screen. But this runs on a computer with a
  // keyboard in front of it, and reaching for a mouse to click four digits is
  // slower than typing them — several times a day, at the start of every shift.
  //
  // A `keydown` listener on the window rather than a real input: a focused text
  // field would summon an on-screen keyboard the moment this is opened on a
  // touch device, on top of the pad that is already there, and a PIN box that
  // can be read by a screen reader or filled by a password manager is not what
  // this is. The dots are the display; the keys just feed the same `press` the
  // buttons do, so there is one path and one place to get it wrong.
  useEffect(() => {
    if (!picked) return undefined

    function onKey(event) {
      // Leave the browser's own shortcuts alone, and ignore a held-down key —
      // leaning on `1` should not sign anybody in as 1111.
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return

      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault()
        press(event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        press('back')
      } else if (event.key === 'Escape' || event.key === 'Delete') {
        event.preventDefault()
        press('clear')
      }
      // Enter needs no case of its own: four digits sign in on their own, and a
      // pad button with focus handles its own Enter.
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked, busy])

  // Signing in is the effect of the PIN being complete, not of the keystroke
  // that completed it — a submit fired from inside a state updater would run
  // twice under React's strict mode and sign in on a doubled attempt.
  useEffect(() => {
    if (busy) return
    if (pin.length === 4 && isValidPin(pin)) submit(pin)
  }, [pin, busy])

  if (users.loading) return <Loading>Reading staff…</Loading>

  // The owner can sign in on any tablet; everyone else appears at their own outlet.
  const staff = (users.data ?? [])
    .filter((u) => u.active !== false)
    .filter((u) => u.branchId === branchId || u.role === 'owner')
    .sort((a, b) => a.name.localeCompare(b.name))

  async function submit(nextPin) {
    setBusy(true)
    setError('')
    try {
      await signInWithPin(picked.loginId ?? picked.id, nextPin)
    } catch (error) {
      // Signing in is the one thing in this app that genuinely needs the
      // internet — everything after it works from the tablet's own copy. So a
      // dead line and a wrong PIN both arrived here and both said "That PIN
      // did not match", which sends a cashier who typed it perfectly into
      // trying again, and again, and eventually fetching somebody with keys.
      // The two need different sentences because they need different actions.
      const offline =
        error?.code === 'auth/network-request-failed' ||
        error?.code === 'auth/timeout' ||
        (typeof navigator !== 'undefined' && navigator.onLine === false)
      const locked =
        error?.code === 'auth/too-many-requests' || error?.code === 'auth/user-disabled'

      setError(
        offline
          ? 'This till cannot reach the internet, so it cannot sign anyone new in. Your PIN is probably fine — get the connection back, or keep using a till that is already signed in.'
          : locked
            ? 'This account cannot sign in at the moment. Tell the owner — it may have been switched off, or blocked after too many wrong tries.'
            : 'That PIN did not match. Try again.',
      )
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Every digit goes through here, whether it was tapped or typed.
   *
   * Functional updates throughout, and no reading of `pin`: this used to build
   * the next PIN from the value in its own closure, which is fine when each
   * press is a click with a render in between and wrong the moment somebody
   * types. Two keystrokes inside one render both saw the same starting value
   * and the second overwrote the first, so a PIN typed at speed silently came
   * out short and was refused as wrong.
   */
  function press(key) {
    if (busy) return
    if (key === 'clear') return setPin('')
    if (key === 'back') return setPin((p) => p.slice(0, -1))
    setPin((p) => (p.length >= 4 ? p : p + key))
  }


  if (!picked) {
    return (
      <div className="page narrow">
        <div className="card">
          <h2>{branchName ?? branchId}</h2>
          <p className="muted small">
            Choose your name to start. This till belongs to {branchName ?? branchId}, so only the
            people who work here are listed — plus the owner, who can sign in anywhere.
          </p>
          <div className="grid2">
            {staff.map((u) => (
              <button key={u.id} className="btn big" onClick={() => setPicked(u)}>
                {u.name}
              </button>
            ))}
          </div>
          {staff.length === 0 && (
            <p className="muted small">
              Nobody is registered at this outlet yet. The owner adds people in Catalog &amp;
              People.
            </p>
          )}
          {onChangeOutlet && (
            <button
              className="btn ghost block"
              style={{ marginTop: 14 }}
              onClick={onChangeOutlet}
            >
              This till is not at {branchName ?? branchId}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page narrow">
      <div className="card">
        <h2>Hello {picked.name}</h2>
        <p className="muted small">Enter your 4-digit PIN.</p>

        <div className="pindots">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={pin.length > i ? 'on' : ''} />
          ))}
        </div>

        {error && <p className="bad small center">{error}</p>}

        <div className="pinpad">
          {KEYS.map((k) => (
            <button key={k} onClick={() => press(k)} disabled={busy}>
              {k === 'clear' ? '✕' : k === 'back' ? '⌫' : k}
            </button>
          ))}
        </div>

        <button
          className="btn ghost block"
          style={{ marginTop: 12 }}
          onClick={() => {
            setPicked(null)
            setPin('')
            setError('')
          }}
        >
          Not you? Go back
        </button>
      </div>
    </div>
  )
}
