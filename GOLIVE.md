# Going live

Everything between "it is deployed" and "the bakery runs on it".

The app is deployed at **https://bakers-inn-pk.web.app** and has never traded a
real day. This file is what stands between that and a first morning, in the
order it has to happen — several steps destroy the work of later ones if run
early.

**Last updated 2026-08-20**, after a full simulated day was run through the
screens from an empty database.

---

## Where it stands

**The developer's side is done, as far as anything can be proved without a real
shop.** Blaze is on, five Cloud Functions are live in `asia-south1`, the rules
and hosting are deployed, delete protection and 7-day point-in-time recovery are
enabled, and the daily loop has been walked end to end across all three roles.
350 logic tests, 76 rules tests, and a linter, all green in CI on every push.

**What is left is the owner's data, one dry day, and two decisions.** None of it
can be done from a keyboard here.

> ### Read this before trusting anything below
>
> For eleven days this file said "built, tested and deployed" and that only the
> owner's steps remained. Both were false. The suite was green and the deploy
> succeeded while the chain from the oven to the shelf was broken in six places
> at once. Everything found since was found by *signing in as a person and doing
> the day* — never by reading code and never by a passing test.
>
> **Step 5, the dry day, is not a formality at the end of a list. It is the
> first time this system will be asked to do a day's work.**

---

## The short version

| | What | Who | Rough |
|---|---|---|---|
| 1 | Clear the trial data now sitting in the live database | dev | 15 min |
| 2 | The data session — prices, people, floats, accounts | owner + dev | 2–3 hrs |
| 3 | Everyone picks their own PIN, and the owner's is rotated | owner | 40 min |
| 4 | Set up each tablet at its counter | dev | 30 min each |
| 5 | **One full dry day** | both | a day |
| 6 | Train, hand out the counter cards | owner | 2 hrs |
| 7 | Watch the first week | dev | daily |

Two decisions are needed from the owner along the way: **which printer**, and
**what a line on his daily pad covers**. Both are described under Open questions.

---

## 1 · [dev] Clear the trial data · 15 min · *destructive*

**The live database is not empty.** Testing over the past fortnight has left
real-looking records in `bakers-inn-pk`:

    sales             9   (five from 17 Aug flagged demo, four from 19 Aug NOT flagged)
    closings          3   (two reopened, one flagged demo)
    demands           2   (one locked for 20 Aug)
    productionOrders  1   (PO-20260820, marked done)
    dailyReports      2   (17 and 19 Aug)
    purchases         1
    expenses          1
    products         45   (44 seeded plus one added while testing)

The four sales from 19 Aug and both closings from 19 Aug carry **no `demo`
flag**, so `demo-day.mjs --clear` will not find them — it queries
`where('demo', '==', true)` and nothing else. They have to go by hand, or the
owner's very first dashboard shows **Rs 4,900** of takings that never happened
and a bake that never came out of an oven.

The script does at least say so: it prints what is left with no flag to remove
it by, and exits non-zero if anything is. Read that list rather than the
"Removed N records" line above it.

```bash
SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
  node scripts/demo-day.mjs --clear
```

Then delete what is left by hand and confirm every trading collection reads
zero: `sales`, `closings`, `demands`, `productionOrders`, `transfers`,
`dailyReports`, `purchases`, `expenses`, `stockMovements`, `dailyRates`.
Check `products` is back to the real count and archive the stray one.

**Do not go past this step until every trading collection is empty.**

---

## 2 · [owner + dev] The data session · 2–3 hrs

Sit down together. Write it on paper first — it doubles as the owner's training.

- **Every staff member**: real name, role (owner / cashier / specialist), outlet.
- **The real selling price for all 44 items.** The seeded prices are
  round-number guesses and every figure in the system is built on them.
- **`sellsNextDay` per item** — what is still sellable tomorrow versus what is
  stale tonight. This is currently a developer's guess and it decides what gets
  counted as waste every night.
- **Which items are sold by weight**, and in what unit. Only Biscuits (code 35)
  is set today. The whole system now counts these in the unit they are sold in,
  so getting the list right matters.
- **Which items are re-priced each morning** (eggs and bread were the example).
- **The opening cash float** for each outlet.
- **Each outlet's address and phone** — these print on every receipt.
- **Each outlet's JazzCash / Easypaisa / bank details.** The till refuses those
  methods until they are set, deliberately: a wrong account number on a till
  sends a customer's money to a stranger.
- **The real cost per unit** for the 9 raw materials, and the opening stock of
  each. Until stock is entered the dashboard says so rather than pretending.

Outlet names are already settled from the owner's own sheet: **Susan Road** (the
hub), **Gulberg**, **Gulistan Colony**. Susan Road is `MAIN` because it keeps
part of the bake rather than being delivered to.

Enter the catalogue **through the app**, not the seed — every change is stamped,
and the owner learns the screen while doing it.

Then write **one closing document per outlet, dated the day before opening**,
carrying that outlet's real float. Without it the float reads as zero and every
outlet's first close reports a large unexplained surplus.

---

