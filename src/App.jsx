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
}

function Only({ path, role, children }) {
  if (ALLOWED[path]?.includes(role)) return children
  return <Navigate to={HOME[role] ?? '/sell'} replace />
}

/**
 * Wipe everything this browser has stored for the app and start over.
 *
 * The recovery for a tablet whose stored data has been damaged — the one fault
 * that stops the app before it can tell you anything. Nothing of value lives
 * here: sales and closes are on the server, and anything not yet synced is
 * already gone if the storage is broken.
 */
async function resetThisTablet() {
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
          damaged. Nothing has been lost — every sale and close is kept on the server.
        </p>
        <div className="grid2">
          <button className="btn" onClick={() => window.location.reload()}>Try again</button>
          <button className="btn primary" onClick={resetThisTablet}>Reset this tablet</button>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Resetting clears the saved sign-in and this tablet's outlet, so it has to be set up
          again — about a minute.
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

  const nav = NAV[profile.role] ?? []
  const home = HOME[profile.role] ?? '/sell'

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Bakery</span>
        <span className="muted small">
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

      {claimsStale && (
        <div className="strip block no-print">
          This sign-in is out of date, so nothing you enter will save. Sign out and back in.{' '}
          <button className="btn ghost small" onClick={signOut}>Sign out</button>
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
                <Sell branchId={branchId} branchName={branch.data?.name} />
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
                <Materials />
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
