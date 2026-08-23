import { useState } from 'react'
import { isPractising, startPractice } from '../lib/practice.js'

/**
 * The owner's switch for turning a till into a training till.
 *
 * Deliberately at the bottom of his dashboard. It is used on the day somebody
 * new starts and then not again for months, and a control that wipes the
 * meaning of every figure above it should not sit where a thumb lands.
 *
 * Only starting practice is here. *Ending* it lives on the banner, where anyone
 * holding the tablet can reach it — a cashier who has finished training must be
 * able to hand it back live without going to find the owner.
 */
export default function PracticeCard() {
  const [asking, setAsking] = useState(false)
  const practising = isPractising()

  if (practising) {
    return (
      <div className="card">
        <h3>Practice</h3>
        <p className="muted small" style={{ marginBottom: 0 }}>
          This tablet is in practice mode. Use <b>End practice</b> at the top of the screen to put
          it back to normal — or leave it, and it goes back on its own tomorrow morning.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h3>Practice</h3>
      <p className="muted small">
        Turns this one tablet into a training tablet. Whoever uses it sees the real products at the
        real prices, and can ring sales, close the day and send orders — but none of it is real,
        none of it reaches your figures, and none of it can be mistaken for a real day later.
      </p>

      {!asking ? (
        <button className="btn" onClick={() => setAsking(true)}>Start practice on this till</button>
      ) : (
        <>
          <p className="small" style={{ fontWeight: 600 }}>
            Turn this till into a practice till?
          </p>
          <ul className="muted small" style={{ marginTop: 0, paddingLeft: 18 }}>
            <li>Only this till. The other shops keep trading normally.</li>
            <li>Nothing rung up here will appear in your takings, reports or profit.</li>
            <li>
              It ends by itself tomorrow morning, so a till left in practice cannot quietly
              swallow a real day's trading.
            </li>
            <li>Raw materials and the money screens stay switched off while practising.</li>
          </ul>
          <div className="grid2">
            <button className="btn" onClick={() => setAsking(false)}>Cancel</button>
            <button className="btn primary" onClick={() => startPractice()}>
              Start practice
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Shown instead of a screen that practice deliberately does not cover.
 *
 * Raw materials and the money screens write to records that have no practice
 * copy — a stock movement changes the real on-hand figure for real flour, and a
 * bill is a real bill. Rather than half-supporting them and leaving a trainee's
 * count sitting in the owner's stock figures, they are simply closed while
 * practising. Saying so is better than a screen that looks like it worked.
 */
export function NotInPractice({ what }) {
  return (
    <div className="page">
      <div className="card">
        <h2>{what} is not part of practice</h2>
        <p className="muted">
          These figures are always the real ones, so nothing here can be practised on safely — a
          count entered for training would become the bakery's actual stock figure.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Use <b>End practice</b> at the top of the screen to come back to it.
        </p>
      </div>
    </div>
  )
}
