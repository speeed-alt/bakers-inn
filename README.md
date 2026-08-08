# The Baker's Inn

Transaction and management system for a bakery with three outlets, built to the
design in [PLAN.md](PLAN.md).

The main outlet is a hub — it buys raw materials, bakes, and distributes to the
two shop outlets, which request stock, sell it, and report back. One web app
serves all three; the signed-in person's role decides what they see.

**Phase 1 (this code): the catalog and the till.** Selling works with no
internet. Phases 2–5 add the other outlets, the demand → baking list → delivery
loop, the full daily close, and the raw-material ledger.

## Running it locally

No Firebase account is needed. Local development runs entirely against the
emulators using the offline demo project `demo-bakery`.

The Firestore emulator needs **JDK 21 or newer**. If `java -version` reports
something older, you very likely already have a new enough one bundled with
Android Studio — point the emulator at it for the session rather than installing
another JDK:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
```

```bash
npm install
```

Then, in three terminals:

```bash
npm run emulators
```

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:5173, pick an outlet when the tablet setup screen appears,
then sign in.

| Person | Role       | Outlet            | PIN  |
|--------|------------|-------------------|------|
| Owner  | owner      | MAIN, Main Outlet | 1111 |
| Ayesha | cashier    | MAIN, Main Outlet | 2222 |
| Bilal  | cashier    | B2, Gulberg       | 3333 |
| Hina   | cashier    | B3, Model Town    | 4444 |
| Usman  | specialist | MAIN, Main Outlet | 5555 |

**These work against the emulators only.** Seeding a real project refuses to run
unless a PIN is supplied for each person in the environment, so that no real PIN
is ever written into a file that git would remember:

```bash
PIN_OWNER=… PIN_AYESHA=… PIN_BILAL=… PIN_HINA=… PIN_USMAN=… SEED_PROJECT=… npm run seed
```

### Tests

```bash
npm test
```

The money maths — takings, voids, refunds, expected cash, formatting. No
emulator needed.

```bash
npm run test:rules
```

The security rules, against the running emulator: which outlet a cashier may
write to, that takings can never be edited, that nothing can be deleted, and
that only the owner touches the catalog, staff, or purchases.

These two suites are deliberately the whole automated story. They cover the
parts that must never be wrong; everything else is checked by running a real
day through the app before a release.

## How it is put together

| Path | What lives there |
|---|---|
| `src/firebase.js` | Firebase setup and the persistent local cache that makes offline selling work |
| `src/auth.jsx` | Tap-a-name + 4-digit PIN sign-in, and the role each person carries |
| `src/config.js` | Currency, day-rollover hour, quick-cash buttons, void reasons |
| `src/lib/` | Business dates, ids, money, and the pure report maths |
| `src/data/` | Firestore reads and writes, one file per record type |
| `src/screens/` | One file per screen from the plan |
| `firestore.rules` | Who may write what — enforced on the server, not in the UI |
| `scripts/seed.mjs` | Outlets, staff, and a starting product list |

### Things worth knowing before changing the code

**Never `await` a write on the selling path.** Offline, a Firestore write
promise does not settle until it reaches the server, which may be hours later.
The local cache updates synchronously either way. Awaiting would freeze the till
the moment the internet drops — see the note at the top of `src/data/sales.js`.

**Money is whole rupees, stored as integers.** Paisa are out of circulation, so
the rupee is the smallest unit the system knows about — `CURRENCY_DECIMALS` in
`src/config.js` is `0`. Never put a fractional currency value in a document.
Switching currency is that one constant plus `CURRENCY_SYMBOL`; every screen
formats through `src/lib/money.js`.

**Business dates are stamped by the device at creation**, and a sale rung before
04:00 belongs to the previous day (`DAY_ROLLOVER_HOUR`). That is what puts a late
shift's takings on the right day's report.

**Names and prices are copied into each sale line.** Editing the catalog must
never rewrite history, and a receipt has to render with no network.

**Nothing is ever deleted.** Products are archived, staff are turned off, sales
are voided, and mistakes are corrected with stamped adjustments. The security
rules enforce this — they permit no deletes at all, by anyone.

**Ids carry meaning.** `S-B2-0729-A017` is a sale at Riverside on 29 July from
till A. Sale document ids are deterministic, so a retried write updates the same
document instead of double-counting takings.

## Putting it on the internet

Two hosts, and the order matters.

**Vercel serves the app. Firebase is the actual system** — the database, the
sign-ins, the security rules, and the two scheduled jobs. Deploying to Vercel
before a Firebase project exists gives you a page that loads and then does
nothing, because with no `VITE_FB_*` values the app looks for the emulators on
`127.0.0.1`, which no phone on the internet can reach.

So: Firebase first.

**1. Create the Firebase project** (console.firebase.google.com). Enable
Firestore and Email/Password sign-in. The scheduled compile and the nightly
report need the Blaze plan; everything else fits the free tier, and a bakery
this size will sit near zero. Set a budget alert anyway.

**2. Push the rules, indexes and jobs:**

```bash
firebase use --add          # pick the new project
firebase deploy --only firestore:rules,firestore:indexes,functions
```

**3. Seed the real data once** — outlets, staff, the product list — by pointing
the seed script at the project instead of the emulator. This needs a
service-account key (Project settings → Service accounts). Keep that file
outside the repository: unlike the web config it is a genuine secret, and it
bypasses `firestore.rules` completely.

```bash
SEED_PROJECT=… GOOGLE_APPLICATION_CREDENTIALS=…/key.json PIN_OWNER=… PIN_AYESHA=… npm run seed
```

**4. Give Vercel the six values** from `.env.example` (Project → Settings →
Environment Variables), then deploy:

```bash
vercel --prod
```

`vercel.json` already handles the parts that bite, and each rule in it is there
for a reason worth knowing — Vercel's schema rejects unknown keys, so the file
itself cannot carry comments:

- **The rewrite** sends every path to `index.html`, so deep links like `/close`
  survive a refresh instead of returning a 404 from the CDN.
- **`index.html` and `sw.js` are never cached.** A tablet holding an old shell or
  service worker would keep running last month's till after a deploy, and nobody
  on the counter would know. Everything under `/assets/` carries a content hash
  in its filename, so that is cached forever.
- **`X-Frame-Options: DENY` and `Referrer-Policy: same-origin`** keep a screen
  showing the day's takings out of other people's frames and referrer logs.

**5. Add the Vercel domain** to Firebase → Authentication → Settings →
Authorised domains, or every sign-in will be refused.

### On phones and tablets

Open the site and use "Add to Home Screen". It then runs full-screen with no
browser bar and keeps working through a dropped connection. That is the same
PWA either way — there is no separate app to install.

## Connecting a real Firebase project

Create `.env.local` with the values from the Firebase console. As soon as
`VITE_FB_API_KEY` is set, the app talks to the cloud instead of the emulators.

```
VITE_FB_API_KEY=...
VITE_FB_AUTH_DOMAIN=...
VITE_FB_PROJECT_ID=...
VITE_FB_STORAGE_BUCKET=...
VITE_FB_SENDER_ID=...
VITE_FB_APP_ID=...
```

Then deploy the rules and indexes before the app:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### One security tradeoff, stated plainly

The `users` collection is world-readable, because the login screen has to list
staff names before anyone has signed in. Those documents hold names, roles, and
outlets — no secrets. PINs live in Firebase Auth and are never stored in
Firestore. Everything that matters is gated by the rules: a cashier can only
write sales for their own outlet, and only the owner can touch the catalog,
staff, or purchases.
