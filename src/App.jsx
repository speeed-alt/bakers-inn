import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { doc } from 'firebase/firestore'
import { db } from './firebase.js'
import { clearDeviceBranchId, deviceBranchId, useAuth } from './auth.jsx'
import { useClockDrift, useOnline, useSnapshot } from './lib/hooks.js'
import { describeDrift, driftMatters } from './lib/clock.js'
import { useTheme } from './lib/theme.js'
import { installUpdate, useUpdateWaiting } from './lib/updates.js'
import { Loading } from './components/ui.jsx'
import { deviceLetter } from './lib/ids.js'
import { goLive, isPractising } from './lib/practice.js'
import { NotInPractice } from './components/PracticeCard.jsx'
import Setup from './screens/Setup.jsx'
import Login from './screens/Login.jsx'
import Sell from './screens/Sell.jsx'
import CloseDay from './screens/CloseDay.jsx'
import Catalog from './screens/Catalog.jsx'
import Dashboard from './screens/Dashboard.jsx'
import Bake from './screens/Bake.jsx'
import Stock from './screens/Stock.jsx'
import Dispatch from './screens/Dispatch.jsx'
import Materials from './screens/Materials.jsx'
import StockReport from './screens/StockReport.jsx'
import MoneyScreen from './screens/Money.jsx'

/**
 * Light or dark, one tap.
 *
 * The icon shows the side you are going to, not the side you are on, because
 * "press the moon to get dark" needs no explaining to anybody. The label says it
 * in words for screen readers and for the long-press tooltip.
 */
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const goingDark = theme !== 'dark'
  const label = goingDark ? 'Switch to dark' : 'Switch to light'

  return (
    <button className="btn ghost small no-print" onClick={toggle} title={label} aria-label={label}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        {goingDark ? (
          <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" strokeLinejoin="round" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.4v2.1M12 19.5v2.1M2.4 12h2.1M19.5 12h2.1M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M18.8 5.2l-1.5 1.5M6.7 17.3l-1.5 1.5" />
          </>
        )}
      </svg>
    </button>
  )
}

const NAV = {
  owner: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/stock-report', label: 'Stock' },
    { to: '/money', label: 'Money' },
    { to: '/materials', label: 'Materials' },
    { to: '/catalog', label: 'Catalog' },
  ],
  cashier: [
    { to: '/sell', label: 'Sell' },
    { to: '/stock', label: 'Stock' },
    { to: '/close', label: 'Close day' },
  ],
  specialist: [
    { to: '/bake', label: 'Bake' },
    { to: '/dispatch', label: 'Dispatch' },
  ],
}

const HOME = { owner: '/dashboard', cashier: '/sell', specialist: '/bake' }

// Who may open what. The security rules are the real gate — this only stops a
// screen loading that would show nothing but denied reads, which reads as a
// broken app rather than as "not for you".
const ALLOWED = {
  '/sell': ['owner', 'cashier'],
  '/stock': ['owner', 'cashier'],
  '/close': ['owner', 'cashier'],
  '/bake': ['owner', 'specialist'],
  '/dispatch': ['owner', 'specialist'],
  '/dashboard': ['owner'],
  '/catalog': ['owner'],
  '/materials': ['owner'],
  '/stock-report': ['owner'],
  '/money': ['owner'],
}

function Only({ path, role, children }) {
  if (ALLOWED[path]?.includes(role)) return children
  return <Navigate to={HOME[role] ?? '/sell'} replace />
}

/**
 * Wipe everything this browser has stored for the app and start over.
 *
 * The recovery for a tablet whose stored data has been damaged — the one fault
 * that stops the app before it can tell you anything.
 *
 * It is not free, and the copy here used to say it was. Firestore's queue of
 * writes that have not reached the server yet lives in IndexedDB, which is
 * exactly what this deletes. On a tablet that has been off the wifi all
 * afternoon that queue is the afternoon's takings, and they are gone with no
 * way back. The screen this is offered from appears after an eight-second
 * timeout, which a slow morning can produce on its own — so it asks first, and
 * it says what it is really doing.
 */