## 3 · [owner] PINs · 40 min

Everyone chooses their own, privately, one person at a time, told only to
whoever is doing the seeding. Not four digits anyone at the counter could guess,
and **not over WhatsApp**.

**The owner's PIN must be rotated.** Production was seeded on 2026-08-04, before
the seed refused to run against a live project without PINs from the
environment, and that seed hardcoded `1111`. It has never been changed. Do not
test whether it still works — it has to be rotated either way.

```bash
PIN_OWNER=**** PIN_… SEED_PROJECT=bakers-inn-pk \
  GOOGLE_APPLICATION_CREDENTIALS=…/key.json npm run seed
```

Edit `BRANCHES` and `STAFF` in `scripts/seed.mjs` first. Existing accounts are
updated in place. Never put a real PIN in that file — git keeps every version
for as long as the repository exists.

Then confirm every person's claims synced, because the rules read the token and
not the document:

```bash
SEED_PROJECT=bakers-inn-pk GOOGLE_APPLICATION_CREDENTIALS=…/key.json \
  node scripts/check-claims.mjs
```

A forgotten PIN is no longer a crisis: Catalogue → People → Edit sets a new one.
Nobody can look an existing one up.

---

## 4 · [dev] Set up each tablet · 30 min each

On the wifi **at the counter**, not by the door:

1. Open the URL in Chrome → **Add to Home Screen**.
2. Open it from the home screen, not from Chrome.
3. Run Setup and pick the right outlet. Leave the till letter on **A** — each
   shop has one till, so there is nothing to tell apart.
4. Sign in once, so the catalogue caches.
5. **Turn the wifi off and ring a test sale.** A tablet that has never been
   online has an empty product list and cannot sell.
6. Void that test sale, or clear it in step 1's sweep.

**One tablet, one person, one tab.** Two tabs signed in as different people
share a single Firestore connection, and every read goes out under whichever tab
owns it — which produces a flood of permission errors on rules that are
perfectly correct. A real till is one tab; this is a hazard for whoever is
testing, not for the shop.

If a shop ever gets a second till, give it letter **B** at setup.

---

## 5 · [both] One full dry day

The only step that proves the loop, and the one thing no amount of code reading
substitutes for. Run it exactly as a real day, with the paper pad going
alongside, and **nothing depending on the result**.

**The evening before**

- Each outlet sends tomorrow's order — Stock tab, or step 3 of the close.

**Overnight or first thing**

- The baker opens **Bake** and presses *Make the list*. There is no scheduled
  job any more: he chooses which day he is baking for, and the screen shows how
  many orders are in for each. Tomorrow is the normal answer, because a shop
  sends its order at closing time.
- He records what actually came out of the oven, line by line. Deliberately
  record one line **short** to see the shortfall appear on Dispatch.
- Add a tray nobody ordered, so the extras path gets used.
- Press *All recorded — send to Dispatch*.

**The van**

- On **Dispatch**, adjust the short line between the two shops by hand and send
  both notes. Give some of the spare tray to one shop.
- Each shop should see a banner and a count on its **Stock** tab.

**At the shops**

- Count the delivery in. Change one line so it does not match, and check it
  demands a reason.
- Ring ten sales: cash, card, something sold by weight, a one-off typed into the
  search bar. **Void one. Refund one.**
- Check the shelf figure on the Stock tab moves as things sell.

**Closing**

- Count the drawer. Put a deliberate error in on one till and check it reports
  over or short.
- Count the leftovers, send some back to the hub, order for tomorrow, close.
- At the hub, confirm what came back on **Dispatch**.
- Close the hub last.

**The morning after**

- The owner's **Dashboard** and **Stock** report — do the figures agree with the
  paper pad? Print the register and check the fortnight.
- Check the 06:00 report ran.

**Then delete every document the dry run created**, with the admin key, and
confirm the collections are empty again before the real first day.

---

## 6 · [owner] Train, and hand out one card per outlet · 2 hrs

The four screens staff actually touch: Sell, Close Day, Bake, Dispatch. Use the
words already on the shop's own printed sheet — Existing Stock, Addition Stock,
Stale, Remaining Stock, Closing Sale — because the close wizard does.

There is a **practice mode** for teaching on: a tablet wired to the real system
where nothing counts. Everything it writes is stamped and hidden from every live
figure, and it goes back to normal on its own the next day. The catalogue, the
rates, Materials and Money are all locked while it is on, so a lesson cannot
change a real price.

One card at each counter:

> - Never clear this tablet's data or storage. Never sign out mid-shift.
> - If the app says it cannot start, tap **Try again** first, not Reset.
> - If Bake is empty when you start, press *Make the list* — nothing is waiting
>   on a clock.
> - The day's takings are safe with no internet. Do not re-ring a sale because
>   the screen looked slow.
> - Do not sign out while the offline strip is showing. It will say so.

---

## 7 · [dev] Watch the first week

Every morning: the daily report against what each outlet says it took, and the
owner's Faults card. The first week is when a wrong price, a missing rate sheet
or a mis-lettered till shows up, and all three are cheap to fix on day two and
expensive to unpick on day thirty.

