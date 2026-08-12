// Light first. Dark only when somebody on this tablet has explicitly asked
// for it.
//
// This app does not follow the device's system setting. A tablet is often
// left with Android's own evening dark mode on for reasons that have nothing
// to do with a counter that is lit all day, and a shop opening the till to
// find it has silently gone dark is a worse surprise than a shop that has to
// tap a sun icon once to get it. So the default, with nothing chosen, is
// light — and it stays light until somebody taps the toggle.
//
// The choice is per-tablet, not per-person. Two cashiers sharing a till are
// looking at the same screen in the same room, and asking each of them to set
// it again after every sign-in would be the opposite of enter-once.

import { useCallback, useState } from 'react'

const KEY = 'bakery.theme'

/** The explicit choice, or null when nothing has been chosen on this tablet. */
export function storedTheme() {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    // Private browsing and locked-down kiosk profiles can refuse localStorage.
    // Defaulting to light is a fine answer; a broken app is not.
    return null
  }
}

/** What is actually on screen right now: the choice, or light. */
export function activeTheme() {
  return storedTheme() ?? 'light'
}

/**
 * Put the choice on <html> where the stylesheet can see it. Passing null
 * removes the attribute, which the stylesheet also reads as light — the two
 * are kept in step deliberately so there is only one definition of the default.
 */
export function applyTheme(theme) {
  const root = document.documentElement
  if (theme) root.setAttribute('data-theme', theme)
  else root.removeAttribute('data-theme')
}

/**
 * Apply the stored choice before React renders.
 *
 * With nothing stored this does nothing, and that is the point: the
 * stylesheet's own default is light, so an untouched tablet is correct from
 * the very first paint with no script needed at all. This only has work to do
 * on a tablet that has been explicitly switched to dark.
 */
export function startTheme() {
  applyTheme(storedTheme())
}

export function useTheme() {
  const [theme, setTheme] = useState(activeTheme)

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
