import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'

/**
 * Subscribe to a Firestore query or document reference.
 *
 * `build` returns the ref; `deps` control when it is rebuilt. Passing the ref
 * directly would resubscribe on every render, so it is built inside the effect.
 * Return null from `build` to stay idle (e.g. before a branch is known).
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
        if ('docs' in snap) {
          setState({
            loading: false,
            data: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
            error: null,
            fromCache,
          })
        } else {
          setState({
            loading: false,
            data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
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
