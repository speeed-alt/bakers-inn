#!/usr/bin/env node
// Add a domain to Firebase Authentication's authorised list.
//
//   SEED_PROJECT=bakers-inn-pk \
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//   node scripts/authorise-domain.mjs bakers-inn-one.vercel.app
//
// Firebase refuses every sign-in from a domain it does not know, and the failure
// is quiet: the login screen simply never signs anybody in. Vercel hands out a
// new URL for each deploy, so this is not a one-time step — a custom domain, or
// a preview link the owner is asked to try, each needs adding. Doing it from a
// script rather than the console means it can be repeated without remembering
// where the setting lives.
//
// Also reports whether Email/Password sign-in is switched on, because the app
// cannot work without it and the symptom looks identical.

import { initializeApp, applicationDefault } from 'firebase-admin/app'

const projectId = process.env.SEED_PROJECT || process.env.GCLOUD_PROJECT
const domains = process.argv.slice(2)

if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set SEED_PROJECT and GOOGLE_APPLICATION_CREDENTIALS first.')
  process.exit(1)
}
if (domains.length === 0) {
  console.error('Usage: node scripts/authorise-domain.mjs <domain> [domain...]')
  process.exit(1)
}

const app = initializeApp({ projectId, credential: applicationDefault() })
const { access_token: token } = await app.options.credential.getAccessToken()
const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`

async function call(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

const config = await call(base)
const existing = config.authorizedDomains ?? []
const missing = domains.filter((d) => !existing.includes(d))

if (missing.length === 0) {
  console.log('Already authorised:', domains.join(', '))
} else {
  await call(`${base}?updateMask=authorizedDomains`, {
    method: 'PATCH',
    body: JSON.stringify({ authorizedDomains: [...existing, ...missing] }),
  })
  console.log('Authorised:', missing.join(', '))
}

// The other half of "nobody can sign in", worth surfacing in the same breath.
const emailOn = config.signIn?.email?.enabled === true
console.log(`Email/Password sign-in: ${emailOn ? 'enabled' : 'DISABLED — nobody can sign in'}`)
