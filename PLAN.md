# PLAN.md — Bakery Transaction & Management System

## 1. Executive summary

This is one simple web app that runs the whole bakery: the main outlet (kitchen + warehouse) and the two shop outlets, on cheap Android tablets, in a browser.

**What it does, every day:**

1. **You buy materials** and type the purchase into the app once. That's the only real typing in the whole system.
2. **Each shop orders tomorrow's stock** at closing time — not by writing, but by adjusting numbers the app already filled in from last week's same day.
3. **The app adds the three orders together** into one baking list. Nobody writes that list, ever.
4. **The bakers open the list**, bake, and tap each item done.
5. **The app pre-fills a delivery note per shop** from what each shop asked for. The driver taps Dispatch, the shop taps Received.
6. **At closing, each shop counts the drawer and the leftovers** — the app already knows what the numbers should be; staff only fix the differences. The full daily report writes itself and appears on your phone.

Then it repeats.

**The enter-once promise:** every product, material, person, and outlet is typed into the system exactly once and gets an ID. After that, everything is picking from lists, tapping numbers up or down, and confirming. A cashier cannot type a product name or a price — so a cashier cannot mistype one. A normal day across all three outlets is under a dozen taps of "actual" input.

**What you'll see:** live sales per shop on your phone, cash vs card, best sellers, what's being wasted and what it costs you, how much flour is left and how many days it will last — all without asking anyone anything.

