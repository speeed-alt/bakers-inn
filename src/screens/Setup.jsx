import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { setDeviceBranchId } from '../auth.jsx'
import { deviceLetter, setDeviceLetter } from '../lib/ids.js'
import { Loading } from '../components/ui.jsx'

/**
 * Run once per tablet. The outlet is a property of the device, not of the
 * person, so nobody has to pick it again at the start of every shift.
 */
export default function Setup({ onDone }) {
  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const [branchId, setBranchId] = useState('')
  const [letter, setLetter] = useState(deviceLetter())

  if (branches.loading) return <Loading>Reading outlets…</Loading>

  const list = branches.data ?? []

  function save() {
    if (!branchId) return
    setDeviceBranchId(branchId)
    setDeviceLetter(letter)
    onDone(branchId)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>Set up this tablet</h2>
        <p className="muted small">You only do this once.</p>

        <div className="field">
          <label>Which outlet is this tablet in?</label>
          <div className="row wrap">
            {list.map((b) => (
              <button
                key={b.id}
                className={`chip ${branchId === b.id ? 'on' : ''}`}
                onClick={() => setBranchId(b.id)}
              >
                {b.name}
              </button>
            ))}
          </div>
          {list.length === 0 && (
            <p className="muted small">
              No outlets are set up yet. Check this tablet's connection, or ask whoever installed
              the app to finish setting up the outlets.
            </p>
          )}
        </div>

        <div className="field">
          <label>Till letter (only matters if this outlet has two tills)</label>
          <div className="row wrap">
            {['A', 'B', 'C'].map((l) => (
              <button key={l} className={`chip ${letter === l ? 'on' : ''}`} onClick={() => setLetter(l)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <button className="btn primary big block" disabled={!branchId} onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}
