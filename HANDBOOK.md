# Baker's Inn — handbook

How the system works, what happens each day, and what to do when it doesn't.

This is the book for whoever runs it. For teaching staff, use
[TRAINING.md](TRAINING.md). For getting it live the first time, use
[GOLIVE.md](GOLIVE.md).

---

## 1 · What it is, in one page

Three shops. One of them — **Susan Road** — is also the bakery: it buys the
flour, does the baking, and sends bread out to **Gulberg** and **Gulistan
Colony** every morning. The other two only sell.

The system follows that shape exactly. It is one web app, opened on a cheap
Android tablet at each counter, and what you see depends on who signed in.

The day is a loop, and every screen in the app is one step of it:

```
        ┌───────────────────────────────────────────────────────┐
        │                                                        │
   1. Each shop says what it wants for tomorrow      (Close day, step 3)
        │                                                        │
   2. At 05:00 the system adds those up into ONE baking list     │
        │                                                        │
   3. The kitchen bakes it and records what came out    (Bake)    │
        │                                                        │
   4. The vans go out with delivery notes            (Dispatch)   │
        │                                                        │
   5. Each shop counts what arrived                     (Stock)   │
        │                                                        │
   6. They sell all day                                  (Sell)   │
        │                                                        │
   7. At night each shop counts the drawer and the shelf         │
      and says what it wants tomorrow             (Close day) ────┘
```

Nothing else is typed. A product is entered once, in the catalogue, and after
that it is only ever picked from a list. That is the rule the whole thing is
built on.

### The four rules that never bend

1. **Enter once.** If someone has typed it somewhere already, it is never typed
   again — only picked or confirmed.
2. **Nothing is ever deleted.** Products are archived, staff are turned off,
   sales are voided, days are reopened. Every one of those keeps the original
   and adds a note. The database itself refuses deletes.
3. **Visibility instead of permission.** There is no approval queue anywhere.
   Anyone can void a sale or reopen a day — and every one of those actions is
   stamped with a name and appears on the owner's dashboard the same day.
4. **The till never waits for the internet.** Sales are written to the tablet
   first and sent when there is a connection. A shop with the wifi down keeps
   trading and nothing is lost.

---

## 2 · Who sees what

Signing in decides everything. There are three roles.

| | **Cashier** | **Specialist** (kitchen) | **Owner** |
|---|---|---|---|
| Sell | ✅ | | ✅ |
| Stock in / order | ✅ | | ✅ |
| Close the day | ✅ | | ✅ |
| Bake | | ✅ | ✅ |
| Dispatch | | ✅ | ✅ |
| Dashboard | | | ✅ |
| Catalogue, people | | | ✅ |
| Raw materials | | | ✅ |
| Stock on hand | | | ✅ |
| Money / profit | | | ✅ |

A cashier is pinned to their own shop. If Bilal signs in on the Gulistan Colony
tablet, the app refuses and says so — otherwise his sales would be recorded
against the wrong shop and two sets of books would be wrong at once. The owner
can sign in anywhere.

**The screen only hides buttons. The database enforces the real rules.** Even
if someone got past the interface, the server refuses a write that a role is not
allowed to make.

---

## 3 · The screens, one at a time

### Sell — the till

The main screen for a cashier, and the most-used screen in the business.

- Type a **code** (the SR numbers 01–44, the same numbers on the shop's own
  printed sheet) or type part of the name.
- Type a **quantity** rather than tapping `+` forty times.
- **Weighed items** accept `4.5`, `4.5kg` or `450g`.
- The total sticks to the bottom of the screen so it is always visible.
- **Pay** asks cash or card. For cash, type what the customer handed over and
  the change is worked out.
- The receipt prints in the local four-column format, with the total written out
  in words as well as figures — a figure can be altered with a pen, a line of
  words cannot.

**Something not on the list.** The shop sells a few things it does not bake — a
bottle of Coke out of the fridge, a packet of crisps. Type the name, and when
nothing matches, tap **Sell "coke" as a one-off**, give it a price, and it goes
on the bill like anything else.

- It counts in the takings, the cash and card split, the receipt and the drawer.
- It is **not** added to the catalogue, and the kitchen is never asked to bake
  it. It stays out of the stock report, the shelf count and tomorrow's order.
- The price this tablet last charged for that name is filled in for you.
- Everything sold this way shows on the owner's dashboard under **Sold off the
  list today**. Anything appearing there most days should become a real product
  with a price the owner sets, rather than being typed fresh each time.

Corrections, both same-day and both stamped:

- **Fix** changes a sale rung as cash to card, or the other way round.
- **Void** cancels a sale entirely. It stays on the list, greyed, with the
  reason. It never disappears.

**If the internet is down, keep selling.** The sale is saved on the tablet and
goes up on its own. Never re-ring a sale because the screen looked slow.

### Stock — taking the delivery in, and ordering

Two jobs, both pre-filled so nothing is typed from scratch.

