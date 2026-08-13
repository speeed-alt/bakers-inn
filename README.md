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

> ⚠️ **They are also, almost certainly, the live PINs on `bakers-inn-pk` right
> now.** That project was seeded on 2026-08-04, four days before the guard below
> existed, from a seed that hardcoded these values — and there is no
> PIN-change screen in the app, so nothing can have rotated them since. Treat
> the table above as public knowledge until step 9 of [GOLIVE.md](GOLIVE.md) has
> been done.

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

**It is live at https://bakers-inn-pk.web.app**, on Firebase Hosting, backed by
the Firebase project `bakers-inn-pk` (Firestore in `asia-south1`, Mumbai — the
closest region to Pakistan).

One host, not two. Firebase is the actual system — the database, the sign-ins,
the security rules and the scheduled jobs — and it serves the app as well, so
there is one place to deploy and one place to look when something is wrong.
Firebase also authorises its own hosting domains for sign-in automatically,
which is a step that is easy to forget anywhere else and fails silently when you
do: the login screen simply never signs anybody in.

The owner has a second client, a Flutter app in [mobile/](mobile/). It reads and
writes the same Firestore, and `mobile/test/port_test.dart` pins its arithmetic
against values taken from this app so the two cannot drift.

Deploying, once a Firebase project exists:

```bash
npm run build
firebase deploy --only hosting --project bakers-inn-pk
```

Nothing else is needed for a code change. `firebase.json` carries the parts that
bite: deep links like `/close` survive a refresh, hashed assets are cached
forever, and **everything else is `must-revalidate`** so a tablet cannot keep
running last month's till after a deploy.

Setting up a new project from scratch, in order:

**1. Create the Firebase project** (console.firebase.google.com). Enable
Firestore and Email/Password sign-in. The scheduled compile and the nightly
report need the Blaze plan; everything else fits the free tier, and a bakery
this size will sit near zero. Set a budget alert anyway.

**2. Push the rules, indexes and jobs:**

```bash
firebase use --add          # pick the new project
firebase deploy --only firestore:rules,firestore:indexes,functions
```

Deploying `functions` **fails without Blaze**, and not because the functions
would cost anything — Cloud Build and Artifact Registry refuse to enable on the
free plan. `bakers-inn-pk` is in that state today, so two of the five jobs run
from `.github/workflows/daily.yml` instead: the 05:00 baking list and the 06:00
report rebuild, using the same shared arithmetic. That workflow needs the
service-account JSON from step 3 stored as a repository secret named
`FIREBASE_SERVICE_ACCOUNT`, and it exits 1 without it.

`syncStaffClaims` and `reportOnClose` have **no** substitute. Until they are
deployed, anyone added through the app signs in with no permissions and every
write they make is refused, and there is no report for a day until 06:00 the
next morning. See [GOLIVE.md](GOLIVE.md).

**3. Seed the real data once** — outlets, staff, the product list — by pointing
the seed script at the project instead of the emulator. This needs a
service-account key (Project settings → Service accounts). Keep that file
outside the repository: unlike the web config it is a genuine secret, and it
bypasses `firestore.rules` completely.

```bash
SEED_PROJECT=… GOOGLE_APPLICATION_CREDENTIALS=…/key.json PIN_OWNER=… PIN_AYESHA=… npm run seed
```

**4. Put the six values from `.env.example` in `.env.production.local`**, then
build and deploy:

```bash
npm run build
firebase deploy --only hosting --project bakers-inn-pk
```

Deliberately `.env.production.local` rather than `.env.local`: Vite reads it for
`npm run build` but not for `npm run dev`, so local development keeps running
against the emulators and nobody has to remember to move a file before testing
offline selling.

The header rules in `firebase.json` are worth understanding, because the obvious
version of them is wrong. A rule on `/index.html` does not fire for a request to
`/`, and with the SPA rewrite every deep link — `/close`, `/stock` — serves that
same shell without matching it either. So the catch-all `**` carries
`must-revalidate` and `/assets/**` opts back out with `immutable`; the more
specific rule wins. Get it the other way round and tablets quietly cache the
till for an hour.

`vercel.json` is left in the repository for anyone who wants to host it there
instead. It is not used.

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
