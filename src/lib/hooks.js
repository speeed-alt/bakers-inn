import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { clockDrift } from './clock.js'
import { isPractising, visibleInMode } from './practice.js'

/** Which collection a snapshot came from, for the practice split. */
function collectionOf(ref) {
  // `parent` on a document reference is its collection; on a collection
  // reference it is the document above it, so the id is read off the ref itself.
  return ref?.parent?.id ?? ref?.id ?? ''
}

/**
 * Subscribe to a Firestore query or document reference.
 *
 * `build` returns the ref; `deps` control when it is rebuilt. Passing the ref
 * directly would resubscribe on every render, so it is built inside the effect.
 * Return null from `build` to stay idle (e.g. before a branch is known).
 *
 * Every read in the app comes through here, which is why the practice split
 * lives here too rather than in each screen. A screen that forgot to filter
 * would put invented money in a real total, and there are too many screens for
 * "remember to filter" to be a plan. See src/lib/practice.js.
 */
export function useSnapshot(build, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null, fromCache: false })

  useEffect(() => {
    const ref = build()
    if (!ref) {
      setState({ loading: false, data: null, error: null, fromCache: false })
      return
    }
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const fromCache = snap.metadata.fromCache
        const practising = isPractising()
        if ('docs' in snap) {
          setState({
            loading: false,
            data: snap.docs
              .map((d) => ({ id: d.id, ...d.data(), __in: collectionOf(d.ref) }))
              .filter((r) => visibleInMode(r, r.__in, practising))
              .map(({ __in, ...record }) => record),
            error: null,
            fromCache,
          })
        } else {
          const record = snap.exists() ? { id: snap.id, ...snap.data() } : null
          setState({
            loading: false,
            // A single document fetched by id gets the same treatment. Today's
            // baking list is read this way, and a practice one reaching a live
            // kitchen would have them baking against invented orders.
            data:
              record && visibleInMode(record, collectionOf(snap.ref), practising) ? record : null,
            error: null,
            fromCache,
          })
        }
      },
      (error) => {
        // Never let a failed read look like an empty one. A rejected query used
        // to reach the screen as "nothing here", which is indistinguishable from
        // a genuinely empty day and sends everyone hunting in the wrong place.
        console.error('[bakery] read failed', error)
        setState({ loading: false, data: null, error, fromCache: false })
      },
    )
    return unsubscribe
    // The dependency list is the caller's to get right: `build` is a closure
  // rebuilt on every render, so listing it would resubscribe on each one.
  }, deps)

  return state
}

/**
 * How far this tablet's clock is out, in milliseconds, or null if unknown.
 *
 * Checked once at startup and again whenever the connection comes back, which
 * is when a tablet that has been off all night would first be able to tell.
 *
 * A HEAD request is deliberate on two counts: it costs a header rather than a
 * page, and Workbox only routes GET, so it goes to the network instead of being
 * answered from the service worker's cache with a stale `Date`.
 */
export function useClockDrift(online) {
  const [drift, setDrift] = useState(null)

  useEffect(() => {
    if (!online) return
    let alive = true

    ;(async () => {
      try {
        const response = await fetch(window.location.origin + '/', {
          method: 'HEAD',
          cache: 'no-store',
        })
        // Read the device clock now, not before the request: the round trip
        // itself would otherwise be counted as drift.
        const measured = clockDrift(response.headers.get('date'), new Date())
        if (alive) setDrift(measured)
      } catch {
        // Offline, or the request was blocked. Not knowing is fine.
      }
    })()

    return () => {
      alive = false
    }
  }, [online])

  return drift
}

/** True while the browser reports a network connection. */
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
