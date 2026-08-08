// Light or dark, chosen once and remembered on this tablet.
//
// With nothing stored the app follows the device, which is what a tablet that
// dims itself in the evening already expects. The moment somebody taps the
// toggle it becomes an explicit choice and stops following: a counter under a
// bright window may want light all day even when Android has gone dark.
//
// The choice is per-tablet, not per-person. Two cashiers sharing a till are
// looking at the same screen in the same room, and asking each of them to set
// it again after every sign-in would be the opposite of enter-once.

import { useCallback, useEffect, useState } from 'react'

const KEY = 'bakery.theme'

/** The explicit choice, or null when this tablet is still following the device. */
export function storedTheme() {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    // Private browsing and locked-down kiosk profiles can refuse localStorage.
    // Following the device is a fine answer; a broken app is not.
    return null
  }
}

export function deviceTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** What is actually on screen right now. */
export function activeTheme() {
  return storedTheme() ?? deviceTheme()
}

/**
 * Put the choice on <html> where the stylesheet can see it. Passing null
 * removes the attribute and hands control back to the device.
 */
export function applyTheme(theme) {
  const root = document.documentElement
  if (theme) root.setAttribute('data-theme', theme)
  else root.removeAttribute('data-theme')
}

/**
 * Apply the stored choice before React renders.
 *
 * Only needed when a choice has been stored, because the stylesheet already
 * follows the device on its own — which is what keeps the first paint correct
 * with no script at all, and why there is no flash of the wrong colour.
 */
export function startTheme() {
  applyTheme(storedTheme())
}

export function useTheme() {
  const [theme, setTheme] = useState(activeTheme)

  // Keep following the device until somebody chooses. Without this a tablet on
  // an evening schedule would go dark around it and the app would not.
  useEffect(() => {
    if (storedTheme()) return undefined
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return undefined
    const onChange = () => setTheme(deviceTheme())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  const toggle = useCallback(() => {
    const next = activeTheme() === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Not being able to remember it is survivable; not applying it is not.
    }
    applyTheme(next)
    setTheme(next)
  }, [])

  return { theme, toggle }
}
