import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { setDeviceBranchId } from '../auth.jsx'
import { Loading } from '../components/ui.jsx'

/**
 * Run once per till. The outlet is a property of the machine, not of the
 * person, so nobody has to pick it again at the start of every shift.
 */
export default function Setup({ onDone }) {
  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const [branchId, setBranchId] = useState('')

  if (branches.loading) return <Loading>Reading outlets…</Loading>

  const list = branches.data ?? []

  function save() {
    if (!branchId) return
    setDeviceBranchId(branchId)
    onDone(branchId)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>Set up this till</h2>
        <p className="muted small">You only do this once.</p>

        <div className="field">
          <label>Which outlet is this till in?</label>
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
              No outlets are set up yet. Check this till's connection, or ask whoever installed
              the app to finish setting up the outlets.
            </p>
          )}
        </div>

        <button className="btn primary big block" disabled={!branchId} onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}