async function resetThisTablet() {
  const sure = window.confirm(
    'Reset this tablet?\n\n' +
      'Any sale rung up while this tablet was off the internet, and not yet sent, ' +
      'will be lost — there is no way to get it back.\n\n' +
      'If the tablet has been offline today, try "Try again" first, or wait until ' +
      'it is back on the wifi and the sales have gone through.',
  )
  if (!sure) return

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.()
    for (const reg of registrations ?? []) await reg.unregister()
    const databases = (await indexedDB.databases?.()) ?? []
    await Promise.all(
      databases.map(
        (d) =>
          new Promise((done) => {
            const request = indexedDB.deleteDatabase(d.name)
            request.onsuccess = request.onerror = request.onblocked = done
          }),
      ),
    )
    localStorage.clear()
  } finally {
    window.location.replace('/')
  }
}

function StartupTrouble() {
  return (
    <div className="page">
      <div className="card">
        <h2>The app cannot finish starting</h2>
        <p className="muted">
          It is waiting on this browser's stored data, which usually means that data has been
          damaged. Every sale that has reached the server is safe there.
        </p>
        {/* The bold, primary-filled button is the one the eye is drawn to tap
            first — so it belongs on the safe, likely-to-work action, not on
            the one that wipes every database on the tablet and forces a full
            re-setup. A cashier facing this mid-queue should be pulled toward
            "Try again", not toward "Reset". */}
        <div className="grid2">
          <button className="btn primary" onClick={() => window.location.reload()}>Try again</button>
          <button className="btn" onClick={resetThisTablet}>Reset this tablet</button>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Try again first. Resetting clears the saved sign-in and this tablet's outlet, so it has
          to be set up again — about a minute — and it throws away any sale made while this tablet
          was off the internet that has not been sent yet.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { user, profile, loading, stalled, claimsStale, signOut } = useAuth()
  const [branchId, setBranchId] = useState(deviceBranchId())
  const online = useOnline()
  const drift = useClockDrift(online)
  const updateWaiting = useUpdateWaiting()

  const branch = useSnapshot(() => (branchId ? doc(db, 'branches', branchId) : null), [branchId])

  if (loading) return stalled ? <StartupTrouble /> : <Loading />
  if (!branchId) return <Setup onDone={setBranchId} />
  if (!user) {
    return (
      <Login
        branchId={branchId}
        branchName={branch.data?.name}
        onChangeOutlet={() => {
          clearDeviceBranchId()
          setBranchId(null)
        }}
      />
    )
  }

  if (!profile) {
    return (
      <div className="page">
        <div className="card">
          <h2>This account has no staff record</h2>
          <p className="muted">Ask the owner to add you in Catalog &amp; People, then sign in again.</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    )
  }

  // Everyone except the owner is pinned to the outlet on their own record, so a
  // sale can never be stamped with the wrong branch by signing in elsewhere.
  const wrongOutlet = profile.role !== 'owner' && profile.branchId !== branchId
  if (wrongOutlet) {
    return (
      <div className="page">
        <div className="card">
          <h2>Wrong outlet</h2>
          <p className="muted">
            This tablet belongs to <b>{branch.data?.name ?? branchId}</b>, but you are registered at{' '}
            <b>{profile.branchId}</b>. Sign in at your own outlet.
          </p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    )
  }

  // Read once per render rather than held in state: the mode only ever changes
  // through a reload, so there is no moment where this and the data on screen
  // could disagree. See src/lib/practice.js.
  const practising = isPractising()

  const nav = NAV[profile.role] ?? []
  const home = HOME[profile.role] ?? '/sell'

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Bakery</span>
        <span className="outlet muted small">
          {branch.data?.name ?? branchId} · till {deviceLetter()}
        </span>
        <span className="spacer" />
        <span className="who">
          <b>{profile.name}</b>
          <span>{profile.role}</span>
        </span>
        <ThemeToggle />
        <button className="btn ghost small no-print" onClick={signOut}>Sign out</button>
      </header>

      {/* Above every other banner, and above the stale sign-in, because it is
          the only one that changes what the numbers on screen *mean*. A cashier
          who does not notice this rings a real customer's bread into a practice
          day and the takings are simply not there at close.

          Ending practice is on the banner rather than behind the owner's login
          on purpose: turning it on is a decision, turning it off is a safety
          valve, and whoever is holding the tablet must always be able to hand
          it back live without finding the owner first. */}
      {practising && (
        <div className="strip block no-print">
          <span style={{ fontWeight: 600 }}>PRACTICE — nothing here is real.</span>{' '}
          Sales, closes and orders made on this tablet are for training and will not appear
          anywhere. It goes back to normal on its own tomorrow.{' '}
          <button className="btn ghost small" onClick={goLive}>End practice</button>
        </div>
      )}

      {/* Ordered by how much it costs to miss, not by when each condition
          happened to be added: a stale sign-in means nothing typed below this
          point is actually being saved, which outranks every other banner on
          the screen. Its own text carries weight for the same reason — the
          rest stay in the app's one neutral palette, since --alert is reserved
          for money that does not add up, not for "please read this". */}
      {claimsStale && (
        <div className="strip block no-print">
          <span style={{ fontWeight: 600 }}>
            This sign-in is out of date, so nothing you enter will save.
          </span>{' '}
          Sign out and back in.{' '}
          <button className="btn ghost small" onClick={signOut}>Sign out</button>
        </div>
      )}

      {!online && <div className="strip offline">Offline — sales are saved and will sync automatically</div>}

      {/* Downloaded and waiting, never applied on its own: this reloads the
          screen, and doing that unasked would throw away a bill somebody is
          halfway through. */}
      {updateWaiting && (
        <div className="strip block no-print">
          A new version is ready.{' '}
          <button className="btn ghost small" onClick={installUpdate}>
            Update now
          </button>
          <span className="muted small"> — finish the sale you are on first.</span>
        </div>
      )}

      {driftMatters(drift) && (
        <div className="strip block no-print">
          This tablet's clock is {describeDrift(drift)}. Sales are being filed under the wrong time,
          and possibly the wrong day. Fix the date and time in the tablet's settings.
        </div>
      )}

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route
            path="/sell"
            element={
              <Only path="/sell" role={profile.role}>
                {/* The whole outlet, not just its name: the receipt prints the
                    shop's own address and phone, which differ per outlet. */}
                <Sell branchId={branchId} branch={branch.data} />
              </Only>
            }
          />
          <Route
            path="/close"
            element={
              <Only path="/close" role={profile.role}>
                <CloseDay branchId={branchId} isMain={branch.data?.isMain ?? false} />
              </Only>
            }
          />
          <Route
            path="/catalog"
            element={
              <Only path="/catalog" role={profile.role}>
                <Catalog />
              </Only>
            }
          />
          <Route
            path="/dashboard"
            element={
              <Only path="/dashboard" role={profile.role}>
                <Dashboard />
              </Only>
            }
          />
          <Route
            path="/bake"
            element={
              <Only path="/bake" role={profile.role}>
                <Bake />
              </Only>
            }
          />
          <Route
            path="/stock"
            element={
              <Only path="/stock" role={profile.role}>
                <Stock branchId={branchId} isMain={branch.data?.isMain ?? false} />
              </Only>
            }
          />
          <Route
            path="/materials"
            element={
              <Only path="/materials" role={profile.role}>
                {practising ? <NotInPractice what="Raw materials" /> : <Materials />}
              </Only>
            }
          />
          <Route
            path="/stock-report"
            element={
              <Only path="/stock-report" role={profile.role}>
                <StockReport />
              </Only>
            }
          />
          <Route
            path="/money"
            element={
              <Only path="/money" role={profile.role}>
                {practising ? <NotInPractice what="The money screen" /> : <MoneyScreen />}
              </Only>
            }
          />
          <Route
            path="/dispatch"
            element={
              <Only path="/dispatch" role={profile.role}>
                <Dispatch branchId={branchId} />
              </Only>
            }
          />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>

      {nav.length > 1 && (
        <nav className="tabbar no-print">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
