import { useState } from 'react'
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
    } catch {
      setError('That PIN did not match. Try again.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  function press(key) {
    if (busy) return
    if (key === 'clear') return setPin('')
    if (key === 'back') return setPin((p) => p.slice(0, -1))
    if (pin.length >= 4) return
    const next = pin + key
    setPin(next)
    if (next.length === 4 && isValidPin(next)) submit(next)
  }

  if (!picked) {
    return (
      <div className="page narrow">
        <div className="card">
          <h2>{branchName ?? branchId}</h2>
          <p className="muted small">
            Tap your name to start. This tablet belongs to {branchName ?? branchId}, so only the
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
              This tablet is not at {branchName ?? branchId}
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
