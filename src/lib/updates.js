// Getting a new version onto a tablet that is already running one.
//
// This is harder than it looks and it bit us: a deploy went out, the tablet
// kept showing the old screens, and it looked as though nothing had shipped.
// The service worker serves the app shell from its own cache, so the
// no-cache headers on the server never get a say — the browser does not ask.
//
// Reloading automatically the moment a new version arrives would fix that and
// cause something worse: a cashier halfway through a bill, with a customer
// waiting, would watch it vanish. So the new version is downloaded and held,
// and the app says so. Whoever is on the till applies it between customers.
//
// In development the virtual module is a stub and none of this runs.

import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

let applyUpdate = null
let waiting = false
const listeners = new Set()

function announce(value) {
  waiting = value
  for (const listener of listeners) listener(value)
}

/** Called once at startup, before React renders. */
export function startUpdates() {
  try {
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh: () => announce(true),
      onRegisteredSW(url, registration) {
        // Tablets are left open for days at a time, so a tab that is never
        // reloaded would never notice a deploy. Ask every half hour — it is one
        // conditional request for a file that is a few kilobytes.
        if (!registration) return
        setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000)
      },
    })
  } catch (error) {
    // No service worker (an old browser, or a private window). The app works
    // perfectly well without one; it simply loads from the network each time.
    console.warn('[bakery] update checks unavailable', error)
  }
}

/** True once a new version has been downloaded and is waiting to be applied. */
export function useUpdateWaiting() {
  const [value, setValue] = useState(waiting)
  useEffect(() => {
    listeners.add(setValue)
    return () => listeners.delete(setValue)
  }, [])
  return value
}

/** Swap to the new version. This reloads the page, so ask first. */
export function installUpdate() {
  if (applyUpdate) applyUpdate(true)
  else window.location.reload()
}
