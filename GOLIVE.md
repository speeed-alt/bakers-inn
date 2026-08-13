# Going live

Everything between "it is deployed" and "the bakery runs on it".

The app has been built, tested and deployed at
**https://bakers-inn-pk.web.app** since 2026-08-08. It has never traded. This
file is the list of what stands between that and a real first day, in the order
it has to happen, because several steps destroy the work of later ones if run
early.

Realistically: **one phone call, one long session with the owner, and about two
focused days of work.**

Each step is marked **[owner]** or **[dev]**. Steps marked *destructive* touch
live data with an admin key that bypasses every security rule — do not run one
without step 4 done first.

---

## The one thing that unblocks the most

**Blaze billing has never been enabled on `bakers-inn-pk`, so `functions/` has
never been deployed.** That single fact is the root of two of the five blockers
and two of the risks below.

`functions/index.js` already contains all five jobs, correctly written —
including the timezone handling that the GitHub Actions substitute had to have
patched into it by hand. The load for three outlets sits inside the free tier;
Blaze is a card on file and a spending cap, not a bill.

Cloud Functions cannot be deployed without it. This is not Firebase charging for
them — it is that Cloud Build and Artifact Registry refuse to enable on the free
plan, so a bakery that would sit inside the free quota forever is still blocked
by a card.

---

## What is actually broken

Five things stop a real trading day. Four have been fixed in code as of
2026-08-13; the fifth is the billing above. The fixes still have to be deployed
and the database still has to be cleaned.

| | What | State |
|---|---|---|
| 1 | The 05:00 job had never run, and would have built **yesterday's** baking list when it did | fixed, needs the secret |
| 2 | The live database is **demo data** — every figure on every screen is fiction | fixed the cleanup; still to run |
| 3 | The **dev PINs are almost certainly live**. Owner is probably still `1111` | needs re-seeding |
| 4 | Nobody the owner adds through the app can work, and nobody he removes is stopped | needs Blaze, or a script |
| 5 | Two tills, or one cleared tablet, minted the same sale id — and the **new sale was the one destroyed** | fixed |

### 1 · The morning jobs

Two separate faults, same job.

`FIREBASE_SERVICE_ACCOUNT` does not exist as a repository secret, so the
workflow has exited 1 on every run it has ever had — which is none, because it
has also never been triggered.

And the cron fires at 00:00 UTC, which *is* 05:00 in Faisalabad — but both
scripts fall back to `businessDateOf()`, which reads the **process** clock
against the 04:00 rollover. On a UTC runner that instant is hour 0, under the
rollover, so it handed back yesterday. The kitchen would have got yesterday's
baking list every single morning, and the vans yesterday's delivery notes.

Fixed by `TZ: Asia/Karachi` on the job, and covered by
`scripts/dates.test.mjs` so it cannot come back quietly. `compile-now.mjs` now
also exits non-zero when it produces no list, rather than painting a morning
with no baking list green on GitHub and telling nobody.

Deploying the real Cloud Functions makes all of this moot — they never had
either fault.

### 2 · The live database is demo data

Measured against `bakers-inn-pk`: **1681 of 1682 sales**, and every one of the
93 closings, 93 daily reports, 12 expenses, 8 purchases and 4 transfers, carry
`demo: true`. Nothing in `src/` filters that flag.

This is not cosmetic. `src/lib/suggest.js` builds tomorrow's baking quantities
out of those invented closing reports — real flour and real money ordered
against imaginary demand — and the P&L, the margin card and the days-left
figures all read the same fiction.

`scripts/demo-day.mjs --clear` did not finish the job either: it omitted
`expenses` entirely, leaving around **Rs 346,000** of fabricated wages and bills
in the owner's profit figure *after reporting success*, and the raw-material
counts it writes carry no flag to find them by. Both fixed, plus the clear now
prints what is **left** in every trading collection instead of only what it
removed, and exits non-zero if anything is.

### 3 · The PINs

Production was seeded once, on 2026-08-04 — four days *before* the commit that
made seeding a live project refuse to run without PINs from the environment. The
seed committed at that time hardcoded `pin: '1111'` for the owner.

There is no PIN-change screen anywhere in the app, and the Auth password is a
hash of the PIN, so it cannot have been rotated from the console. `/users` is
world-readable by design (the login screen lists staff before anyone signs in)
and the Owner button appears on every outlet's tablet.

**Do not test this to find out.** It has to be rotated either way, so the answer
changes nothing. Step 9 rotates it.

### 4 · Staff permissions

