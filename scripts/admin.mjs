import { initializeApp, applicationDefault } from 'firebase-admin/app'

/**
 * Which project these scripts talk to, and how they reach it.
 *
 * Every script here used to demand SEED_PROJECT and a service-account key
 * before it would do anything at all. That made the real project the *only*
 * place any of them could be run — so seeing a full set of screens, or testing
 * a change to the compile, meant pointing admin credentials at the bakery's
 * live database. It is almost certainly how `bakers-inn-pk` came to hold a
 * fortnight of invented trading.
 *
 * Now they default to the emulator, exactly as `seed.mjs` always has. Reaching
 * the real project is deliberate — a project id that does not start with
 * `demo-`, plus a key — rather than the only thing that works.
 *
 * Note the ordering: the emulator host variables have to be set before
 * `initializeApp`, so this must be called before anything touches Firestore.
 *
 * @param needsAuth  also point the Admin Auth SDK at the emulator
 */
export function initAdmin({ needsAuth = false } = {}) {
  const projectId = process.env.SEED_PROJECT || process.env.GCLOUD_PROJECT || 'demo-bakery'
  const useEmulator = projectId.startsWith('demo-')

  if (useEmulator) {
    process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
    if (needsAuth) process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
  } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      `\nRefusing to touch '${projectId}': GOOGLE_APPLICATION_CREDENTIALS is not set.\n` +
        'Point it at a service-account key from the Firebase console, or leave\n' +
        'SEED_PROJECT unset to work against the emulators instead.\n',
    )
    process.exit(1)
  }

  initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() })
  return { projectId, useEmulator }
}