**The delivery.** When the van arrives, the note is already on screen with what
was sent. Count what actually came. Anything that does not match needs a reason
from a short list — *damaged in transit*, *short at the hub*, and so on. Both
figures are kept side by side for good, so a short delivery is never quietly
turned into the shop's own waste.

**Tomorrow's order.** Suggested from what this shop actually sold on the same
weekday recently. A day that ended with nothing left and nothing thrown out
measured the shelf rather than the demand, so those days are nudged up 10%.
Change any line; the suggestion is a starting point, not an instruction.

### Close day — the four-step night wizard

The most important screen in the system, and the only one that must be done
every night at every shop.

1. **Count the cash.** Type what is actually in the drawer. The system already
   knows the opening float and what was rung up, so it shows over or short
   immediately. It does not stop you if it disagrees — it records it.
2. **Count the shelf.** For each item: how many are left, and of those how many
   are being thrown out, kept for tomorrow, or sent back to the hub. The words
   are the ones already on the shop's own sheet.
3. **Tomorrow's order.** Same screen as above. **The day cannot be finished
   until this is sent** — that is deliberate; a shop that closes without
   ordering gets no bread.
4. **Review and finish.** Everything on one screen, including the float being
   left for tomorrow, before it is committed.

A day closed by mistake can be **reopened** by the same shop, without waiting
for the owner. It is stamped and it shows on the dashboard.

### Bake — the kitchen

One list, for all three shops, compiled at 05:00. For each line, record what
actually came out of the oven.

- A short bake is normal and the list can still be finished — otherwise the vans
  never leave.
- **Also baked today** is for a tray nobody ordered. It is kept separate from
  the ordered list on purpose, so tomorrow's suggestion never learns about
  demand that did not exist.

### Dispatch — loading the vans

A delivery note per shop, pre-filled from the baking list. Adjust what is
actually going, and send. Anything coming back from a shop is confirmed here by
counting what actually returned, not by accepting what they said they sent.

### Dashboard — the owner's screen

Opens with **the daily sheet** — the same line you write on the pad: date,
production, distribution to each shop, sale position at each, total sale, total
stale. Then:

- **Today** — takings, cash, card, transactions, week so far, day average.
- **Needs a look** — the only list that matters. Shops that have not closed,
  deliveries that never arrived, materials running out, days reopened.
- **Today's round** — where the cycle has got to right now.
- **Last 7 days**, waste and sell-through, gross margin.
- **For the accountant** — CSV exports.
- **By outlet**, best sellers, recent closes.
- **Faults** — anything that broke on any tablet in the last three days.

### Catalogue, materials, stock, money

Owner-only.

- **Catalogue** — products, prices, staff, outlets. Also merging: five cakes all
  at Rs 2,000 can become one code with the names kept underneath. Once merged
  the system knows ten cakes sold and can never say which ten, and the screen
  says so before you agree.
- **Raw materials** — flour, sugar, and what they cost. Deliberately a ledger,
  not a recipe engine: log a delivery, count now and then, note anything that
  went bad. Usage is worked out from the gap between two counts.
- **Stock on hand** — what is on the shelves at all three shops right now,
  worked out rather than counted. A delivery still in the van is not stock.
- **Money** — bills, wages, profit. Per shop it says *contribution*, not profit,
  because flour is bought once at the hub and there is no honest way to split a
  sack. Only the whole business gets a profit figure.

---

## 4 · What happens each day

| Time | Who | What |
|---|---|---|
| 05:00 | *automatic* | The three orders are added into one baking list |
| 05:15 | Kitchen | Open **Bake**, work through the list, record what came out |
| ~07:00 | Kitchen | **Dispatch** — adjust and send each shop's note |
| ~07:30 | Each shop | **Stock** — count what arrived, give a reason for anything short |
| all day | Cashiers | **Sell** |
| 06:00 next day | *automatic* | Yesterday's reports rebuilt, so late-syncing sales settle |
| closing | Each shop | **Close day** — cash, shelf, tomorrow's order, finish |
| any time | Owner | **Dashboard** |

The two automatic steps are the only things that do not have a person behind
them. If the 05:00 one has not run by 05:15, the kitchen makes the list itself
from the Bake screen — same calculation, one tap. See §7.

---

## 5 · Practice mode

A tablet you can teach somebody on, wired to the real system, where nothing that
happens counts.

**Turning it on.** Owner signs in → Dashboard → bottom of the page → *Start
practice on this tablet*. The tablet reloads with an unmissable banner across
the top.

**What a trainee gets.** The real products at the real prices, and a day they
can do anything to: ring sales, take payments, print receipts, void, refund,
count a delivery in, close the day, send an order.

**What it cannot touch.**

- Nothing rung up in practice appears in the takings, the daily sheet, the
  reports, the profit, or tomorrow's baking suggestion. It is filtered out at
  the one place every read in the app passes through.
- Practice records get their own document ids, so a practice close cannot land
  on top of a real one. This matters more than it sounds: without it, teaching
  a cashier to close the day would have overwritten that shop's real close.
- **Raw materials and the money screens are switched off while practising**, and
  say so. They write to figures that have no practice copy — a count entered for
  training would become the bakery's actual stock figure.

