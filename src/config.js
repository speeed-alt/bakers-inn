// Single place for the handful of business constants.

// Printed at the top of every receipt.
//
// The address and phone here are only a fallback. Each outlet carries its own —
// three shops in three different places cannot share one address, and a
// customer coming back about a wrong order needs the counter they stood at.
// Set them per outlet under Catalogue → Outlets.
//
// CONFIRM WITH THE OWNER before going live: these are placeholders, and every
// bakery bill in Faisalabad carries a real address and a real phone number.
export const BUSINESS_NAME = "Baker's Inn"
export const BUSINESS_ADDRESS = 'Faisalabad'
export const BUSINESS_PHONE = ''

// What receipts are printed on. This sets the page size, margins and type size
// together so the slip comes out right at 100% — nobody should have to touch
// the scale or margins in the print dialog.
//
// The type is sized for the paper: 9pt on a roll, 11pt on A5, 12pt on A4. (This
// comment used to say 11, 19 and 27, which was left over from an earlier design
// and matched nothing in the code — the numbers live in `PAPERS` in
// src/lib/paper.js and that is the place to change them.)
//   '80mm' — thermal till roll, the usual point-of-sale printer
//   'a5'   — half sheet on an ordinary printer
//   'a4'   — full sheet
//
// On a roll this is only half of one setting. The printer's Windows driver does
// not offer a roll of unlimited length; it offers a fixed list of paper — the
// POS-80 here has 80x210, 80x297 and 80x3276 — and Chrome floats the slip inside
// a longer one rather than printing short, and shrinks it whole to fit a
// narrower one. ROLL_LENGTH in src/lib/paper.js names the paper this expects:
// **80 x 210mm**. Change both together or neither.
export const RECEIPT_PAPER = '80mm'

// Pakistani Rupee. Paisa have long been out of circulation, so the rupee itself
// is the smallest unit there is — every amount in the system is a whole number
// of rupees, held as an integer. To move to a currency with subunits, set
// CURRENCY_DECIMALS to 2; nothing else needs to change.
export const CURRENCY_SYMBOL = 'Rs'
export const CURRENCY_DECIMALS = 0
export const MINOR_UNITS = 10 ** CURRENCY_DECIMALS

// How a customer can pay.
//
// `drawer` is the only field that really matters, and it is not a label: it
// decides whether the money is expected to be in the till at closing time.
// Cash is; a JazzCash transfer sitting in the shop's mobile account is not.
// Getting that wrong makes every drawer read short by the day's transfers, and
// a cashier gets accused of it.
//
// `account` means the till has to show the customer where to send the money —
// the shop's own JazzCash number, or its bank details. That is the whole
// interaction: the cashier turns the screen round, the customer reads it off
// and sends, and the cashier confirms it arrived.
//
// To add a method — another wallet, another bank — add a row here and fill in
// its details under Catalogue → Outlets. Nothing else needs to know about it.
export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash', drawer: true },
  { id: 'card', label: 'Card', drawer: false },
  { id: 'jazzcash', label: 'JazzCash', drawer: false, account: true },
  { id: 'easypaisa', label: 'Easypaisa', drawer: false, account: true },
  { id: 'bank', label: 'Bank transfer', drawer: false, account: true },
]

// Where customers send money, when the shop has not set its own.
//
// Each outlet can carry its own — takings are far easier to reconcile when
// every shop has its own number — but a single business account is normal, and
// this is what every shop falls back to.
//
// CONFIRM WITH THE OWNER. These are blank on purpose: a wrong account number
// on a till screen sends a customer's money to a stranger.
export const PAYMENT_ACCOUNTS = {
  jazzcash: '',
  easypaisa: '',
  bank: '',
}

// Sales rung before this hour count towards the previous business day, so a
// late shift that runs past midnight lands on the right day's report.
export const DAY_ROLLOVER_HOUR = 4

// How far a tablet's clock may be out before the app says so. Generous on
// purpose: a couple of minutes of drift changes nothing, and a banner nobody
// needs is a banner everybody learns to ignore.
export const CLOCK_TOLERANCE_MINUTES = 5

// The daily cycle. An outlet orders on the evening before the day it is for;
export const TIME_ZONE = 'Asia/Karachi'

// The outlet that buys, bakes and distributes. Stock sent back at the end of a
// day goes here. Set once when the outlets are created.
export const HUB_BRANCH_ID = 'MAIN'

// How far back to look for "what did we order last <same weekday>" when
// pre-filling an order. Bakery trade runs weekly, so the same weekday is the
// honest comparison — a Friday is nothing like a Monday.
export const HISTORY_WEEKS = 4

// Reasons offered when a delivery arrives short. Picked, never typed.
export const SHORT_REASONS = ['Not enough baked', 'Damaged in transit', 'Miscounted', 'Other']

// Why stock is being thrown out at the end of the day.
export const WASTE_REASONS = ['Unsold', 'Stale', 'Damaged', 'Other']

// Customers pay in round notes, so checkout offers the exact amount plus the
// bill rounded up to each of these. A Rs 1,080 bill becomes 1,100 / 1,500 /
// 2,000 / 5,000 — the amounts actually handed across the counter.
export const QUICK_CASH_STEPS = [100, 500, 1000, 5000]

// Reasons offered when voiding a sale. Picked, never typed.
export const VOID_REASONS = ['Rung by mistake', 'Customer changed mind', 'Wrong item', 'Other']

export const ROLES = ['owner', 'cashier', 'specialist']

// What the business spends besides ingredients. Salaries are their own kind
// because they are per person and per month rather than per bill.
export const UTILITY_CATEGORIES = [
  'Electricity',
  'Gas',
  'Water',
  'Internet',
  'Rent',
  'Repairs',
  'Transport',
  'Other',
]

export const PRODUCT_CATEGORIES = ['Bread', 'Bakery', 'Cakes', 'Savoury', 'Other']