---

## Open questions for the owner

**Which printer?** Printing is `window.print()` and the app is set to A5. Three
options: a network printer Android can already see (works today, change
nothing), an 80mm roll printer that speaks Android print, or a Bluetooth/USB
thermal printer (needs new code). If the answer is 80mm, note that
`@page { size: 80mm auto }` in `src/lib/paper.js` is invalid CSS and is silently
dropped — it needs two lengths, e.g. `80mm 297mm` — and that the type sizes in
`config.js`'s comment do not match the numbers the code applies. **Whichever is
chosen, run fifty real receipts through it.**

**What does a line on the daily pad cover — the day's clock, or the day's bake?**
The dashboard's daily sheet reads today's transfers and today's production. A
shop orders at closing for the next day, so a normal night's work is filed under
tomorrow, and after a full bake the sheet showed Distribution Rs 0 and "the
kitchen has not made it yet" while the money half was perfect. The stock report
does not have this problem because it looks across three days, so two of his own
screens currently disagree about the same day. Fixing it means deciding what the
line means. Worth ten minutes with him and the pad.

---

## Still open, and known

Confirmed defects, none of which stops a first day. In rough order of what they
would cost.

**Money**

- **Only the last ten sales of the day can be corrected.** The till's recent
  list is capped at ten rows and the Fix button lives on those rows, so a
  mistake spotted after a busy hour cannot be voided, refunded or re-keyed
  anywhere in the app.
- **A refund always goes back by the method the customer originally paid.** A
  card sale refunded in cash is recorded as money returned to the card, so the
  drawer and the statement both disagree with reality.
- **Voids are stamped and never shown.** The system's bargain is that nothing
  needs approval because everything is visible to the owner — but the void
  reason and who did it appear on no screen, only in the accountant export.
- **Money's "on course for" scales by days *traded*, not days elapsed**, so
  going live mid-month projects a wildly high month until the month turns.

**Reports and paper**

- **The printed register values past days at today's prices.** Raise a rate on
  Thursday and Monday's production and distribution columns quietly go up while
  the sale figures stay historical, so the sheet stops adding up.
- **Money and goods can land on different business days.** A delivery counted in
  before 04:00 on the day it was baked *for* splits one bake across two days.
  A normal morning van avoids it; an overnight one does not. The stock report
  catches it and says so in plain words rather than hiding it.

**Screens on a bad connection**

- **The till ignores read errors.** Every other screen in the chain now says
  when it could not read; the till renders a refused or uncached read as an
  ordinary empty day, and a day closed on another tablet can be sold into.
- **Materials and the catalogue show an empty list as "nothing here yet"** on a
  cold cache, inviting duplicates of things that already exist.
- **The stale-sign-in check reports "fine" when it could not complete.**

**Catalogue**

- **"Add outlet" has no clash check.** Typing an existing code — `MAIN` is
  printed on the screen above the box — overwrites that outlet and forces
  `isMain` to false, which cannot be undone from inside the app.
- **Merging prices twice loses the first merge's alternative names.**

**Accepted, not defects**

- **A four-digit PIN with no lockout**, and the Owner button on every outlet's
  tablet. Worth dropping Owner from the outlet lists and adding a backoff.
- **The order suggestion ignores stock already on the shelf.** It answers "how
  much does this weekday need", not "how much more do we need", so for items
  that carry over it reads slightly high.
- **Gross margin is business-wide, not per outlet.** Without recipes there is no
  honest way to split a sack of flour. The card says so on screen.
- **The Flutter app in `mobile/` has no till, close, bake or dispatch.** Every
  screen it offers already exists in the web app, which installs on the owner's
  phone. Four open defects, tests red since 2026-08-12. Decide whether to keep
  it before spending anything on it.

---

## Already done

Kept short, because none of it needs doing again.

- **2026-08-14** — Blaze enabled; five Cloud Functions deployed and verified in
  `asia-south1`; delete protection and 7-day point-in-time recovery on; 1,900
  demo records cleared; the GitHub Actions cron deleted.
- **The 05:00 job is gone.** The baker makes the list from the Bake screen and
  chooses which day. A clock should not decide when a bakery starts work, and
  the old job silently built *yesterday's* list on a UTC runner.
- **Sale ids** carry a per-install token, so a cleared tablet can no longer mint
  an id that already exists — which used to destroy the sale just rung up.
- **Staff permissions** sync to the token automatically, and turning somebody
  off revokes their session rather than leaving it live until the token expires.
- **PIN reset** exists: Catalogue → People → Edit.
- **The goods loop** — delivery visible to the shop it is for, returns
  confirmable, extras dispatched at their real quantity, stock that comes back
  landing on the hub's books, a shop able to close its day.
- **Weighed goods** are counted in kilograms everywhere, not just on the till.
- **The till** caps a line, warns when it sells past what the shop is thought to
  have, and asks once before taking a bill that looks like a slipped finger.
- **A linter** in CI catches undefined names, which the build never did — it has
  caught three in one day, one of which had already shipped a blank till.
