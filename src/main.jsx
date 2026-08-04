import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth.jsx'
import App from './App.jsx'
import { applyPaperSettings } from './lib/paper.js'
import './styles.css'

// Sizes the printed slip to the paper named in config.js, so printing works at
// 100% with the dialog's defaults.
applyPaperSettings()

// Deliberately not wrapped in <React.StrictMode>.
//
// StrictMode double-mounts every component in development, which unsubscribes
// and immediately resubscribes each Firestore listener. That churn trips a
// known assertion inside the Firestore SDK ("INTERNAL ASSERTION FAILED:
// Unexpected state") and floods the console, hiding real errors. The behaviour
// is development-only, so the noise buys nothing and costs visibility.
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
)
