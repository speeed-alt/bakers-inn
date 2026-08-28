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
 * `demo-`, plus credentials named on purpose — rather than the only thing that
 * works.
 *
 * "Named on purpose" is either a service-account key in
 * GOOGLE_APPLICATION_CREDENTIALS, or `USE_ADC=1` to use whatever account is
 * already signed in. The second is for Cloud Shell, where the owner is
 * authenticated to the project the moment the terminal opens, and downloading a
 * private key to make that fact usable would be a step backwards: a key on a
 * laptop is a key that can be copied, mailed, and left in a Downloads folder.
 *
 * It still has to be typed, and that is the whole point of the guard. Ambient
 * credentials are exactly the thing that must not become the default — in Cloud
 * Shell, every script here would otherwise reach the live bakery on its own.
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
  } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.USE_ADC !== '1') {
    console.error(
      `\nRefusing to touch '${projectId}': no credentials were named.\n\n` +
        'Either point GOOGLE_APPLICATION_CREDENTIALS at a service-account key from\n' +
        'the Firebase console, or set USE_ADC=1 to use the account already signed\n' +
        'in — which is what Cloud Shell has, and anywhere you have run\n' +
        '`gcloud auth application-default login`.\n\n' +
        'Leave SEED_PROJECT unset to work against the emulators instead.\n',
    )
    process.exit(1)
  }

  initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() })
  return { projectId, useEmulator }
}