Every security rule reads the **token**, not the `/users` document. The only
thing that writes those custom claims is `syncStaffClaims`, which is undeployed,
and the seed, which only knows five hardcoded ids.

So "Add person" in Catalog creates a real, permanent, undeletable account that
signs in perfectly and then has every write refused. Until 2026-08-13 that
refusal went to `console.error` on a tablet nobody will ever open the console
of, so a cashier got a printed receipt for a sale that never reached the server.
It now reaches the owner's Faults card — but the underlying fault is still there
until the claims sync runs.

The mirror image is as bad: "Turn off" writes `active: false` to the document
only, so a dismissed cashier's existing session keeps full write access at their
branch until the token expires.

### 5 · The sale id — fixed

`saleDocId` was the till letter (defaulting to `'A'`) plus a `localStorage`
counter. Two tablets at one outlet, or one mid-day "Reset this tablet", and the
next write landed on an id that already existed. `setDoc` with no merge reads as
an update, the rules allow only a void or a payment fix to change a sale, so it
was refused — and Firestore rolled the **new** sale back out of the local cache.
The earlier sale survived. The one just rung up vanished from the till's own
list and from the close, with no message to anyone. Cash in the drawer, no
record, and a drawer that read over at close with nothing to explain it.

Sale ids now carry a per-install token that a storage wipe re-mints, which makes
the collision structurally impossible. `scripts/ids.test.mjs` covers all three
ways it used to happen.

---

## The order to do it in

### 1 · [owner] Enable Blaze, with a budget alert · 15 min

On `bakers-inn-pk`. Set a spending cap — three outlets sit inside the free tier,
so an alert that ever fires means something is wrong, not that the bakery grew.

Everything below assumes this is done. If it is refused, step 3 becomes about
two hours of workaround instead of ten minutes, and the bakery depends on
GitHub's free cron permanently.

### 2 · [dev] Deploy the fixes · 5 min

```bash
npm test && npm run build && firebase deploy --only hosting --project bakers-inn-pk
```

### 3 · [dev] Deploy the server code · 10 min

```bash
firebase deploy --only functions --project bakers-inn-pk
firebase functions:list --project bakers-inn-pk
```

Five functions should be listed. This kills the wrong-date compile, the
wrong-date reports, the missing claims sync and the missing on-close report in
one command. Then either delete `.github/workflows/daily.yml`, or keep it as a
documented backup — it is correct now either way.

*If Blaze was refused:* add the service-account JSON as a repository secret
named `FIREBASE_SERVICE_ACCOUNT`, then write `scripts/set-claims.mjs` mirroring
`functions/index.js` across all of `/users` and add it as a third step in the
workflow, exposed on `workflow_dispatch` so a same-day hire can be made to work.

### 4 · [dev] Turn on the safety net · 20 min

**Before touching any data.** Steps 6 to 10 all run with an admin key that
bypasses every security rule.

```bash
firebase firestore:databases:update "(default)" --delete-protection ENABLED --point-in-time-recovery ENABLED --project bakers-inn-pk
```

Then take a full read-only JSON dump of every collection to a local file. The
recovery window on this database is currently **one hour**.

### 5 · [dev] Deploy the rules and indexes · 2 min

```bash
firebase deploy --only firestore:rules,firestore:indexes --project bakers-inn-pk
```

### 6 · [dev] Clear the demo data · 1 hr · *destructive*

```bash
SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json node scripts/demo-day.mjs --clear
```

It now prints anything left behind with no `demo` flag to remove it by, and
exits non-zero if there is any. Expect it to name a few: a sale and two demands
written by hand while testing, and a product "Sweet Candy" (code 54) that would
otherwise appear on all three tills — archive that one in Catalog.

**Do not go past this step until it reports every collection empty.**

### 7 · [owner + dev] The data session · 2–3 hrs

Sit down together. Write it on paper first — it doubles as the owner's training.

- The three **real outlet names**. They are currently Main Outlet, Gulberg and
  Model Town, which are placeholders.
- Every **staff member**: real name, role (owner / cashier / specialist), outlet.
- The **real selling price** for all 44 items. The seeded prices are
  round-number guesses.
- The **real cost per unit** for the 9 raw materials.
- The **opening cash float** for each outlet.
- Which items are **sold by weight**, and in what unit. No product currently has
  this set.
- Which items are **re-priced each morning** (eggs and bread were the example).
- `sellsNextDay` per item — what is still sellable tomorrow versus what is stale
  tonight. **This is currently a developer's guess** and it decides what gets
  counted as waste every single night.

### 8 · [owner] Everyone chooses their own PIN · 20 min

