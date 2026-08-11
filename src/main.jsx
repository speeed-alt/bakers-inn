import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth.jsx'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { reportClientError } from './data/errors.js'
import { applyPaperSettings } from './lib/paper.js'
import { startTheme } from './lib/theme.js'
import { startUpdates } from './lib/updates.js'
import './styles.css'

// Sizes the printed slip to the paper named in config.js, so printing works at
// 100% with the dialog's defaults.
applyPaperSettings()

// Before the first render, so a tablet that was set to light never flashes dark
// on its way in. With nothing stored this does nothing at all — the stylesheet
// is already following the device on its own.
startTheme()

// Registers the service worker and starts watching for new versions. Nothing is
// applied without being asked — see src/lib/updates.js.
startUpdates()

// The error boundary below only catches faults thrown while React renders.
// These two cover the rest — a listener that throws, a promise nobody awaited —
// which are the ones that otherwise leave no trace at all outside the console
// of a tablet nobody is looking at.
window.addEventListener('error', (event) => {
  reportClientError(event.error ?? event.message, 'window')
})
window.addEventListener('unhandledrejection', (event) => {
  reportClientError(event.reason, 'promise')
})

// Deliberately not wrapped in <React.StrictMode>.
//
// StrictMode double-mounts every component in development, which unsubscribes
// and immediately resubscribes each Firestore listener. That churn trips a
// known assertion inside the Firestore SDK ("INTERNAL ASSERTION FAILED:
// Unexpected state") and floods the console, hiding real errors. The behaviour
// is development-only, so the noise buys nothing and costs visibility.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>,
)
