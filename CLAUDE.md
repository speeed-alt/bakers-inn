# Baker's Inn — working notes

A transaction and management system for a real Pakistani bakery with three
outlets. Read [PLAN.md](PLAN.md) for the full design and [README.md](README.md)
for how to run and deploy it. This file is what you need in your head before you
change anything.

## What it is

One React web app (a PWA) on cheap Android tablets, backed by Firebase. The
**main outlet is a hub**: it buys raw materials, bakes, and distributes to the
two shops, which request stock, sell it, and report back. The signed-in
person's role decides what they see.

The daily cycle, which is the spine of the whole thing:

```
1 Purchase → 2 Outlets order → 3 System compiles ONE baking list
           → 4 Kitchen bakes → 5 Deliver out → 6 Close & report → repeat
```

All five phases of PLAN.md are built and verified. What remains is not code:
a real Firebase project, hardware, training, rollout.

## The owner's rules

These are commitments to a real, non-technical owner. They outrank your taste.

1. **Enter once.** A thing is typed in exactly once, gets an ID, and afterwards
   is only picked from a list or confirmed. If you are adding a field someone
   has already typed elsewhere, stop.
2. **Minimal and plain.** He asked for "minimalistically professional, nothing
   flashy". One neutral palette, near-black primary buttons, 6px radius, no
   shadows or gradients, colour only where it carries meaning. Do not
   reintroduce an accent colour.
3. **Nothing is ever deleted.** Products are archived, staff turned off, sales
   voided, days reopened. The security rules permit no deletes at all.
4. **Visibility replaces approval.** There are no approval queues anywhere.
   Anyone can void, reopen, adjust — every action is stamped and surfaces on the
   owner's dashboard.

## Commands

```bash
npm run emulators   # syncs shared code, then auth + firestore + functions
npm run seed        # outlets, staff, the real 44-item catalogue, materials
npm run dev         # the app
npm test            # 212 pure-logic tests, no emulator needed
npm run test:rules  # 55 security-rules tests, emulator must be running
```

Both suites also run on every push — see `.github/workflows/test.yml`.