Privately, one person at a time, told only to whoever is doing step 9. Not four
digits anyone at the counter could guess, and **not over WhatsApp**.

There is no PIN reset in this system — PINs are never stored, so a forgotten one
needs a laptop with the admin key.

### 9 · [dev] Re-seed with the real roster · 40 min · *destructive*

Edit `BRANCHES` and `STAFF` in `scripts/seed.mjs`, then run with every `PIN_*`
supplied in the environment — it refuses to touch a live project otherwise, and
existing accounts are updated in place. This is what rotates the owner off
`1111`.

Then confirm every person's claims actually synced before anyone relies on it.

### 10 · [owner + dev] Enter the catalogue through the app · 1–2 hrs

Not through the seed. Prices, weighed items, daily rates, `sellsNextDay` — doing
it in Catalog means every change is stamped, and the owner learns the screen
while doing it.

Then write **one closing document per outlet, dated the day before opening**,
carrying that outlet's real float. Without it the float is zero, every outlet's
first close reports a large unexplained surplus, and a blank field propagates
forward.

### 11 · [dev] Set up each tablet · 30 min each

On the wifi **at the counter**, not by the door:

1. Open the URL in Chrome → **Add to Home Screen**.
2. Open it from the home screen, not from Chrome.
3. Run Setup: the right outlet, and a **till letter no other tablet at that
   outlet is using**.
4. Sign in once, so the catalogue caches.
5. Write the till letter on the back with a marker.
6. **Turn the wifi off and ring a test sale.** A tablet that has never been
   online has an empty product list and cannot sell.

### 12 · [both] One full dry day · a day

The only step that proves the whole loop, and the one thing no amount of code
reading substitutes for.

- **Evening:** submit tomorrow's order from each outlet through the close wizard.
- **Next morning:** confirm the 05:00 job produced `PO-<today>` — *today's* date,
  not yesterday's — that Bake shows the list, and that Dispatch shows delivery
  notes for both shops.
- Ring ten sales, void one, refund one, close the day.
- Check the owner's dashboard, and the 06:00 report the following morning.
- **Then delete every document the dry run created**, with the admin key.

### 13 · [owner] Train, and hand out one card per outlet · 2 hrs

The four screens staff actually touch: Sell, Close Day, Bake, Dispatch. Use the
words already on the shop's own printed sheet — Existing Stock, Addition Stock,
Stale, Remaining Stock, Closing Sale — because the close wizard does.

One card at each counter:

> - Never clear this tablet's data or storage. Never sign out.
> - If the app says it cannot start, tap **Try again** first, not Reset.
> - If Bake is empty at 05:15, phone [dev].
> - The day's takings are safe even with no internet. Do not re-ring a sale
>   because the screen looked slow.

### 14 · [dev] Watch the first week

Every morning, check the daily report against what each outlet says it took, and
check the owner's Faults card. The first week is when a wrong price, a missing
rate sheet or a mis-lettered till shows up, and all three are cheap to fix on day
two and expensive to unpick on day thirty.

---

## Known and accepted

Not blockers. Worth knowing before somebody reports one as a bug.

- **No PIN reset.** Needs a callable Cloud Function using the Admin SDK.
- **A four-digit PIN with no lockout**, and the Owner button on every outlet's
  tablet. Worth dropping Owner from the outlet lists and adding a backoff.
- **The order suggestion ignores stock already on the shelf.** It answers "how
  much does this weekday need", not "how much more do we need", so for items
  that carry over it reads slightly high.
- **Gross margin is business-wide, not per outlet.** Without recipes there is no
  honest way to split a sack of flour. The card says so on screen.
- **There is no thermal-printer support.** Printing is `window.print()` and the
  app is set up for A5. Options: a network printer Android can already see
  (works today, change nothing), an 80mm roll printer that speaks Android print
  (flip `RECEIPT_PAPER` in `src/config.js`), or a Bluetooth/USB thermal printer
  (needs new code). Whichever is chosen, run fifty real receipts through it.
- **The Flutter app in `mobile/` has no till, close, bake or dispatch** — every
  screen it offers already exists in the web app, which is installable on the
  owner's phone. It has four open defects and its tests have been red since
  2026-08-12. Decide whether to keep it before spending anything on it.
- **A late close cannot be finished through the wizard's Next button.** Once the
  05:00 job locks today's demand there is no Send button to press, so the step-3
  gate never satisfies. Tapping step 4 directly works.
- **GitHub disables scheduled workflows after 60 days of repository
  inactivity** — which is exactly what a finished handover looks like. Another
  reason to be on real Cloud Functions.