**Cost:** roughly **$860–1,270 once** for tablets and receipt printers, and about **$20–40/month** running cost (mostly receipt paper; the software itself rides Google's free tier). No servers, no license fees.

**Timeline:** the main outlet sells on the system in about **3 weeks**. The full daily cycle — orders, baking list, deliveries, automatic reports — is live in about **3–4 months**, built in small steps where each step is used for real before the next begins.

**Two deliberate changes from our earlier discussion — please sign off:**

1. **Business-wide margin instead of per-outlet margin.** Without recipes (which we rejected as too complex), per-outlet material cost can't be computed honestly. The dashboard shows one true business-wide margin, plus per-outlet sales, waste, and transfer variance — honest numbers beat invented ones.
2. **Daily reports live on your dashboard instead of being emailed.** Same information, one less thing that can silently fail. Email delivery can be added later with a free extension if you ask for it.

---

## 2. Principles

1. **Simplicity beats everything.** Fewer screens, bigger buttons, no jargon. Before adding any module, first try a status field or a note on an existing record. If a screen needs more than one laminated page to explain, fix the screen.
2. **Enter once.** Every name, price, and person is typed exactly once, gets an ID, and becomes a button everywhere else. Downstream steps only pick, adjust pre-filled numbers, and confirm. Copying data automatically (denormalizing) is fine; making a human re-type it is never fine.
3. **Hub and spoke.** Main outlet buys, bakes, stores, and dispatches. Satellites request, sell, and report. All flows point through the hub; nothing moves without a record.
4. **Everything has an ID and an owner.** Every document has one human-readable ID, one sole writer, and a timestamp + user + outlet stamp. Nothing is ever deleted: mistakes are fixed with voids, adjustments, and notes. No approval queues anywhere — visibility replaces approval.

---

## 3. System overview

One responsive React web app (PWA, so it opens without internet), hosted on Firebase Hosting, talking to Firestore with offline persistence, with Firebase Auth for the ~8 accounts. Exactly **two** Cloud Functions — the daily compile and the daily report builder — are the only server code in the system (~200 lines). Everything else, including the dashboard, is computed client-side from small pre-aggregated report documents. Same app on every device; the user's role decides what they see.

Login is tap-your-name + 4-digit PIN. Under the hood each user is a real Firebase Auth account with a synthetic email and a PIN-derived password; the login screen does the mapping so staff never see it. Security rules resolve each user's role and outlet by reading their user record — no custom-claims machinery, no third Cloud Function, and the owner manages users entirely in-app.

**Stack: Firebase over Supabase in one line** — offline POS sync is the one feature that must never fail, and Firestore gives it built-in (local cache + write queue + auto-sync), while Supabase would require hand-rolling a sync engine, the riskiest code a solo dev can write. Supabase's advantage (SQL reports) is neutralized because reports are pre-compiled into documents.

---

## 4. Roles & screens

**9 screens total** (cap was 12). One app; the device remembers its outlet; login is tap-your-name + 4-digit PIN. Bottom tab bar, max 3 tabs. Status chips (Draft / Submitted / Dispatched / Received / Closed) are **read-only indicators**; only buttons advance state.

| # | Screen | Who | One line |
|---|---|---|---|
| 1 | **Login** | All | Outlet remembered per device; tap name, enter PIN — stamps everything after. |
| 2 | **Sell (POS)** | Cashier | Product tile grid → basket → Cash/Card → receipt; fully offline-capable; void/refund built in. |
| 3 | **Stock** | Cashier | Two cards: "Receive delivery" (satellites only, pre-filled transfer) and "Tomorrow's order" (editable until cutoff). |
| 4 | **Close Day** | Cashier | One 4-step wizard: cash count → leftover count → tomorrow's order → send; locks the day. |
| 5 | **Bake** | Specialist | Today's auto-compiled production order; tap rows done; produced pre-filled = needed. |
| 6 | **Dispatch** | Specialist only | One pre-filled transfer card per satellite; tap Dispatch. Inbound return cards from satellites appear here too — one tap to confirm next morning. (Not cashiers — one role, no ambiguity.) |
| 7 | **Dashboard** | Owner | Read-only: sales, cash/card, best sellers, waste, margin, stock days-left, alerts; drill into any day's report. |
| 8 | **Materials** | Owner | New purchase (pick-from-list), 3-button ledger (Received/Count/Spoilage), reorder warnings. |
| 9 | **Catalog & People** | Owner | Products, users (incl. on/off toggle), outlets — the single enter-once source; archive, never delete. |

Tabs — Cashier: **Sell** · Stock · Close Day. Specialist: **Bake** · Dispatch. Owner: **Dashboard** · Materials · Catalog & People, plus a header outlet-switcher to open any outlet's screens.

### Canonical daily timeline (fixes all date ambiguity)

> Demand for day **D** is submitted the **evening of D−1** (in Close Day). Compile runs at **05:00 on D**. Bake and dispatch: **morning of D**. Sell: **day D**. Close: **evening of D** (which submits demand for D+1). Screens label accordingly: Demand = "Tomorrow's order", Bake = "Today's order".

### Flow: checkout

Cashier taps product tiles (catalog-fed, best-sellers first) → basket totals live → Pay → Cash (quick-amount buttons, change auto-calculated) or Card → receipt prints via Bluetooth thermal printer (RawBT bridge). Offline: a thin grey "offline — will sync" strip; sales queue locally, sync silently. Zero typing. Void (same day): sale kept, status **voided**, reason picked from a 4-chip list. Refund (later): a negative sale referencing the original sale ID. Both work offline, both appear on the Z-report and owner dashboard.

### Flow: demand → compile → produce → distribute

1. **Demand** (evening, in Close Day step 3, editable later via Stock until cutoff): every outlet **including MAIN** gets a list pre-filled with last same-weekday's quantities plus a "sold 18/20 today" hint and a suggested quantity (moving average of sold + wasted). Normal day = glance, two stepper taps, Submit.
2. **Compile** (05:00, Cloud Function, runs **once** per day — no button to forget): sums all submitted demands into `PO-{date}` with per-outlet breakdown, locks demands, pre-creates **two** transfer drafts (satellites only — MAIN never transfers to itself). An outlet that didn't submit gets its last same-weekday demand auto-submitted and flagged "auto". Nobody types any of this.
3. **Produce**: specialist's landing screen is the order. Produced pre-filled = needed; adjust only differences; tap each row done. All done → PO flips to **done**; MAIN's per-outlet share becomes its sellable stock automatically; Dispatch unlocks.
4. **Distribute**: one card per satellite, pre-filled from that outlet's own demand. If production fell short, a "short by X" banner shows per product and the dispatcher adjusts numbers **by hand** — no allocation algorithm. Tap Dispatch → satellite's Stock screen lights up; cashier taps Confirm all (or adjusts a row, which requires a reason and flags the line **received-short**).

**First week per outlet (bootstrap):** there is no history yet, so demand steppers start blank, no suggestions show, and a missed cutoff means a phone call — not an auto-fill. Pre-fills, suggestions, and the auto-submit fallback all switch on once that outlet has 7 days of history.

The same demand numbers are reused four times — compile, bake, transfer, close reconciliation — without anyone touching them again.

### Flow: unified daily close (~3 minutes, one typed number)

**Step 1 — Cash.** Card total and expected cash shown (auto, including the opening float carried from yesterday's close). Cashier types the one number: cash counted in the drawer, **before** adding tomorrow's float. Over/short computed and colored. Float for tomorrow confirmed (defaults to same as today).
**Step 2 — Leftovers.** Only today's handled products, each pre-filled with expected leftover (received + carryover − sold). For perishables (product flag "sells next day? No") the default disposition is waste; for keepables it's carryover; keepables can instead be tapped "return to hub", which creates a pre-filled reverse transfer that MAIN confirms next morning on the Dispatch screen's inbound card. "All as suggested" for a normal day. Reason chips (stale/damaged/other) on waste lines only.
**Step 3 — Tomorrow's order.** Pre-filled demand (see above); Submit.
**Step 4 — Review & send.** Auto-compiled day card: sales, cash vs card, over/short, received vs sold vs wasted vs returned vs carryover, voids/refunds list, sell-through. One button: **Close day**. The day locks (edits need Owner role) and the report lands on the Dashboard.

Close is blocked until any pending inbound transfer is confirmed (one tap, pre-filled). Selling tomorrow is blocked until today is closed; a non-trading day is cleared with a one-tap **"no trade"** close.

---

## 5. Data model & IDs

Rules: line items are **embedded arrays** in their parent (5–30 lines — one read, atomic writes); names and prices are **copied into lines at creation** so history never changes when the catalog does and everything renders offline. Copying by the app is not re-typing by a human.

| Entity | Key fields |
|---|---|
| **Branch** `MAIN/B2/B3` | name, isMain |
| **User** `{authUid}` | name, role (owner/cashier/specialist), branchId, active |
| **Product** | name, category, price, **sellsNextDay** (yes/no — drives close defaults and return eligibility), active |
| **RawMaterial** | name, unit, costPerUnit, reorderLevel, onHand (running balance) |
| **Purchase** `P-0728-01` | businessDate, items[{materialId, materialName, qty, unitCost}], total, createdBy, editHistory |
| **StockMovement** | branchId, materialId, type received/count/spoilage, qty, businessDate, purchaseRef?, note |
| **Demand** `D-0729-B2` | branchId, businessDate, status, flags (auto/late/consumed), items[{productId, productName, qty}] |
| **ProductionOrder** `PO-0729` | businessDate, status, items[{productId, productName, qtyNeeded, perOutlet{}, qtyProduced, producedBy}], compiledFrom[] |
| **Transfer** `T-0729-B2`, `-2`, `-R` | fromBranch, toBranchId, businessDate, status, poRef, direction (out/return), items[{productId, productName, qtyDemanded, qtySent, qtyReceived, shortReason?}] |
| **Sale** | ref `S-B2-0729-A017`, branchId, businessDate, payment, status (normal/voided), refundOf?, items[{productId, productName, price, qty}], total, cashierId, localAt, createdAt |
| **Closing** `C-0729-B2` (one doc per outlet per day: cash-up **and** waste together) | countedCash, float, overShort, wasteItems[{productId, qty, reason}], returns[], status (closed/closed-late/no-trade), closedBy |
| **DailyReport** `R-0729-B2` | function-written, read-only: totals (sales/cash/card/txCount), byProduct[{received, sold, wasted, returned, leftover, revenue}], wasteValue (at retail), transferVarianceValue, sellThroughPct |

**ID scheme — no global counter** (global counters and offline devices don't mix):

- Natural keys where there is exactly one per outlet per day: `D-0729-B2`, `C-0729-B2`, `R-0729-B2`, `PO-0729`. Collision-free by construction, generatable offline, and what makes report recomputation idempotent.
- Transfers can legitimately repeat in a day (a second emergency top-up, a return), so they carry a suffix: `T-0729-B2` (first), `T-0729-B2-2` (second same-day), `T-0729-B2-R` (return). All created at MAIN or by the compile function — a single writer, so the sequence is safe.
- Single-writer counters where there's one writer: purchases `P-0728-01` (owner only), sales `S-B2-0729-A017` (per-device counter with a one-letter device prefix set once at setup — a second till becomes `B-…`, no coordination).
- Firestore doc IDs for sales/movements stay auto-IDs; the human ref is a display field.

**Traceability chain:** `P-0728-01` → auto-created received movements → *(date-based association only — with recipe depletion explicitly rejected, there is deliberately **no** hard ingredient link from purchases to production; purchases and POs share dates, and nobody should "fix" this later with ingredient mapping)* → `PO-0729` (compiledFrom: D-0729-MAIN/B2/B3) → `T-0729-B2` (poRef) → sales and `C-0729-B2` by branch + businessDate → `R-0729-B2`. Traceable both directions with plain queries.

**Business date** is stamped by the client **at creation** — a sale rung offline at 19:50 and synced at 08:00 lands on the right day. A day ends at the Close tap, not midnight.

**Derived numbers, defined once:** MAIN's "received" = **produced − sum dispatched** (qtyProduced − Σ qtySent), so it stays true on shortfall days and matches the reconciliation formula. Satellites' "received" = transfer qtyReceived. "Sold" everywhere means **net of voided sales** — a voided sale vanishes from every total but stays listed on the report. Refunds reduce revenue but **never restock automatically**; if a refunded item comes back sellable it simply gets counted in that evening's leftovers, which is where physical reality always wins. Waste is valued at retail price. **Gross margin is business-wide** = sales − material purchases for the period − waste at retail (per-outlet material cost doesn't exist without recipes; per-outlet the dashboard shows sales, waste, and transfer variance). Material usage = received − counted, from the periodic Count. A Count is entered as the **absolute counted number**; the app computes the adjustment delta and sets onHand — no math for humans.

**Sole-writer table** (conflicts avoided by design, never resolved):

| Document | Sole writer |
|---|---|
| sales, stockMovements | append-only — conflicts impossible |
| demands | that outlet's device (until compile); the compile function locks them and writes `auto` demands |
| productionOrder qtyProduced/status | specialists, on the one kitchen tablet (plus the whitelisted late-demand pull-in) |
| transfer qtySent/dispatch fields | MAIN (specialist) |
| transfer qtyReceived/receive fields | receiving outlet |
| closings | that outlet's device |
| PO creation, dailyReports | Cloud Functions only |
| catalog, materials, users, purchases | owner only |

**Security** (Firestore rules; role + branch resolved by reading the caller's user record): **no document is ever deleted, by anyone.** Sales and movements are append-only *except* two whitelisted fields — `sale.status` (void) and `sale.payment` (the cash↔card flip) — both stamped. Purchases are owner-editable with automatic `editHistory`. Cashiers create sales only for their own branch and read only their branch's money. Specialists may update only `qtyProduced` and status on the PO, plus the **one-tap late-demand pull-in** — a whitelisted rule that updates `qtyNeeded`/`perOutlet` and the matching transfer draft in one batch, not a free edit. On transfers, MAIN may write only the dispatch-side fields and the receiver only the receive-side fields. Reports are read-only to everyone. Net effect: a stolen tablet can only add sales to its own outlet.

---

## 6. Status flows

- **Demand:** `draft → submitted → locked` (compile locks). Flags, not states: `auto` (compile self-filled it), `late` (submitted after cutoff), `consumed` (pulled into today's PO).
- **ProductionOrder:** `open → done`. Progress is visible from the qtyProduced numbers themselves.
- **Transfer:** `draft → dispatched → received`. Line-level flag `received-short`. Same machine for return transfers (outlet → MAIN).
- **Sale:** `normal → voided` (same day). Refunds are new negative sales — no state change on the original.
- **Day (Closing):** `open → closed`, with variants `closed-late` and `no-trade`.

No cancelled/rejected/approved states anywhere. A bad day is fixed with quantities and notes, not workflow.

---

## 7. Operational policies

1. **Production shortfall:** transfers stay pre-filled with each outlet's demand; a "short by X" banner shows per product; the dispatcher adjusts by hand. No algorithm. Demand vs sent stays visible side by side forever.
2. **Transfer discrepancy:** receiver enters the counted number; if ≠ sent, a short reason is required and the line flags received-short. Both numbers kept forever. Never counted as outlet waste — but its value **is** shown in the owner's loss view so crushed goods don't vanish from the money picture.
3. **Unsold at close:** perishables → waste count (that IS the disposal record). Keepables → carryover by default, or "return to hub" → reverse transfer (`T-…-R`) that MAIN confirms next morning on the Dispatch screen's inbound card; a "returned" line auto-fills into the daily report so the reconciliation math stays true.
4. **Voids/refunds:** allowed without approval, stamped with name + time, listed on the Z-report and dashboard. Nothing is ever deleted.
5. **Price changes:** owner edits anytime; devices pick it up at next sync; every sale line stores the price actually charged. No versioning, no effective dates.
6. **Wrong payment type:** one stamped tap flips cash↔card on any sale, before or after close, listed on the report. One procedure, not two.
7. **Missed cutoff:** compile auto-uses that outlet's last same-weekday demand, flagged (once a week of history exists — before that, it's a phone call). A late demand never rolls forward: if urgent, the specialist pulls it into today's PO with **one tap** (replacing the auto-fill, marking it consumed — no hand-typed bump); otherwise tomorrow's fresh demand supersedes it.
8. **Forgot to close / forgot to confirm receipt:** the Sell screen blocks until yesterday is closed (close it right there — count before adding today's float; report flags closed-late). Close itself blocks until pending transfers are confirmed. Non-trading days: one-tap "no trade" close.
9. **Dead device:** cloud logins — sign into the spare tablet (kept at MAIN, pre-configured) and keep selling in minutes. Gap sales go on the paper pad and are rung through the **normal Sell screen** later; "recovered — device down" is a note on the day's report, not a batch-entry screen.
10. **Sold out mid-day:** phone MAIN; if the hub has stock, it creates a second small transfer (`T-…-2`) from the same Dispatch screen. Two transfers that day — no emergency feature.
11. **Bake-ahead items (cakes):** the demand line carries a date (defaults tomorrow); compile groups by delivery date and writes into `PO-{deliveryDate}` — if that future-dated PO already exists (even in progress), compile only **adds lines or raises `qtyNeeded` on lines specialists haven't touched; it never rewrites `qtyProduced`.** PO creation stays function-only; the specialist's pull-in is a whitelisted update to an existing PO. The order itself is the tracking — no warehouse module.
12. **Purchase corrections:** owner edits any purchase line anytime; old value, who, and when are kept automatically with a small "edited" marker. No reversing entries, no lock periods.
13. **Purchases auto-post to the ledger:** saving a purchase writes its received movements in the same batch. The manual Received button exists only for rare non-purchase receipts (gifts, returns from a supplier).
14. **No approvals, ever:** everything in the daily cycle proceeds immediately, stamped, and surfaces on the dashboard after the fact. If the owner is on a plane, the bakery runs identically.

**Staff cheat sheet:**
- Never delete, never retype — fix with a void, an adjustment, or a note.
- The screen is pre-filled with what *should* be true; count what's in front of you and enter the real number.
- Reasons are asked only where they matter: received-short lines, voids, refunds, waste. Everywhere else, just adjust and go.
- Can't sell? Close yesterday first — the app tells you.
- Device dead? Spare tablet, keep selling; paper pad for the gap, ring them in later.
- Sent ≠ received? Enter your count, pick a reason — done. Not your waste.
- Unsold at close: perishables = stale count; only "sells next day" items carry over or go back to the hub.
- Missed the order cutoff? The app used last week's numbers; call MAIN if today needs different.
- Voids and refunds need no permission — but the owner sees every one, with your name on it.

---

## 8. Build phases

| Phase | Delivers | Effort |
|---|---|---|
| 1 | Catalog + POS pilot at MAIN | 13–16 days |
| 2 | POS at all 3 outlets + Dashboard v1 | 5–6 days |
| 3 | Daily loop: demand → compile → produce → distribute | 10–12 days |
| 4 | Unified close + auto daily report | 6–7 days |
| 5 | Materials ledger + margin + CSV export | 7–8 days |
| | **Total** | **~41–49 working days (~3–4 calendar months incl. rollout gaps)** |

**Phase 1 — Catalog + POS pilot at MAIN (13–16 days).** Firebase setup with security rules from day one; catalog (enter-once source); POS with offline queue-and-sync; **void/refund** (incl. offline behavior: both are local writes that sync like sales); receipts via RawBT + Bluetooth ESC/POS thermal printer; Close Day v1 with **opening float auto-carried** from yesterday; data seeding with the owner (~2–3 hours, doubles as training: 3 branches, ~8 users, 30–80 products from his current price list — the last time those names are ever typed). *Done when:* a cashier sells a full real day paperless; an airplane-mode sale syncs onto the correct business day; Z-report matches the drawer two days running; owner changes a price centrally and the POS updates; a cashier login sees only Sell/Stock/Close; a void made offline appears correctly on the Z-report.

**Phase 2 — All outlets + Dashboard v1 (5–6 days).** Branch-scoped logins for B2/B3 (same code, different branchId); read-only phone dashboard: today per outlet, over time, best sellers, cash vs card. *Done when:* all 3 outlets complete a real day; dashboard totals exactly equal the three Z-reports; the owner checks it unprompted.

**Phase 3 — Daily loop (10–12 days).** Demand screen (pre-filled, incl. MAIN, with first-week blank-slate bootstrap); the **compile Cloud Function** (scheduled at cutoff, runs once, locks demands, auto-fills missing outlets once history exists, creates two transfer drafts); Bake screen; Dispatch with shortfall banner and manual adjust; receive confirmation; late-demand pull-in; ID chain visible on every record. *Done when:* one full real day runs with zero retyping — every number picked, summed, or pre-filled; three demands sum to the PO exactly; a shortfall day is dispatched with hand adjustments and both numbers visible; MAIN's share appears as its own stock with no self-transfer; the specialist needs no help on day 2.

**Phase 4 — Unified close + auto report (6–7 days).** Close Day grows to the 4-step wizard (cash, leftovers with perishable/keepable defaults and returns, tomorrow's order, send); Closing doc; the **report Cloud Function** (on close + 06:00 re-run to absorb overnight syncs — reports converge on their own); dashboard v2: waste %, waste value, top wasted, sell-through, transfer variance, suggested quantities pre-filling demand. Reports live on the dashboard — **no email** (no extra failure mode; add the free email extension later only if he asks). *Done when:* all 3 reports appear nightly for a week with no manual step; received − sold − wasted − returned = leftover reconciles at satellites **and** produced − transferred − sold − wasted reconciles at MAIN; next morning's demand shows suggestions accepted in one tap each.

**Phase 5 — Materials + margin (7–8 days).** Purchase entry (pick-from-list; typing only for a brand-new material, which then joins the list forever; "repeat last purchase" clones the basket); auto-posted received movements; Count (absolute number, app computes delta) and Spoilage; days-left + low-stock alerts; **business-wide gross margin** tile with its formula shown; month CSV export (sales, purchases, daily summaries) for the accountant. *Done when:* re-buying flour takes under 15 seconds; a weekly count updates days-left and fires a low-stock alert; the owner can explain where the margin number comes from; the accountant asks for nothing retyped.

**Hardware checklist (one-time):**

| Item | Cost |
|---|---|
| 10" Android tablet ×3 (Chrome, app pinned) | $360–540 |
| Stand + charger routing ×3 | $60 |
| Bluetooth thermal printer 58/80mm ESC/POS + RawBT ×3 | $180–360 |
| Starter receipt paper ×3 | $30 |
| Cash storage | keep existing boxes — $0 |
| MAIN extras: kitchen tablet + pre-configured spare | $230–280 |
| **Whole business** | **~$860–1,270** |

Test the exact tablet + printer combo during Phase 1 **before** buying the other two sets.

**Monthly running cost:** Firebase (Blaze, at/near free tier) $0–10 · domain ~$1 · receipt paper $15–30 → **~$20–40/month** (ceiling $50). Budget alert set at $25 so a bug can never silently run up a bill.

**Testing (solo-dev triage):** automate only security-rules tests and pure-function money math (compile sums, cash-up, reconciliation). A ~30-minute manual "golden day" script before every release: seed → 3 demands → compile → produce 10% short → dispatch/receive → sell (one offline, one void, one refund) → close all → verify report and dashboard by hand. Test once on real hardware: airplane-mode sync, two devices at one outlet, a 23:55 sale landing on the right business day, printer Bluetooth reconnect. Skip: UI/E2E automation, cross-browser, load tests.

---

## 9. Rollout & training

1. **Weeks 1–3:** build Phase 1; owner seeds data and trains during the build.
2. **MAIN POS go-live:** 3 days parallel with paper; drop paper after 2 consecutive matching nights.
3. **Satellites one at a time** (never both the same day — you can only firefight one place): 2 days paper-parallel each.
4. **Daily loop go-live:** 3 days with the old phone-call method alongside; owner cross-checks quantities; drop it after one full day needs no correction.
5. **Phases 4–5 are additive** — no parallel run needed.
6. Every go-live on the quietest weekday, dev present (or on call) for the morning rush and first close.

**Training** (real catalog data in a practice day the dev deletes after — no training mode to build): Cashier 30–45 min hands-on (5 sales, one void, one practice close); Specialist 15–20 min; outlet senior 20 min (order + receive); Owner 2×1 hr (catalog/purchases, then dashboard/reports). One laminated page per role, taped next to the tablet. If a role needs more than one page, the screen is too complicated — fix the screen.

**After launch:** dev checks the console 10 min/day the first month, then ~half a day/month. Weekly Firestore export to Cloud Storage (8 weeks kept); quarterly restore test — an untested backup is not a backup. Owner self-serves catalog, prices, user on/off (in Catalog & People), and purchases. Change requests batch monthly and must pass the founding question first: *can this be a status field or a note instead?*

---

## 10. Risks

1. **Offline sync bugs eat sales** — use Firestore's built-in sync only (no custom sync code), append-only sales, client-stamped business dates, airplane-mode test on real hardware every release.
2. **Staff fall back to paper** — pre-fill everything so the system is faster than paper, per-role one-page cheat sheets, dev on-site at each go-live, parallel-run exit criteria.
3. **Owner scope creep kills simplicity** — the out-of-scope list is signed up front; monthly batched change requests filtered by the status-field-or-note rule.
4. **Solo-dev bus factor** — total server surface is 2 functions + 1 rules file; a README + weekly exports + standard React/Firebase stack means any competent dev can take over in a day.
5. **Hardware/printer failure at the till** — one pre-configured spare tablet at MAIN, paper pad fallback with the recovered-sales policy, printer combo validated before bulk purchase.

---

## 11. Out of scope

- **Recipe/ingredient auto-depletion** — the complexity the owner explicitly rejected; the 3-movement ledger plus periodic counts gives usage without it (revisit only after 6+ months of stable use).
- **Supplier management & purchase orders** — the owner buys at the market; a purchase record is enough.
- **Payroll/accounting** — the monthly CSV export is the accountant's interface.
- **E-commerce/online ordering** — different business, different system.
- **Loyalty programs** — POS complexity with no proven demand.
- **Per-outlet pricing** — one catalog, one price, one truth.
- **Per-outlet gross margin** — impossible to compute honestly without recipes; business-wide margin is shown instead, with the formula visible.
- **Approval workflows of any kind** — visibility (stamped actions on the owner's dashboard) replaces approval everywhere.
