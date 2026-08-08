#!/usr/bin/env node
// Compare each person's staff record against the claims on their sign-in token.
//
//   SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
//     node scripts/check-claims.mjs
//
// The screen reads a role from /users; the security rules read it from the
// token. When those disagree the app looks completely normal while every write
// is silently refused — the worst kind of fault, and the one CLAUDE.md warns
// about. The app detects it for the signed-in person, but only once they are
// already standing at a till wondering why nothing saves. This checks everyone
// at once, from here.
//
// It matters most while `syncStaffClaims` is not deployed, because then nothing
// is keeping the two in step automatically.

const projectId = process.env.SEED_PROJECT || process.env.GCLOUD_PROJECT
if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set SEED_PROJECT and GOOGLE_APPLICATION_CREDENTIALS first.')
  process.exit(1)
}

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp({ projectId, credential: applicationDefault() })
const auth = getAuth()
const db = getFirestore()

const users = await db.collection('users').get()
let wrong = 0

console.log(`\n${projectId}\n`)
console.log('person    record                     token')
console.log('------    ------                     -----')

for (const document of users.docs) {
  const record = document.data()
  let claims = null
  try {
    claims = (await auth.getUser(document.id)).customClaims ?? {}
  } catch {
    console.log(`${document.id.padEnd(9)} ${'(no sign-in account)'.padEnd(26)} —`)
    wrong += 1
    continue
  }

  const say = (o) => `${o.role ?? '?'}/${o.branchId ?? '?'}/${o.active ? 'on' : 'off'}`
  const agrees =
    claims.role === record.role &&
    claims.branchId === record.branchId &&
    Boolean(claims.active) === Boolean(record.active)

  if (!agrees) wrong += 1
  console.log(
    `${document.id.padEnd(9)} ${say(record).padEnd(26)} ${say(claims)}${agrees ? '' : '   <-- MISMATCH'}`,
  )
}

if (wrong > 0) {
  console.log(
    `\n${wrong} ${wrong === 1 ? 'person is' : 'people are'} out of step. Their screens will look` +
      '\nnormal while every write is refused. Re-run the seed, or deploy the' +
      '\nsyncStaffClaims function so this is kept in step on its own.\n',
  )
  process.exit(1)
}

console.log('\nEverybody agrees.\n')