The Firestore emulator needs **JDK 21+**. System Java here is 8; a good JDK
ships with Android Studio:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
```

`JAVA_HOME` alone is not enough — the Firebase CLI reads `java` off `PATH`.

Dev PINs: Owner 1111, Ayesha 2222, Bilal 3333, Hina 4444, Usman 5555. These are
**emulator-only**. Seeding a real project refuses to run unless every PIN comes
from the environment (`PIN_OWNER`, `PIN_AYESHA`, …), because a PIN committed once
stays readable in git history for as long as the repository exists. Never put a
real PIN back into `scripts/seed.mjs`.

## Traps that have already cost time

**Never `await` a Firestore write on the selling path.** Offline, the promise
does not settle until it reaches the server — hours later. The local cache
updates synchronously either way, so awaiting freezes the till exactly when the
internet drops. See the note atop `src/data/sales.js`.

**Firestore rules are not filters.** A query is refused unless its own
constraints *prove* the read rule. On a `list` the engine evaluates with an
empty `resource`, so `resource.data.x` inside a larger `||` throws and kills the
whole query — it does **not** short-circuit past an owner clause that would have
passed. The working shape, used for sales, closings, transfers and reports:

```
allow get:  if isOwner() || (active() && resource.data.branchId == myBranch());
allow list: if isOwner();
allow list: if active() && resource.data.branchId == myBranch();
```

Separate `allow` statements are considered independently. Non-owner queries must
therefore pin their branch field; the owner needs no filter.

**A rule that touches `resource.data` cannot read a document that does not
exist.** Fetching one by id returns *permission denied*, not "no such document".
The till asks `closings/C-<date>-<branch>` on every load and for most of the day
that document is not there yet, so it logged a denial every morning — failing
closed, so nothing broke, but burying the console in errors indistinguishable
from real ones. Single-document gets on natural-key ids need `resource == null
||` in front of the field check. Collections only ever queried as lists do not.

**Never read a document inside a rule.** `get(/users/$(uid))` runs once per row
a query returns and blows Firestore's per-request limit — fine on a quiet day,
broken once the day gets busy. Role and outlet come from custom claims
(`request.auth.token`), kept in step by the `syncStaffClaims` function.

**The claims-vs-document split.** The UI reads role from `/users`; the rules read
it from the token. When they disagree the app looks perfectly normal while every
write is silently refused. `AuthProvider` compares them, refreshes the token
once, and shows a banner if it still disagrees. Do not remove that.

**Money is whole rupees, stored as integers.** `CURRENCY_DECIMALS = 0` — paisa
are out of circulation. Never put a fractional currency value in a document.

**Business dates are stamped by the device** with a 04:00 rollover, so a late
shift's takings land on the right day.

**`<React.StrictMode>` is deliberately absent** in `main.jsx`: its dev
double-mount churns Firestore listeners and trips an SDK assertion that floods
the console.

**Multi-tab while testing:** tabs on one origin share the Firestore cache and one
owns the network lease. A stale tab left offline silently queues every write from
the others. Close old tabs before diagnosing "writes not landing".

**HMR staleness has twice convinced me something was broken.** Hard-reload before
believing a screen.

## How the code is arranged

| Path | What lives there |
|---|---|
| `src/lib/` | Pure logic, no Firestore, all unit-tested. Money, dates, ids, search, the compile, leftovers, the daily report, materials, CSV, receipt and paper. |
| `src/data/` | Firestore reads and writes, one file per record type. |
| `src/screens/` | One file per screen. |
| `src/components/` | Shared UI. `TomorrowsOrder` is used by both Stock and the close wizard — do not duplicate it. |
| `functions/` | The only server code: `syncStaffClaims`, the 05:00 compile, `reportOnClose`, the 06:00 report rebuild, and `compileNow` for testing. |
| `firestore.rules` | The real permission system. The UI only hides buttons. |

Three things added after the first deploy, each worth knowing about:

- **Faults are reported, not swallowed.** `ErrorBoundary` plus the two window
  handlers in `main.jsx` write to `clientErrors`, which the owner's dashboard
  shows for three days. `data/errors.js` caps itself at 20 per session and
  de-duplicates: a render loop throws hundreds of times a second, and without
  the cap the reporter would become the outage.
- **The tablet's clock is checked against the server** on startup and whenever
  the connection returns (`useClockDrift`). Business dates are stamped by the
  device, so a wrong clock files a day's takings under the wrong date and
  nothing else would notice. It warns; it never silently corrects.
- **Tomorrow's order is suggested from the closing reports** (`lib/suggest.js`),
  not copied from last week. A day that ended with nothing left and nothing
  binned measured the shelf rather than demand, so those days are nudged up 10%.
  A product missing from a report counts as zero for that day — averaging only
  over the days it appears would order forty every Tuesday off one good one.

**Shared code is copied, not imported.** Cloud Functions deploy only their own
directory, so `scripts/sync-shared.mjs` copies `src/config.js` and `src/lib/`
into `functions/shared/` (gitignored). `npm run emulators` does it for you. One
definition of the arithmetic, or the kitchen's list and the app's prediction
drift apart.

## Records and IDs

Ids carry meaning and are natural keys where one exists per outlet per day, so a
re-run lands on the same document instead of duplicating.

```
P-0728-01        purchase
D-20260729-B2    an outlet's order for a day
PO-20260729      the compiled baking list
T-20260729-B2    a delivery  (-2 second run, -R going back to the hub)
S-B2-0729-A017   a sale at Riverside, till A
C-20260729-B2    a day's close
R-20260729-B2    the compiled daily report
```

Sale document ids are deterministic, so a retried write updates the same
document instead of double-counting takings.

Product **codes are the SR numbers off the shop's own printed closing sheet**
(01–44). Staff have read those numbers for years — do not renumber them.

## Their vocabulary

The close wizard uses the words already printed on the shop's sheet, and its
columns map exactly onto what the system tracks. Keep this language:

| Their sheet | The system |
|---|---|
| Existing Stock | carried in from yesterday |
| Addition Stock | received today |
| Stale | wasted |
| Remaining Stock | carried over |
| Closing Sale | sold |

The owner also keeps **one ruled line a day**, separate from the per-outlet
closing sheet, and it is the only record he reads end to end. Photographed off
the counter on 2026-08-13:

```
Date | Production | Distribution ×3 | Sale position ×3 | Total sale | Total stale
```

`lib/dailySheet.js` reproduces exactly that row and `components/DailySheet.jsx`
renders it as the first card on his dashboard. Three things about it that are
easy to get wrong:

- **It is in rupees, not units.** He writes `2 lakh`, never `2000 loaves`. The
  system holds quantities per product and derives the value; his sheet is the
  other way round.
- **Production means what came out of the oven**, not what the list asked for,
  so it counts `produced` and not `qtyNeeded` — and extras count, because a tray
  nobody ordered was still baked and still gets sold.
- **His columns do not reconcile, and that is not an error.** On the sheet
  photographed: 2,00,000 sent out, 1,80,000 sold, 5,000 stale — 15,000 with no
  column to go in. It is stock still on a shelf. The card names it underneath
  rather than adding a column, because the table has to stay the shape he
  recognises.

Whether this line is the *whole* of what he records, or a summary on top of the
44-item closing sheet, is **not yet confirmed with him**. It changes how much of
the close wizard he will actually use.

## Deliberate decisions worth not re-litigating

- **No recipe/ingredient depletion.** The owner rejected it. Usage is derived
  from consecutive stock counts instead: `(previous count + received − spoiled)
  − counted now`, over the days between.
- **Gross margin is business-wide, not per outlet.** Without recipes there is no
  honest way to say what one shop's stock cost. The card says so on screen.
- **Daily reports live on the dashboard, not email.** One less thing to fail.
- **Production "complete" means every line recorded, not every target met.** A
  short bake must still be closeable or the vans never leave.
- **An outlet can reopen its own closed day.** An accidental tap must never leave
  a shop unable to sell while it waits on the owner. Stamped and surfaced.
- **`users` is world-readable** — the login screen lists names before anyone has
  signed in. No secrets live there; PINs are in Firebase Auth.

## Where it is deployed

| | |
|---|---|
| Firebase | `bakers-inn-pk`, Firestore in `asia-south1` (Mumbai) |
| Functions | pinned to `asia-south1` — a v2 Firestore trigger must live in the same region as its database, and the default is `us-central1` |
| Web app | Firebase Hosting → **https://bakers-inn-pk.web.app** |
| Owner app | `mobile/`, a Flutter client. `flutter build apk --release` |
| Admin key | `C:\Users\SPEEED\.firebase-keys\bakers-inn-pk-admin.json`, outside the repo on purpose |

```bash
npm run build && firebase deploy --only hosting --project bakers-inn-pk
```

Deploy with `--project bakers-inn-pk` (or the `prod` alias). The `.firebaserc`
default stays `demo-bakery` so `npm run emulators` keeps working offline.

**Vercel is not used.** It served the app briefly; its deploy queue jammed after
some oversized uploads and the owner asked for the app on a phone instead.
`vercel.json` and `.vercelignore` are left in place for anyone who wants that
route back, and nothing depends on them.

Firebase authorises its own hosting domains automatically. Any *other* domain
must be added or every sign-in is refused, silently:

```bash
SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json node scripts/authorise-domain.mjs <domain>
```

## Known gaps

**[GOLIVE.md](GOLIVE.md) is the authority on what stands between this and a real
trading day, in the order it has to happen.** What follows is the short version
for someone about to change code.

- **Blaze is not enabled**, so the Cloud Functions are not deployed. Two of the
  five now have a substitute in `.github/workflows/daily.yml` — the 05:00
  compile and the 06:00 report rebuild — running the same shared arithmetic, so
  switching Blaze on later changes no answers. **`syncStaffClaims` and
  `reportOnClose` still have no substitute at all.** That is the sharp edge:
  anyone added through the app signs in with no permissions and every write is
  refused, and there is no daily report until 06:00 the next morning. The
  workflow also needs `FIREBASE_SERVICE_ACCOUNT` set as a repository secret,
  which it currently is not, so it has never run. Once billing is on:
  `firebase deploy --only functions --project bakers-inn-pk`, then turn on
  backups, which also need billing:

  ```bash
  firebase firestore:databases:update "(default)" --delete-protection ENABLED --point-in-time-recovery ENABLED --project bakers-inn-pk
  ```

- **The live project is full of demo data.** Practically every sale, closing and
  report on `bakers-inn-pk` carries `demo: true`. Nothing in `src/` filters that
  flag, and `lib/suggest.js` orders tomorrow's baking off those invented
  reports. Clear it with `node scripts/demo-day.mjs --clear`, which now also
  reports anything left behind that has no flag to remove it by.
- **The dev PINs are almost certainly still live in production.** It was seeded
  on 2026-08-04, four days before the guard that requires PINs from the
  environment, and there is no PIN-change screen to have rotated them since. Do
  not test it to find out; re-seed with real ones.
- **No PIN reset.** PINs are never stored, so a forgotten one cannot be looked up
  or reset. Fixing it needs a callable Cloud Function using the Admin SDK.
- **Branch names are placeholders** (Main Outlet / Gulberg / Model Town), and so
  are the 44 catalogue prices and the 9 material costs.
- **`sellsNextDay` was my judgement, not the owner's.** It decides what counts as
  stale at close and is worth confirming with him.
- **The order suggestion ignores stock already on the shelf.** It answers "how
  much does this weekday need", not "how much more do we need". For items that
  carry over it will read slightly high until the carry is subtracted — the
  close wizard knows that figure by the time the order is placed.
- **A late close cannot be finished through the wizard's Next button.** Once the
  05:00 job locks today's demand, `TomorrowsOrder` renders no Send button, so
  the step-3 gate never satisfies. Tapping step 4 directly gets through it.

## Before you finish

Run `npm test` and `npm run test:rules`, and build. The two suites are
deliberately the whole automated story: they cover the parts that must never be
wrong. Everything else is checked by running a real day through the app.