**Turning it off.** *End practice* on the banner. Anyone can do this, not just
the owner — whoever is holding the tablet must be able to hand it back live
without going to find anybody.

**It ends by itself.** Practice mode is stored with the day it was switched on.
A tablet left in practice overnight is live again by morning, on its own. This
is the safety net that matters: the failure worth designing against is a shop
trading all day into records that were never real, which looks completely normal
until the drawer is counted.

**Going live is a switch, not a clean-up.** Practice records stay in the
database and simply stop being visible. Nothing in the app deletes anything,
ever — including this.

> **One tablet at a time.** Practice is per tablet. The other two shops carry on
> trading normally the whole time.

---

## 6 · The things worth knowing before you need them

**Money is whole rupees.** No paisa anywhere. Never enter a fractional amount.

**The day rolls over at 4am.** A sale rung at 01:30 belongs to the day that
opened yesterday morning, which is what you want when a shop closes late.

**The tablet's clock decides the date.** So a tablet with a badly wrong clock
files a day's takings under the wrong day and nothing else notices. The app
checks its own clock against the server and warns — it never silently corrects.

**Every tablet must be online once before it can sell anything.** With an empty
cache and no connection it has no product list. Set each one up on the wifi and
sign in once before it goes to a counter.

**Never clear the app's data or storage.** Firestore keeps sales that have not
reached the server yet in the browser's storage. Clearing it throws away an
afternoon's takings with no way back. If the app says it cannot start, tap **Try
again** first; *Reset this tablet* asks before it wipes anything, and it means
it.

**Codes are the SR numbers off the shop's own sheet.** Staff have read those
numbers for years. Do not renumber them.

---

## 7 · When something goes wrong

### There is no baking list at 05:15

**The kitchen fixes this itself now.** Open **Bake** and tap **Make the list
now**. It adds up whatever the outlets sent last night — the identical
calculation the 05:00 job runs, so it produces the list the job would have
produced. Nobody types what to bake; it is still only ever the shops' own
orders added up.

If no outlet has ordered, it repeats each shop's last same weekday, and says so.
If nothing at all can be found it says that too, and the shops need chasing.

It is stamped with who pressed it, and it shows on the owner's dashboard —
worth telling the developer afterwards, since a morning the job did not run is
a fault, but it is no longer an emergency and nobody is waiting on a phone call.

### A cashier says nothing is saving

Almost always a stale sign-in — the app shows a banner saying so. Sign out and
back in. If the banner mentions permissions, that person's account has not had
its permissions synced; see §8.

### The drawer is over or short and nobody knows why

Look for, in order:

1. A **void** or a **refund** that day, on the dashboard.
2. A sale rung as cash but taken on card, or the reverse.
3. The **opening float** — was yesterday's close finished properly?
4. A **fault** on the dashboard around that time.

Record what is actually in the drawer either way. The system's job is to show
the disagreement, not to hide it.

### A shop's day was closed by accident

That shop reopens it themselves from the close screen. It is stamped and shows
on the dashboard. They do not need the owner.

### Somebody forgot their PIN

**There is no PIN reset.** PINs are never stored anywhere, so nobody can look
one up. Fixing it needs a laptop with the admin key. Do not let this happen at
07:00 on a Friday.

### A tablet is showing yesterday's numbers

Hard-reload it. If the app has a new version waiting it says so and waits for
somebody to tap — it never reloads itself mid-sale.

---

## 8 · The bits that are still a developer's job

Honest list, so nobody waits on something that is not going to happen by itself.

- **Adding a member of staff needs a follow-up.** The app creates the account,
  but their permissions are written by a server job that is not deployed yet
  (it needs Blaze billing). Until then a new person signs in fine and can save
  nothing. See [GOLIVE.md](GOLIVE.md).
- **Turning someone off** stops them at the next sign-in, not immediately.
- **No PIN reset**, as above.
- **Printing is whatever Android can print to.** There is no thermal-printer
  support in the app.
- **The order suggestion ignores stock already on the shelf.** It answers "how
  much does this weekday need", not "how much more do we need", so for items
  that keep it reads slightly high.

---

## 9 · Commands

For whoever maintains it. Everything defaults to the emulator; reaching the real
project takes a project id and a key, deliberately.

```bash
npm run emulators   # local Firestore + Auth
npm run seed        # outlets, staff, the 44-item catalogue, materials
npm run dev         # the app, against the emulator
npm test            # 246 logic tests, no emulator needed
npm run test:rules  # 55 security-rules tests, emulator must be running
```

Building a full demo day locally, to look at or to practise against:

```bash
node scripts/demo-day.mjs
node scripts/compile-now.mjs --demo
node scripts/demo-kitchen.mjs
```

Taking it back out again:

```bash
node scripts/demo-day.mjs --clear
```

Deploying:

```bash
npm run build && firebase deploy --only hosting --project bakers-inn-pk
```

The emulator needs **JDK 21+**. System Java is 8; a good one ships with Android
Studio:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
```
